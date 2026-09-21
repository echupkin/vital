// ── Supported analyst questions (SPEC §8) ───────────────
//
// The canonical list of questions the *demo* analyst can actually answer, paired
// with the handler that answers each one.
//
// This module is imported by the browser (for the suggested-prompt list), so it
// deliberately contains nothing else: the system prompt and the model message
// builder live in `systemPrompt.ts`, which is server-only, so they are not
// carried into the client bundle alongside this list.
//
// Routing is pattern matching over these questions, not language understanding:
// anything outside this list is reported as unsupported rather than guessed at.
// When a real provider is configured, an unmatched question is instead sent to
// that provider with a bounded general selection (see retrieval.ts).

export interface SupportedQuestion {
  handlerId: string;
  prompt: string;
}

export const SUPPORTED_QUESTIONS: SupportedQuestion[] = [
  { handlerId: 'rhr-week-over-week', prompt: 'Why was my resting heart rate higher this week?' },
  { handlerId: 'sleep-1-month', prompt: 'How has my sleep changed over the last month?' },
  { handlerId: 'sleep-3-months', prompt: 'How has my sleep changed over the last 3 months?' },
  { handlerId: 'hrv-trend', prompt: 'How is my HRV trending?' },
  { handlerId: 'steps-vs-baseline', prompt: 'How do my steps compare with my baseline?' },
  { handlerId: 'sleep-vs-recovery', prompt: 'Are my workouts associated with better sleep?' },
  { handlerId: 'workout-frequency', prompt: 'How often am I working out?' },
  { handlerId: 'what-changed-this-week', prompt: 'What changed this week?' },
];

export const SUPPORTED_PROMPTS: string[] = SUPPORTED_QUESTIONS.map(q => q.prompt);
