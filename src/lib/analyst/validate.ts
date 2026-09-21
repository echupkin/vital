// ── Analyst reply validation (SPEC §8) ──────────────────
//
// A model's reply is untrusted input. Nothing it returns reaches a response
// until it has been parsed, coerced and grounded here:
//
//   * parse tolerantly (a fenced or chatty reply still parses), fail loudly
//   * coerce every shape, cap every string and array, drop empty sections
//   * drop evidence whose metric is not in the registry AND in the bundle, and
//     fill the evidence card from the registry instead of from the model
//   * audit every numeric claim against the numbers actually in the bundle,
//     accepting the formatted `display` strings the model was told to quote
//   * keep the follow-up list to the model's own short questions — recovered
//     when it arrives in an unexpected shape, never invented when it is absent
//
// Nothing is fabricated on failure: a reply that cannot be parsed produces an
// error, never a partial answer with invented fields.

import { getMetric } from '../metrics/registry';
import { windowRangeLabel } from '../analytics/windows';
import type { UnitSystem } from '../prefs';
import type { AnalystAnswer, AnalystChart, AnalystEvidence, AnalystGrounding, RetrievalBundle } from './types';
import { BOUNDARY_NOTE } from './handlers';
import { collectDisplayStrings } from './systemPrompt';

/** Caps. Every one of these exists so a model cannot bloat a response. */
export const MAX_TITLE_CHARS = 160;
export const MAX_LINE_CHARS = 500;
export const MAX_LINES_PER_SECTION = 8;
export const MAX_EVIDENCE = 8;
/**
 * Hard cap on follow-ups kept. The prompt asks for one to three short
 * questions; anything beyond three is padding, so it is dropped rather than
 * shown. (This was 5 before the prompt started requiring a short list.)
 */
export const MAX_FOLLOWUPS = 3;
export const MAX_FOLLOWUP_CHARS = 200;
export const MAX_UNMATCHED_REPORTED = 20;

// ── Tolerant JSON extraction ────────────────────────────

/** Strip ```json fences (and any stray fence markers) from a reply. */
function stripFences(text: string): string {
  return text
    .replace(/```[ \t]*[a-zA-Z0-9_-]*[ \t]*\r?\n/g, '')
    .replace(/```/g, '');
}

/**
 * Find the first balanced JSON object in a string.
 *
 * A brace counter would be fooled by a brace inside a string, so this walks the
 * text tracking string state and escapes. Returns null when no balanced object
 * closes.
 */
export function extractJsonObject(text: string): string | null {
  const source = stripFences(text);
  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

// ── Coercion ────────────────────────────────────────────

function coerceText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function coerceLines(raw: unknown, max = MAX_LINES_PER_SECTION): string[] {
  if (!Array.isArray(raw)) {
    const single = coerceText(raw, MAX_LINE_CHARS);
    return single ? [single] : [];
  }
  const lines: string[] = [];
  for (const item of raw) {
    const line = coerceText(item, MAX_LINE_CHARS);
    if (line) lines.push(line);
    if (lines.length >= max) break;
  }
  return lines;
}

/**
 * Coerce the follow-up list.
 *
 * A model that returns a bare string, or objects like `{question: "…"}`, has
 * still produced content: that is recovered rather than thrown away. Nothing is
 * ever invented — a reply that genuinely contains no follow-ups keeps an empty
 * list, and the empty list is reported as-is instead of being filled with
 * canned questions that would read as the model's own.
 */
function coerceFollowUps(raw: unknown): string[] {
  const items: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const out: string[] = [];
  for (const item of items) {
    const candidate =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? (item as Record<string, unknown>).question ??
            (item as Record<string, unknown>).text ??
            (item as Record<string, unknown>).followUp
          : null;
    const line = coerceText(candidate, MAX_FOLLOWUP_CHARS);
    if (!line) continue;
    if (out.some(existing => existing.toLowerCase() === line.toLowerCase())) continue;
    out.push(line);
    if (out.length >= MAX_FOLLOWUPS) break;
  }
  return out;
}

/** Metric ids a reply is allowed to cite evidence for: exactly what was selected. */
export function citableMetricIds(bundle: RetrievalBundle): Set<string> {
  const ids = new Set<string>();
  for (const s of bundle.summaries) ids.add(s.metricId);
  for (const p of bundle.pairs) {
    ids.add(p.xMetricId);
    ids.add(p.yMetricId);
  }
  return ids;
}

function coerceEvidence(raw: unknown, bundle: RetrievalBundle): AnalystEvidence[] {
  if (!Array.isArray(raw)) return [];
  const allowed = citableMetricIds(bundle);
  const out: AnalystEvidence[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const metricId = coerceText(entry.metricId, 80);
    if (!metricId) continue;
    // Must be a real registry metric AND must have been in the selected context.
    const meta = getMetric(metricId);
    if (!meta || !allowed.has(metricId)) continue;
    if (seen.has(metricId)) continue;
    seen.add(metricId);

    const summary = bundle.summaries.find(s => s.metricId === metricId);
    const pair = bundle.pairs.find(p => p.xMetricId === metricId || p.yMetricId === metricId);
    const fallbackWindow = summary
      ? `${windowRangeLabel(summary.window)} (${summary.lengthLabel})`
      : pair
        ? windowRangeLabel(pair.window)
        : 'Selected window';
    const fallbackCount = summary
      ? `${summary.counts.evaluated} observations evaluated, ${summary.counts.baseline} in the baseline`
      : pair
        ? `${pair.pairedCount} paired days`
        : 'Sample counts not stated';
    const fallbackAggregation = summary?.aggregation ?? 'daily value, paired by calendar day';

    out.push({
      metricId,
      metricName: meta.displayName,
      windowLabel: coerceText(entry.windowLabel, MAX_LINE_CHARS) ?? fallbackWindow,
      aggregation: coerceText(entry.aggregation, MAX_LINE_CHARS) ?? fallbackAggregation,
      sampleCount: coerceText(entry.sampleCount, MAX_LINE_CHARS) ?? fallbackCount,
      // The link is ours, never the model's: it must point at a route that exists.
      href: `/metric/${metricId}?range=${meta.defaultRange}`,
    });
    if (out.length >= MAX_EVIDENCE) break;
  }
  return out;
}

/** Charts are built from the bundle, never from the model. */
function chartsFor(evidence: AnalystEvidence[], bundle: RetrievalBundle): AnalystChart[] {
  const charts: AnalystChart[] = [];
  for (const ev of evidence) {
    const summary = bundle.summaries.find(s => s.metricId === ev.metricId);
    if (!summary || summary.points.length === 0) continue;
    charts.push({
      metricId: summary.metricId,
      caption: `${summary.metricName} · ${windowRangeLabel(summary.window)} · ${summary.points.length} observations`,
      points: summary.points,
    });
    if (charts.length >= 2) break;
  }
  return charts;
}

export interface ReplyContext {
  bundle: RetrievalBundle;
}

export interface ParsedReply {
  ok: boolean;
  answer: AnalystAnswer | null;
  reason: string | null;
}

/**
 * Parse and validate a model reply into an AnalystAnswer.
 * A reply with no usable content at all is a failure; every other problem is
 * repaired by coercion and reported through the grounding audit instead.
 */
export function parseAnalystReply(text: string, ctx: ReplyContext): ParsedReply {
  const json = extractJsonObject(text);
  if (!json) {
    return {
      ok: false,
      answer: null,
      reason: 'The model\'s reply did not contain a JSON object, so it could not be read as an answer.',
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {
      ok: false,
      answer: null,
      reason: 'The model\'s reply contained a JSON object that could not be parsed, so no answer was produced.',
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, answer: null, reason: 'The model\'s reply was not a JSON object, so no answer was produced.' };
  }

  const source = raw as Record<string, unknown>;
  const observed = coerceLines(source.observed);
  const interpretation = coerceLines(source.interpretation);
  const uncertainty = coerceLines(source.uncertainty);

  // An answer with nothing in any section is not an answer.
  if (observed.length === 0 && interpretation.length === 0 && uncertainty.length === 0) {
    return {
      ok: false,
      answer: null,
      reason: 'The model\'s reply had no observed, interpretation or uncertainty content, so no answer was produced.',
    };
  }

  const evidence = coerceEvidence(source.evidence, ctx.bundle);
  const title = coerceText(source.title, MAX_TITLE_CHARS) ?? 'Analysis of your recorded data';

  const followUps = coerceFollowUps(source.followUps);

  return {
    ok: true,
    reason: null,
    answer: {
      id: 'model',
      title,
      observed,
      interpretation,
      uncertainty,
      evidence,
      charts: chartsFor(evidence, ctx.bundle),
      followUps,
      // The standard educational notice is appended regardless of what the
      // model returned: it is a fixed part of the boundary, not model copy.
      boundaryNote: BOUNDARY_NOTE,
    },
  };
}

// ── Grounding check ─────────────────────────────────────

/**
 * Every number the bundle actually contains.
 *
 * The bundle is serialized once and every numeric run is collected, including
 * numbers inside strings (dates, window labels and coverage sentences), so a
 * model restating a date or an observation count is not flagged.
 *
 * Signs are deliberately not collected: "2026-08-19" would otherwise yield -8 and
 * -19 instead of 8 and 19, and a negative delta's magnitude is what a restatement
 * looks like. Comparison is on magnitude, which is what the token scan produces.
 */
export function collectBundleNumbers(bundle: RetrievalBundle): number[] {
  const serialized = JSON.stringify(bundle);
  const matches = serialized.match(/\d+(?:\.\d+)?/g) ?? [];
  const numbers: number[] = [];
  for (const match of matches) {
    const value = Number(match);
    if (Number.isFinite(value)) numbers.push(value);
  }
  return numbers;
}

/** One numeric token from the answer text, with the value it denotes. */
interface NumericToken {
  raw: string;
  value: number;
}

/**
 * Duration forms ("7h 42m", "14 h") consumed as a single token worth their
 * minutes. Exported so the briefing's metric-aware guard tokenizes durations
 * exactly as the analyst's grounding audit does — two audits that disagreed
 * about what one token is would be worse than one.
 */
export const DURATION_RE = /(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?/gi;

/**
 * Extract numeric tokens from a line of prose.
 *
 * Duration forms are consumed first — "7h 42m" is one token worth 462 minutes,
 * not the two separate numbers 7 and 42 — and the remaining text is scanned for
 * plain numbers.
 */
export function extractNumericTokens(text: string): NumericToken[] {
  const tokens: NumericToken[] = [];
  let remainder = '';
  let last = 0;

  DURATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DURATION_RE.exec(text)) !== null) {
    remainder += `${text.slice(last, match.index)} `;
    last = match.index + match[0].length;
    const hours = Number(match[1]);
    const minutes = match[2] ? Number(match[2]) : 0;
    const total = hours * 60 + minutes;
    tokens.push({ raw: match[0].trim(), value: total });
  }
  remainder += text.slice(last);

  const plain = remainder.match(/\d+(?:[.,]\d+)?/g) ?? [];
  for (const raw of plain) {
    const value = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(value)) tokens.push({ raw, value });
  }
  return tokens;
}

/** Values a token may legitimately equal, allowing rounding and unit scaling. */
function derivations(value: number): number[] {
  // Only rounding and the minutes↔hours relation are allowed. Multiplying by
  // 1000 would make an unrelated step count "match" a sleep average, which would
  // hide a fabricated figure instead of flagging it.
  return [
    value,
    Math.round(value),
    Math.round(value * 10) / 10,
    Math.round(value * 100) / 100,
    value / 60,
    Math.round(value / 60),
  ];
}

function isWithin(value: number, candidate: number): boolean {
  const tolerance = Math.max(0.5, Math.abs(candidate) * 0.02);
  return Math.abs(value - candidate) <= tolerance;
}

/**
 * Rounding- and unit-tolerant comparison against a set of permitted values.
 *
 * Exported so a second grounding check (the briefing's number-traceability
 * guard) uses exactly this tolerance rather than a lookalike: two audits that
 * disagree about what counts as "the same figure" would be worse than one.
 */
export function numberIsTraceableTo(value: number, candidates: number[]): boolean {
  return candidates.some(candidate => isWithin(value, candidate));
}

/** Values a numeric token may legitimately restate (see `derivations`). */
export function derivationsOf(value: number): number[] {
  return derivations(value);
}

/**
 * Normalise a quoted value or a display string so the two can be compared.
 *
 * Case, spacing, thousands separators, the `≈`/`~` markers and dash variants are
 * cosmetic; removing them means "1,234" and "1234", "≈ 7h 32m" and "7h32m" and
 * "−3" and "-3" all compare equal. Unit words are not removed here — a display
 * string keeps its own unit, and a citation that matches it keeps it too.
 */
export function normalizeCitation(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2212\u2010-\u2015]/g, '-')
    .replace(/[≈~]/g, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Audit the numeric claims in observed + interpretation against the bundle.
 *
 * A claim is accepted when either
 *
 *   * its value matches a number the bundle contains (allowing rounding and the
 *     minutes↔hours relation), or
 *   * the cited text — normalised for case, spacing, thousands separators,
 *     `≈`/`~`, unit suffixes and `%` — appears in one of the `display` strings
 *     the model was given, or
 *   * its value matches a number stated by one of those display strings
 *     ("7h 32m" states 452, "120 mg" states 120).
 *
 * Flexible matching is the point: the model is asked to quote "7h 32m" rather
 * than 451.9407407407408, and that quote must count as grounded. A figure that
 * matches none of the three is reported — it is never silently dropped, and
 * nothing is invented to explain it.
 */
export function checkGrounding(
  answer: AnalystAnswer,
  bundle: RetrievalBundle,
  system: UnitSystem = 'metric'
): AnalystGrounding {
  const displays = collectDisplayStrings(bundle, system).map(normalizeCitation).filter(d => d.length > 0);
  const allowed = [
    ...collectBundleNumbers(bundle),
    // Numbers the display strings themselves state. Nothing is scaled: an
    // invented unit conversion must not become a match, so no ×1000 for "1.7K".
    ...displays.flatMap(display => extractNumericTokens(display).map(token => token.value)),
  ].flatMap(derivations);
  const text = [...answer.observed, ...answer.interpretation].join(' ');
  const tokens = extractNumericTokens(text);

  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (allowed.some(candidate => isWithin(token.value, candidate))) continue;
    const cited = normalizeCitation(token.raw);
    if (cited.length > 0 && displays.some(display => display.includes(cited))) continue;
    if (seen.has(token.raw)) continue;
    seen.add(token.raw);
    unmatched.push(token.raw);
  }

  return { checked: tokens.length, unmatched: unmatched.slice(0, MAX_UNMATCHED_REPORTED) };
}