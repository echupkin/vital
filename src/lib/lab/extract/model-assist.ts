// ── The OPTIONAL model second pass ───────────────────────────────────────────
//
// A last resort for a layout the deterministic parser has never seen. It is
// NEVER the first path and never a silent one:
//
//   * it runs only when the deterministic pass produced NO complete analyte rows
//     (see ./index.ts), so a readable document never costs a network call;
//   * it reuses the EXISTING analyst provider seam
//     (src/lib/analyst/config.ts + provider.ts) — no parallel environment
//     variables, no second notion of "which model";
//   * it sends only BOUNDED, PII-STRIPPED text: every line is put through the
//     same redaction the rest of the pipeline uses, so an identity line cannot
//     leave the process even by way of a prompt;
//   * it TRUSTS NOTHING the model returns. Every printed name, value token, unit,
//     interval and date must appear verbatim in the source text (compared after
//     whitespace normalisation) or the candidate is dropped and reported. A model
//     cannot introduce a number, a unit, a range or a date that is not in the
//     document, because the check is against the document.
//
// Rows that survive carry `extractionMethod: 'model'`, and the caller records
// which pass produced the document's rows.

import { readAnalystConfig } from '@/lib/analyst/config';
import { createProvider, supportsCompletion } from '@/lib/analyst/provider';
import type { ExtractedObservation, ExtractionWarning } from '../types';
import { analyteKeyFor, confidenceOf, parseFlag, redact } from './parse';
import { parsePrintedDate } from './layout';

/** How much source text a single request may carry. */
export const MAX_PROMPT_LINES = 240;
/** How long one source line may be in the prompt. */
export const MAX_PROMPT_LINE_CHARS = 160;
/** How many candidate rows a single reply may contribute. */
export const MAX_CANDIDATES = 200;

/** One redacted line of source text, with its printed line number. */
export interface AssistLine {
  lineNo: number;
  text: string;
}

export interface ModelAssistInput {
  /** Redaction-free lines; this module redacts them before sending. */
  lines: AssistLine[];
  /** The dates the page printed as columns, and the ISO form of each. */
  columns: { dateText: string; date: string | null }[];
}

/** Injected for tests: a completion function, or an environment. */
export interface ModelAssistDeps {
  complete?: (system: string, user: string) => Promise<{ text: string }>;
  env?: NodeJS.ProcessEnv;
}

export interface DroppedCandidate {
  /** The candidate as the model returned it. Safe to show: it was validated out. */
  candidate: unknown;
  reason: string;
}

export interface ModelAssistResult {
  /** True when a model was actually asked. */
  attempted: boolean;
  /** Who answered, for the provenance line. Null when nothing was asked. */
  provider: string | null;
  observations: ExtractedObservation[];
  dropped: DroppedCandidate[];
  warnings: ExtractionWarning[];
}

const SYSTEM_PROMPT = [
  'You read laboratory result documents. You are given the text layer of a PDF, one printed line per line,',
  'with a leading line number in square brackets, and the list of dates the page printed as table columns.',
  'Return ONLY a JSON object of the form {"observations": [...]}. Each observation must be:',
  '{"lineNo": <the bracketed line number the row is on>, "printedName": <the analyte name exactly as printed>,',
  '"resultOn": <one of the given column dates>, "value": <number or null>, "valueText": <the printed result',
  'when it is not a plain number, else null>, "unit": <unit exactly as printed or null>, "refText": <the',
  'reference interval exactly as printed or null>, "printedFlag": <the flag exactly as printed or null>}.',
  'Copy every string VERBATIM from the text. Do not compute, convert, correct or invent anything. Do not',
  'report a value you cannot see. If you cannot determine a row, leave it out. Output JSON only.',
].join(' ');

/** Collapse all whitespace, so a comparison is about content not formatting. */
function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** True when a token appears verbatim in the source, ignoring whitespace only. */
export function appearsInSource(source: string, token: string | null): boolean {
  if (token === null) return true;
  const needle = normaliseWhitespace(token);
  if (needle === '') return false;
  return source.includes(needle);
}

/**
 * Run the optional second pass.
 *
 * Returns `attempted: false` and asks nothing when no completion provider is
 * configured — the caller decides what to say about that; this module never
 * silently falls back and never reaches the network on its own.
 */
export async function assistExtraction(
  input: ModelAssistInput,
  deps: ModelAssistDeps = {}
): Promise<ModelAssistResult> {
  const warnings: ExtractionWarning[] = [];
  const dropped: DroppedCandidate[] = [];
  const empty: ModelAssistResult = { attempted: false, provider: null, observations: [], dropped, warnings };

  let complete = deps.complete;
  let provider: string | null = deps.complete ? 'injected' : null;

  if (!complete) {
    let resolved;
    try {
      resolved = readAnalystConfig(deps.env ?? process.env);
    } catch {
      return empty;
    }
    if (resolved.provider === 'demo' || resolved.misconfiguredReason) return empty;
    let instance;
    try {
      instance = createProvider(resolved);
    } catch {
      return empty;
    }
    if (!supportsCompletion(instance)) return empty;
    provider = resolved.providerDisplayName;
    complete = (system, user) => instance.complete(system, user).then(result => ({ text: result.text }));
  }

  const sourceLines = input.lines.slice(0, MAX_PROMPT_LINES);
  const sourceText = sourceLines.map(line => line.text).join('\n');
  const redactedPrompt = sourceLines
    .map(line => `[${line.lineNo}] ${redactLineForPrompt(line.text).slice(0, MAX_PROMPT_LINE_CHARS)}`)
    .join('\n');
  const columnText = input.columns
    .map(column => `${column.dateText} (${column.date ?? 'unreadable'})`)
    .join(', ');

  const user = [
    `Column dates, exactly as printed: ${columnText}`,
    '',
    'Document text, PII already removed:',
    redactedPrompt,
  ].join('\n');

  let reply: { text: string };
  try {
    reply = await complete(SYSTEM_PROMPT, user);
  } catch (error) {
    return {
      attempted: true,
      provider,
      observations: [],
      dropped,
      warnings: [
        {
          code: 'deterministic_pass_empty',
          message: `The optional model pass was offered this document but the provider failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
          page: null,
          line: null,
        },
      ],
    };
  }

  const candidates = readCandidates(reply.text);
  const allowedDates = new Set(input.columns.map(column => column.date).filter((date): date is string => Boolean(date)));
  const observations: ExtractedObservation[] = [];

  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    const verdict = validateCandidate(candidate, sourceText, allowedDates);
    if (!verdict.ok) {
      dropped.push({ candidate, reason: verdict.reason });
      continue;
    }
    const { row } = verdict;
    const printedFlag = row.printedFlag === null ? null : parseFlag(row.printedFlag);
    const sourceLineNo = typeof row.lineNo === 'number' && Number.isFinite(row.lineNo) ? Math.trunc(row.lineNo) : null;
    const lineText = sourceLineNo === null ? null : sourceLines.find(line => line.lineNo === sourceLineNo)?.text ?? null;
    observations.push({
      lineNo: 0,
      analyteKey: typeof row.analyteKey === 'string' && row.analyteKey.trim() ? row.analyteKey.trim() : analyteKeyFor(row.printedName),
      printedName: row.printedName.trim(),
      // The model pass reads VALUES from a crop of the page: it is shown no panel
      // heading and is never asked to invent one, so its rows carry none.
      panel: null,
      resultOn: row.resultOn,
      value: row.value,
      valueText: row.valueText === null ? null : row.valueText,
      unit: row.unit === null ? null : row.unit,
      refLow: null,
      refHigh: null,
      refText: row.refText,
      refSource: row.refText === null ? 'none' : 'report',
      refBasis: null,
      printedFlag,
      category: null,
      extractionMethod: 'model',
      confidence: confidenceOf({
        name: row.printedName,
        hasValue: row.value !== null || row.valueText !== null,
        unit: row.unit,
        range: row.refText,
      }),
      sourceLine: lineText === null ? null : redactLineForPrompt(lineText),
    });
  }

  if (dropped.length > 0) {
    warnings.push({
      code: 'model_rows_dropped',
      message: `The optional model pass proposed ${dropped.length} row(s) that did not appear verbatim in the document, so they were dropped: ${dropped
        .map(entry => entry.reason)
        .slice(0, 3)
        .join('; ')}`,
      page: null,
      line: null,
    });
  }

  return { attempted: true, provider, observations: assignObservationLines(observations), dropped, warnings };
}

/** Interview-safe: the model's own suggested `lineNo` is not used for storage. */
function assignObservationLines(observations: ExtractedObservation[]): ExtractedObservation[] {
  return observations.map((observation, index) => ({ ...observation, lineNo: index + 1 }));
}

/** Build the prompt's redaction, which is the pipeline's redaction. */
function redactLineForPrompt(text: string): string {
  return redact(text);
}

interface CandidateRow {
  lineNo?: unknown;
  printedName: string;
  analyteKey?: unknown;
  resultOn: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  refText: string | null;
  printedFlag: string | null;
}

type Verdict = { ok: true; row: CandidateRow } | { ok: false; reason: string };

/** Pull the candidate rows out of whatever shape the model actually returned. */
export function readCandidates(text: string): unknown[] {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const list = (payload as { observations?: unknown }).observations;
    if (Array.isArray(list)) return list;
    const rows = (payload as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

/**
 * Validate one candidate against the source text. Anything that is not verbatim
 * in the document is refused — including a value, a unit, an interval or a date.
 */
export function validateCandidate(candidate: unknown, source: string, allowedDates: Set<string>): Verdict {
  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: 'not an object' };
  const raw = candidate as Record<string, unknown>;

  const printedName = typeof raw.printedName === 'string' ? raw.printedName : null;
  if (!printedName || !printedName.trim()) return { ok: false, reason: 'no printed name' };
  if (!appearsInSource(source, printedName)) return { ok: false, reason: `name "${printedName}" is not in the document` };

  const resultOn = typeof raw.resultOn === 'string' ? raw.resultOn : null;
  if (!resultOn) return { ok: false, reason: 'no result date' };
  if (!appearsInSource(source, resultOn.replace(/-/g, ' ').trim()) && !appearsInSource(source, resultOn) && !allowedDates.has(resultOn)) {
    return { ok: false, reason: `date "${resultOn}" is not a column the document printed` };
  }
  if (!allowedDates.has(resultOn)) return { ok: false, reason: `date "${resultOn}" is not one of the document's columns` };

  const value = typeof raw.value === 'number' && Number.isFinite(raw.value) ? raw.value : null;
  const valueText = typeof raw.valueText === 'string' && raw.valueText.trim() ? raw.valueText.trim() : null;
  if (value === null && valueText === null) return { ok: false, reason: 'no value' };
  if (value !== null && !appearsInSource(source, String(value))) {
    return { ok: false, reason: `value "${value}" is not in the document` };
  }
  if (valueText !== null && !appearsInSource(source, valueText)) {
    return { ok: false, reason: `printed result "${valueText}" is not in the document` };
  }

  const unit = typeof raw.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : null;
  if (unit !== null && !appearsInSource(source, unit)) {
    return { ok: false, reason: `unit "${unit}" is not in the document` };
  }

  const refText = typeof raw.refText === 'string' && raw.refText.trim() ? raw.refText.trim() : null;
  if (refText !== null && !appearsInSource(source, refText)) {
    return { ok: false, reason: `interval "${refText}" is not in the document` };
  }

  const printedFlag = typeof raw.printedFlag === 'string' && raw.printedFlag.trim() ? raw.printedFlag.trim() : null;
  if (printedFlag !== null && !appearsInSource(source, printedFlag)) {
    return { ok: false, reason: `flag "${printedFlag}" is not in the document` };
  }

  return {
    ok: true,
    row: {
      lineNo: raw.lineNo,
      printedName,
      analyteKey: raw.analyteKey,
      resultOn,
      value,
      valueText,
      unit,
      refText,
      printedFlag,
    },
  };
}

/** ISO date for a column printed on a page, when a caller needs to compare. */
export function columnDate(text: string): string | null {
  return parsePrintedDate(text);
}