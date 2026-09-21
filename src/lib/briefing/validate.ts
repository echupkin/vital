// ── Today's briefing: validation and the number guard ────
//
// A model reply is untrusted text. Nothing it returns reaches the hero until it
// has been read, capped and — above all — audited:
//
//   * every numeral in the headline, the body and the recommendations must be
//     traceable to the context the model was given (rounding and the
//     minutes↔hours relation are allowed, exactly as the analyst's grounding
//     audit allows them). One untraceable figure ⇒ the whole text is discarded
//     and the computed fallback is rendered instead. A fabricated number is
//     never published.
//   * clinical vocabulary the product forbids fails closed the same way.
//   * the body is capped at BRIEFING_BODY_MAX_WORDS and the recommendation list
//     at BRIEFING_MAX_RECOMMENDATIONS. Over-length prose is trimmed at a
//     sentence boundary and the trim is reported, never applied silently.
//
// Nothing is fabricated on failure: a reply that cannot be read is a failure,
// and the caller renders the computed briefing instead.

import { extractJsonObject } from '../analyst/validate';
import type { BriefingContext } from './context';
import { BRIEFING_BODY_MAX_WORDS, BRIEFING_MAX_RECOMMENDATIONS } from './prompt';
import type { BriefingTraceability } from './types';
import { auditBriefingNumbers } from './attribution-guard';

export const MAX_HEADLINE_CHARS = 200;
export const MAX_BODY_CHARS = 1200;
export const MAX_RECOMMENDATION_CHARS = 240;

/** Clinical vocabulary the briefing must never use. Checked, not merely asked for. */
export const FORBIDDEN_COPY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bnormal(ly|s|ised|ized|ise|ize)?\b/i, label: 'the word "normal"' },
  { pattern: /\babnormal\w*\b/i, label: 'the word "abnormal"' },
  { pattern: /\bdiagnos\w*/i, label: 'a diagnostic claim' },
  { pattern: /\bprescrib\w*/i, label: 'a prescribing claim' },
  { pattern: /\bmedication\b/i, label: 'a medication reference' },
  { pattern: /\bdosage\b|\bdose\b|\bmilligram\w*\b/i, label: 'dosing language' },
  { pattern: /\bsupplement\w*\b/i, label: 'a supplement recommendation' },
  { pattern: /\bsee (a|your|the) (clinician|doctor|physician|nurse|professional)\b/i, label: 'a referral' },
  { pattern: /\bconsult (a|your|the) (clinician|doctor|physician|professional)\b/i, label: 'a referral' },
  { pattern: /\btreatment\b/i, label: 'a treatment claim' },
];

export interface BriefingText {
  headline: string;
  body: string;
  recommendations: string[];
}

export type { BriefingTraceability };

export interface BriefingValidation {
  ok: boolean;
  text: BriefingText | null;
  reason: string | null;
  traceability: BriefingTraceability;
  /** Non-fatal repairs that were applied, stated so they are not silent. */
  adjustments: string[];
}

function coerceText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Trim prose to a word ceiling at the last sentence boundary inside it, or at
 * the word boundary when the text has no sentence break to cut on.
 */
export function clipToWords(text: string, maxWords: number): { text: string; clipped: boolean } {
  if (wordCount(text) <= maxWords) return { text, clipped: false };
  const words = text.split(/\s+/).filter(Boolean);
  const head = words.slice(0, maxWords).join(' ');
  const boundary = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (boundary > 0 && wordCount(head.slice(0, boundary + 1)) >= Math.floor(maxWords / 2)) {
    return { text: head.slice(0, boundary + 1).trim(), clipped: true };
  }
  return { text: `${head}…`, clipped: true };
}

// ── Number traceability ─────────────────────────────────

/**
 * Every number the context actually contains, including numbers inside strings.
 *
 * The context is serialized once and every numeric run is collected, so a
 * restated date, day count or window length is traceable while an invented
 * figure is not. Signs are not collected: "2026-08-19" would otherwise yield -8
 * and -19, and a negative delta's magnitude is what a restatement looks like.
 *
 * This is the same rule the analyst's grounding audit applies to its bundle.
 */
export function collectContextNumbers(context: BriefingContext): number[] {
  const serialized = JSON.stringify(context);
  const matches = serialized.match(/\d+(?:\.\d+)?/g) ?? [];
  const numbers: number[] = [];
  for (const match of matches) {
    const value = Number(match);
    if (Number.isFinite(value)) numbers.push(value);
  }
  return numbers;
}

/**
 * Every ready-formatted string in the context: `"7h 5m"`, `"66.3 bpm"`,
 * `"Sep 12 – Sep 18"`, `"2026-09-18"`.
 *
 * The model is instructed to quote these verbatim, so they are what a citation
 * is measured against. Without them a legitimate quote of a *duration* would be
 * rejected: `"7h 5m"` appears in the payload as that string, but the number 425
 * is nowhere in the JSON, and a guard that only compared numbers would call the
 * model's own instruction-following a fabrication.
 */
export function collectContextDisplayStrings(context: BriefingContext): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/\d/.test(value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(context);
  return out;
}

/**
 * Audit every numeral in the generated text against the supplied context.
 *
 * Delegates to the metric-aware guard (attribution-guard.ts), which requires a
 * number not only to appear in the context but to belong to the metric the
 * claim is about: a value the context records for HRV may not be published
 * under a `bpm` label even though it exists. See that module for exactly what
 * rounding, unit restatement and derivation are allowed.
 */
export function checkBriefingTraceability(text: BriefingText, context: BriefingContext): BriefingTraceability {
  return auditBriefingNumbers(text, context).traceability;
}

/** True when the text uses vocabulary the product forbids. */
export function forbiddenCopyIn(text: BriefingText): string[] {
  const haystack = [text.headline, text.body, ...text.recommendations].join(' ');
  const hits: string[] = [];
  for (const { pattern, label } of FORBIDDEN_COPY_PATTERNS) {
    if (pattern.test(haystack)) hits.push(label);
  }
  return [...new Set(hits)];
}

// ── Reply parsing ───────────────────────────────────────

/**
 * Read a model reply into briefing text.
 *
 * Returns `ok: false` (so the caller falls back to the computed briefing) when
 * the reply cannot be read, when it carries an untraceable figure, when it uses
 * forbidden vocabulary, or when it carries no heading/body at all.
 */
export function parseBriefingReply(raw: string, context: BriefingContext): BriefingValidation {
  const empty: BriefingTraceability = { checked: 0, unmatched: [] };
  const fail = (reason: string, traceability = empty): BriefingValidation => ({
    ok: false,
    text: null,
    reason,
    traceability,
    adjustments: [],
  });

  const json = extractJsonObject(raw);
  if (!json) {
    // A reply that opened a JSON object but never closed it was cut off — almost
    // always by the output budget, which a reasoning model spends on reasoning
    // first. Saying so is the difference between a five-minute fix and a mystery.
    const opened = raw.includes('{');
    return fail(
      opened
        ? "The model's reply started a JSON object but was cut off before it closed, so it could not be " +
            'read. Raising BRIEFING_MAX_TOKENS is the usual fix.'
        : "The model's reply did not contain a JSON object, so it could not be read."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail("The model's reply contained a JSON object that could not be parsed.");
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail("The model's reply was not a JSON object.");
  }

  const source = parsed as Record<string, unknown>;
  const adjustments: string[] = [];

  const headline = coerceText(source.headline, MAX_HEADLINE_CHARS);
  const bodyRaw = coerceText(source.body, MAX_BODY_CHARS);
  if (!headline || !bodyRaw) {
    return fail("The model's reply had no headline or no supporting paragraph, so nothing was published.");
  }

  const corrections: string[] = [];
  const list = Array.isArray(source.recommendations)
    ? source.recommendations
    : typeof source.recommendations === 'string'
      ? [source.recommendations]
      : [];
  const recommendations: string[] = [];
  for (const item of list) {
    const line = coerceText(item, MAX_RECOMMENDATION_CHARS);
    if (!line) continue;
    if (recommendations.length >= BRIEFING_MAX_RECOMMENDATIONS) {
      corrections.push(`dropped recommendations beyond the first ${BRIEFING_MAX_RECOMMENDATIONS}`);
      break;
    }
    recommendations.push(line);
  }
  if (list.length > recommendations.length && corrections.length === 0) {
    corrections.push('dropped empty recommendation entries');
  }
  if (recommendations.length === 0) {
    return fail('The model returned no recommendation with the briefing, so it was not published.');
  }

  const clipped = clipToWords(bodyRaw, BRIEFING_BODY_MAX_WORDS);
  if (clipped.clipped) corrections.push(`trimmed the paragraph to ${BRIEFING_BODY_MAX_WORDS} words`);

  const text: BriefingText = { headline, body: clipped.text, recommendations };
  adjustments.push(...corrections);

  const forbidden = forbiddenCopyIn(text);
  if (forbidden.length > 0) {
    return fail(`The briefing used language this product forbids (${forbidden.join(', ')}).`, {
      checked: 0,
      unmatched: [],
    });
  }

  const audit = auditBriefingNumbers(text, context);
  const traceability = audit.traceability;
  if (traceability.unmatched.length > 0) {
    // The offending tokens are not repeated in the reason: a figure that is not
    // in the data — or is under the wrong metric — is refused, not echoed into a
    // response body. An attribution violation is named as such, because "not in
    // the recorded data" would be untrue of a number that is in the data.
    const reason =
      audit.attributionViolations.length > 0
        ? `The briefing stated ${traceability.unmatched.length} figure(s) that the context records under ` +
          `a different measure (${audit.attributionViolations.join('; ')}), so it was discarded.`
        : `The briefing stated ${traceability.unmatched.length} figure(s) that are not in the recorded data, ` +
          'so it was discarded.';
    return fail(reason, traceability);
  }

  return { ok: true, text, reason: null, traceability, adjustments };
}