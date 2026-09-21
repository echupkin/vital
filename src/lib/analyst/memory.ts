// ── Analyst conversation memory (bounded, server-side) ───────────────────────
//
// A conversation carries its own context forward: when a follow-up like "and
// what about last month?" is asked, the earlier turns go with the request so the
// model can resolve what "that" and "last month" refer to. This module is the
// ONE place that decides how much of that history travels, and it is
// deliberately a cap, not the whole thread.
//
// THE MEMORY RULE
//   * at most MAX_MEMORY_TURNS earlier turns are carried (6);
//   * at most MAX_MEMORY_CHARS characters in total (4000);
//   * a single turn is capped at MAX_MEMORY_TURN_CHARS (1200) before counting;
//   * when the budget runs out the OLDEST turns are dropped first — the newest
//     turns are the ones a follow-up refers to, so they are kept;
//   * a brand-new conversation has no prior turns and so carries none.
//
// The retrieved health context is NOT affected: retrieval is bounded exactly as
// it was (see retrieval.ts), and memory is a separate, text-only block. Memory
// never adds a health value — it carries the questions and answers already shown
// to the reader.
//
// The text is treated as untrusted data by the prompt (see systemPrompt.ts): it
// is the reader's own words and the model's own earlier reply, but it is still
// inserted as DATA, never as instructions.

export type ChatTurnRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatTurnRole;
  content: string;
}

/** How many earlier turns may travel with a question. */
export const MAX_MEMORY_TURNS = 6;

/** How many characters of earlier turns may travel in total. */
export const MAX_MEMORY_CHARS = 4000;

/** Cap on one carried turn, applied before the total is counted. */
export const MAX_MEMORY_TURN_CHARS = 1200;

/** Strip control characters and collapse whitespace. Never throws. */
function clean(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * The bounded slice of a conversation's earlier turns to carry with the next
 * question, oldest first. Returns `[]` for a new conversation.
 */
export function boundedHistory(
  turns: readonly { role?: unknown; content?: unknown }[] | undefined | null,
  options: { maxTurns?: number; maxChars?: number; maxTurnChars?: number } = {}
): ChatTurn[] {
  const maxTurns = options.maxTurns ?? MAX_MEMORY_TURNS;
  const maxChars = options.maxChars ?? MAX_MEMORY_CHARS;
  const maxTurnChars = options.maxTurnChars ?? MAX_MEMORY_TURN_CHARS;

  const cleaned: ChatTurn[] = [];
  for (const turn of turns ?? []) {
    const role: ChatTurnRole = turn?.role === 'assistant' ? 'assistant' : 'user';
    const content = clean(turn?.content, maxTurnChars);
    if (content.length > 0) cleaned.push({ role, content });
  }

  // Walk backwards (newest first) so the budget is spent on the most recent
  // turns; the first turn that does not fit ends the walk, dropping everything
  // older than it.
  const kept: ChatTurn[] = [];
  let chars = 0;
  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    if (kept.length >= maxTurns) break;
    const turn = cleaned[i];
    if (chars + turn.content.length > maxChars) break;
    kept.unshift(turn);
    chars += turn.content.length;
  }
  return kept;
}

/**
 * Render the carried turns as a compact block for the model message.
 *
 * Returned as plain text (not JSON) because it is conversational context rather
 * than structured health data; the caller wraps it in the untrusted-data
 * delimiters. Empty history renders as an empty string.
 */
export function renderHistory(history: readonly ChatTurn[]): string {
  if (history.length === 0) return '';
  const lines = history.map(turn => `${turn.role === 'user' ? 'Reader' : 'Analyst'}: ${turn.content}`);
  return lines.join('\n');
}