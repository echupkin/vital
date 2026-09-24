// ── Lab result status engine (pure) ──────────────────────────────────────────
//
// One value + one interval ⇒ one status. No I/O, no database, no clock: this
// module is a function of its inputs, which is what makes it testable and what
// keeps the judgement reproducible.
//
// WHAT THIS IS NOT. It is not a clinical assessment. The interval it scores
// against is either the one the owner's own report printed (which always wins)
// or a population fallback band from analytes.ts. A population interval covers
// the central ~95% of a healthy reference group, so about 1 in 20 healthy people
// falls outside it by chance alone. "Out of range" is not "disease".
//
// THE BAND RULE IS A PRESENTATION CONVENTION. Within [low, high] is `in_range`;
// beyond an endpoint by no more than 10% of the interval width is `slightly_*`;
// beyond that is `out_*`. See SLIGHTLY_OUT_FRACTION below: the percentage is a
// UI convenience, not a clinical threshold, and the UI must label it as
// arbitrary (the cited interval document says so too).
//
// A PRINTED FLAG IS CORROBORATION ONLY. High/H/HH/Low/L/LL never decides the
// verdict on its own, and when it disagrees with the interval it never silently
// overrides it: the interval's verdict is kept and the disagreement is recorded
// as a note.
//
// A BOUND IS NOT A MEASUREMENT. When a result was printed as a bound (`<30`,
// `> OR = 60`, the urinalysis grade `2+`) only a REGION is known. The row is
// `in_range` only when that whole region is provably inside the interval, and is
// otherwise `unscored_bound` — never `out_of_range` (a bound does not say the
// value is outside anything) and never silently `in_range` by assumption.
//
// A QUALITATIVE RESULT IS INTERPRETED ONLY AGAINST THE CLOSED VOCABULARY
// (POSITIVE / NEGATIVE / NONE SEEN — see ./qualitative.ts), and only against the
// expected value the report itself printed. It produces no number: `value` stays
// null, the printed text stays in `valueText`, and every call records its basis.
// Any other word (`YELLOW`, `TRACE`, `1+`) is left unscored with its reason.

import type { BandSex, LabBand } from './analytes';
import { qualitativeWord, resolveQualitative, uninterpretedNote, unresolvedNote } from './qualitative';

/**
 * How far beyond an endpoint still counts as "slightly" out, as a fraction of
 * the interval width. THIS IS A PRESENTATION CONVENTION, NOT A CLINICAL
 * THRESHOLD: it exists so the UI can distinguish a hair out from a mile out, and
 * nothing in the app may present it as medicine. The cited interval document
 * proposes exactly this rule and calls it arbitrary.
 */
export const SLIGHTLY_OUT_FRACTION = 0.1;

/** The verdict for one observation. */
export type ResultStatus =
  | 'in_range'
  | 'slightly_out_low'
  | 'slightly_out_high'
  | 'out_low'
  | 'out_high'
  /**
   * A QUALITATIVE result that is the opposite of the value the report printed as
   * its expected one (`POSITIVE` where the report expects `NEGATIVE`). It is out
   * of the report's own expectation — not a measurement, and not a diagnosis.
   */
  | 'out_of_expected'
  | 'unscored_no_range'
  | 'unscored_non_numeric'
  /** The result was printed as a bound (`<30`, `>39`, `1+`): the truth is unknown. */
  | 'unscored_bound';

/** The tone the UI pairs with the verdict, so colour is never the only signal. */
export type StatusTone = 'good' | 'caution' | 'attention' | 'neutral';

/**
 * A comparator the report printed instead of a plain value: `valueText` carries
 * these forms verbatim and the numeric `value` is the endpoint the document
 * PRINTED. `+` is the urinalysis grade (`1+`, `2+`) — a LOWER bound only.
 *
 * The extractor labels every bounded value: it stores the printed text in
 * `valueText` (e.g. `<30`, `> OR = 60`, `2+`) and the bound region is scored
 * conservatively by `scoreResult` below. The vocabulary is deliberately tiny and
 * is re-read here rather than trusted from any other field, because a bound that
 * cannot be read back is a bound that would silently be charted as a point.
 */
export type ValueBound = '<' | '<=' | '>' | '>=' | '+';

/**
 * The bound a printed result text carries, or null when it is a plain value.
 * Recognises the report's own stranded spelling (`< OR = 5` ⇒ `<=`).
 */
export function boundOf(valueText: string | null | undefined): ValueBound | null {
  const text = (valueText ?? '').trim();
  if (text === '') return null;
  // The comparator is matched case-insensitively because a report prints the
  // stranded spelling either way (`< OR = 0.2`, `< or = 18.4`).
  const prefixed = /^((?:<=|>=|<|>)(?:\s*or\s*=)?)\s*[\d.,]/i.exec(text);
  if (prefixed) {
    const compact = prefixed[1].replace(/\s+/g, '').replace(/or/i, '');
    if (compact.startsWith('<')) return compact.endsWith('=') ? '<=' : '<';
    return compact.endsWith('=') ? '>=' : '>';
  }
  // A urinalysis grade: the printed grade or more, unbounded above.
  if (/^[\d.,]+\+$/.test(text)) return '+';
  return null;
}

/** A resolved interval and where it came from. */
export interface ResolvedInterval {
  low: number | null;
  high: number | null;
  /** Which source gave the interval. Matches lab_results.ref_source. */
  origin: 'report' | 'reference_table' | 'manual' | 'none';
  /** The interval as it should be shown, e.g. "<200 mg/dL". */
  refText: string | null;
  /** Which age/sex band was used, when a fallback band was, e.g. "male 40-54". */
  refBasis: string | null;
  /** Any flag on the band itself (assay-dependent, sources disagreeing, …). */
  bandNote: string | null;
  /** The band used, when the interval came from the registry. */
  band: LabBand | null;
}

export interface StatusInput {
  value: number | null;
  valueText: string | null;
  /** The interval printed on the report, when it printed one. */
  refLow: number | null;
  refHigh: number | null;
  /**
   * The reference cell EXACTLY as the report printed it (`NEGATIVE`,
   * `< OR = 5 /HPF`). Used only to interpret a QUALITATIVE result against the
   * closed vocabulary (see ./qualitative.ts); it is never read as an interval.
   */
  refText?: string | null;
  /** The report's own marker as printed: High, H, HH, Low, L, LL, A, … */
  printedFlag: string | null;
  /** The resolved fallback band, when no printed interval was available. */
  band?: LabBand | null;
}

/** True when the interval or the printed expectation is an UPPER limit. */
function isUpperLimit(interval: ResolvedInterval, refText: string | null | undefined): boolean {
  if (interval.low === null && interval.high !== null) return true;
  return /^</.test((refText ?? '').trim());
}

export interface StatusResult {
  status: ResultStatus;
  /** A human label. Never colour, never a verdict word like "dangerous". */
  label: string;
  tone: StatusTone;
  /** Which interval was scored against, and where it came from. */
  interval: ResolvedInterval;
  /** Disclosures: flag disagreement, arbitrary-rule note, band flags. */
  notes: string[];
}

/** The printed flag, classified. `null` when the report printed no recognisable flag. */
export type FlagDirection = 'low' | 'high' | null;

/** Classify a printed flag token. Anything unrecognised is not a direction. */
export function flagDirection(printedFlag: string | null | undefined): FlagDirection {
  if (!printedFlag) return null;
  const token = printedFlag.trim().toUpperCase();
  if (['H', 'HH', 'HIGH', 'HI', 'ABOVE'].includes(token)) return 'high';
  if (['L', 'LL', 'LOW', 'LO', 'BELOW'].includes(token)) return 'low';
  return null;
}

/** Which side of the interval a value falls on, and by how much. */
function position(value: number, low: number | null, high: number | null): {
  side: 'inside' | 'low' | 'high';
  distance: number;
} {
  if (low !== null && value < low) return { side: 'low', distance: low - value };
  if (high !== null && value > high) return { side: 'high', distance: value - high };
  return { side: 'inside', distance: 0 };
}

/**
 * The allowance beyond an endpoint that still counts as "slightly" out.
 * Two-sided: 10% of the interval width. One-sided (only one endpoint known):
 * 10% of that single endpoint's magnitude, as the document specifies.
 */
export function allowanceFor(low: number | null, high: number | null): number {
  if (low !== null && high !== null) {
    const width = high - low;
    return width > 0 ? width * SLIGHTLY_OUT_FRACTION : 0;
  }
  if (low !== null) return Math.abs(low) * SLIGHTLY_OUT_FRACTION;
  if (high !== null) return Math.abs(high) * SLIGHTLY_OUT_FRACTION;
  return 0;
}

/**
 * Score one observation. PURE.
 *
 * BOUNDARY RULE, exactly: a value equal to an endpoint is IN RANGE. Both
 * endpoints are inclusive.
 */
export function scoreResult(input: StatusInput): StatusResult {
  const interval = resolveIntervalFor(input);
  const notes: string[] = [];

  if (input.value === null || !Number.isFinite(input.value)) {
    // A QUALITATIVE result is interpreted only against the closed vocabulary
    // (POSITIVE / NEGATIVE / NONE SEEN): see ./qualitative.ts. The row is called
    // in range / out of the report's own expectation with the basis recorded,
    // and NO number is produced for it — `value` stays null and the printed text
    // stays in `valueText`.
    const qualitative = resolveQualitative({
      valueText: input.valueText,
      expectedText: input.refText ?? null,
      // An expectation printed as `<5` or `< OR = 5 /HPF` is an upper limit.
      upperLimit: isUpperLimit(interval, input.refText),
      upperLimitValue: interval.high,
    });
    if (qualitative) {
      return {
        status: qualitative.status,
        label: labelFor(qualitative.status),
        tone: toneFor(qualitative.status),
        interval,
        notes: [qualitative.note],
      };
    }

    // Not in the vocabulary: this is reported even when no interval is known,
    // because the value's own form is the reason it cannot be scored. A word
    // OUTSIDE the vocabulary is refused with the vocabulary named; a word inside
    // it whose pair the vocabulary does not cover says what it compared.
    return {
      status: 'unscored_non_numeric',
      label: 'Not a number',
      tone: 'neutral',
      interval,
      notes: [
        qualitativeWord(input.valueText) === null
          ? uninterpretedNote(input.valueText, input.refText)
          : unresolvedNote(input.valueText, input.refText),
      ],
    };
  }

  if (interval.origin === 'none') {
    return {
      status: 'unscored_no_range',
      label: 'No reference interval',
      tone: 'neutral',
      interval,
      notes: [
        'No interval was printed on this report and no fallback band applies, so this result is left unscored rather than coloured against a guessed number.',
      ],
    };
  }

  // A BOUNDED result is not a measurement. A `<X` region can be called in range
  // only when the WHOLE region is inside the interval; a region with no end on
  // one side can never be shown to be inside a finite interval. Either way the
  // truth is unknown, and it is reported as unknown — never `out_of_range`, and
  // never silently `in_range`.
  const bound = boundOf(input.valueText);
  if (bound) {
    return boundedResult(bound, input.value as number, input.valueText ?? '', interval);
  }

  const value = input.value;
  const low = interval.low;
  const high = interval.high;
  const where = position(value, low, high);
  const allowance = allowanceFor(low, high);

  let status: ResultStatus;
  if (where.side === 'inside') {
    status = 'in_range';
  } else if (where.distance <= allowance) {
    status = where.side === 'low' ? 'slightly_out_low' : 'slightly_out_high';
  } else {
    status = where.side === 'low' ? 'out_low' : 'out_high';
  }

  // The printed flag is CORROBORATION ONLY. When it disagrees with the
  // interval's verdict, the verdict stands and the disagreement is disclosed.
  const flagged = flagDirection(input.printedFlag);
  if (flagged) {
    const verdictSide: FlagDirection =
      status === 'out_high' || status === 'slightly_out_high'
        ? 'high'
        : status === 'out_low' || status === 'slightly_out_low'
          ? 'low'
          : null;
    if (verdictSide === null) {
      notes.push(
        `The report marked this result "${input.printedFlag}" but the interval it printed or the fallback band places the value inside the range. The interval's verdict is shown; the flag is corroboration only and was not used to decide it.`,
      );
    } else if (verdictSide !== flagged) {
      notes.push(
        `The report's own flag ("${input.printedFlag}") points the other way from the interval. The interval's verdict is kept; the flag is corroboration only and never overrides the interval.`,
      );
    }
  } else if (input.printedFlag && input.printedFlag.trim().length > 0) {
    notes.push(
      `The report printed a marker ("${input.printedFlag}") that is not a recognised High/Low token, so it was not used.`,
    );
  }

  if (interval.origin === 'reference_table') {
    notes.push(
      'This interval is a general reference interval, not the interval printed on the report. It is a population range, not a personal target.',
    );
  }
  if (interval.origin === 'reference_table' || interval.origin === 'manual') {
    notes.push(
      `The "slightly out" boundary is a presentation convention (${Math.round(
        SLIGHTLY_OUT_FRACTION * 100
      )}% of the interval width), not a clinical threshold.`,
    );
  }
  if (interval.bandNote) notes.push(interval.bandNote);

  return { status, label: labelFor(status), tone: toneFor(status), interval, notes };
}

/**
 * Score a BOUNDED result. PURE, and deliberately conservative.
 *
 * The row is `in_range` ONLY when the entire region the bound describes is
 * provably inside the interval: an upper bound `<X` with the interval open at
 * the bottom (`low` absent or 0) and `X` at or below `high`. Anything else — a
 * bound region that reaches past an endpoint, or a region with no end on one
 * side at all — is `unscored_bound`, with the reason recorded. It is never
 * `out_of_range` (a bound does not say the value is outside anything) and never
 * `in_range` by assumption.
 */
function boundedResult(
  bound: ValueBound,
  value: number,
  shown: string,
  interval: ResolvedInterval
): StatusResult {
  const notes: string[] = [];
  const intervalText = interval.refText ?? 'the interval it carries';
  const verdict: ResultStatus = 'unscored_bound';

  if (bound === '<' || bound === '<=') {
    const opening = interval.low === null || interval.low === 0;
    const inside = opening && interval.high !== null && value <= interval.high;
    if (inside) {
      notes.push(
        `The result was printed as a bound ("${shown}"), so the value is known only to be at or below ${value}. Every value in that region lies inside the interval (${intervalText}), so the row is called in range — the basis is the printed bound, not a measurement.`
      );
      if (interval.origin === 'reference_table') {
        notes.push(
          'This interval is a general reference interval, not the interval printed on the report. It is a population range, not a personal target.'
        );
      }
      return { status: 'in_range', label: labelFor('in_range'), tone: toneFor('in_range'), interval, notes };
    }
    notes.push(
      interval.high === null
        ? `The result was printed as a bound ("${shown}") and the interval (${intervalText}) has no upper end printed, so the row cannot be scored: a region without an upper end cannot be compared with an interval that has none.`
        : `The result was printed as a bound ("${shown}"), so only a range of values is known: everything at or below ${value}. That region reaches outside the interval (${intervalText}), so part of it may lie outside the range and the row is left unscored rather than called out of range.`
    );
  } else {
    // `>` `>=` and the urinalysis grade `+`: the region has no upper end.
    notes.push(
      `The result was printed as a bound ("${shown}"), so the value is known only to be ${
        bound === '+' ? `the printed grade or more` : `at or beyond ${value}`
      }. The region the bound describes has no upper end, so it cannot be shown to lie inside the interval (${intervalText}); the row is left unscored rather than called out of range.`
    );
  }
  if (interval.origin === 'reference_table') {
    notes.push(
      'This interval is a general reference interval, not the interval printed on the report. It is a population range, not a personal target.'
    );
  }
  return { status: verdict, label: labelFor(verdict), tone: toneFor(verdict), interval, notes };
}

/** The human label for a verdict. Never a verdict word like "dangerous". */
export function labelFor(status: ResultStatus): string {
  switch (status) {
    case 'in_range':
      return 'In range';
    case 'slightly_out_low':
      return 'Slightly below range';
    case 'slightly_out_high':
      return 'Slightly above range';
    case 'out_low':
      return 'Below range';
    case 'out_high':
      return 'Above range';
    case 'out_of_expected':
      // A QUALITATIVE row: outside the value the report printed as its expected
      // one. The word says "out of range"; the row's note says what it rests on.
      return 'Out of range';
    case 'unscored_no_range':
      return 'No reference interval';
    case 'unscored_non_numeric':
      return 'Not a number';
    case 'unscored_bound':
      return 'Bounded result';
  }
}

/** The tone paired with a verdict, so colour is never the only signal. */
export function toneFor(status: ResultStatus): StatusTone {
  switch (status) {
    case 'in_range':
      return 'good';
    case 'slightly_out_low':
    case 'slightly_out_high':
      return 'caution';
    case 'out_low':
    case 'out_high':
    case 'out_of_expected':
      return 'attention';
    case 'unscored_no_range':
    case 'unscored_non_numeric':
    case 'unscored_bound':
      return 'neutral';
  }
}

/** True when the status is a numeric verdict against an interval. */
export function isScored(status: ResultStatus): boolean {
  return status !== 'unscored_no_range' && status !== 'unscored_non_numeric' && status !== 'unscored_bound';
}

// ── Interval resolution ─────────────────────────────────────────────────────

/**
 * Choose the interval to score against. THE PRINTED INTERVAL ALWAYS WINS: a
 * report's own interval is validated for its own method, so it is used whenever
 * the report printed one. Only when it printed none does the registry band
 * apply.
 */
export function resolveIntervalFor(input: {
  refLow: number | null;
  refHigh: number | null;
  refText?: string | null;
  band?: LabBand | null;
}): ResolvedInterval {
  if (input.refLow !== null || input.refHigh !== null) {
    return {
      low: input.refLow,
      high: input.refHigh,
      origin: 'report',
      refText: input.refText ?? printedIntervalText(input.refLow, input.refHigh),
      refBasis: null,
      bandNote: null,
      band: null,
    };
  }
  const band = input.band ?? null;
  if (!band) {
    return { low: null, high: null, origin: 'none', refText: null, refBasis: null, bandNote: null, band: null };
  }
  return {
    low: band.low ?? null,
    high: band.high ?? null,
    origin: 'reference_table',
    refText: band.refText,
    refBasis: basisLabel(band),
    bandNote: band.note ?? null,
    band,
  };
}

function printedIntervalText(low: number | null, high: number | null): string | null {
  if (low !== null && high !== null) return `${low} - ${high}`;
  if (low !== null) return `> ${low}`;
  if (high !== null) return `< ${high}`;
  return null;
}

/** A short label for the band used, e.g. "male 40-54" or "any". */
export function basisLabel(band: LabBand): string {
  const parts: string[] = [band.sex];
  if (band.minAge !== undefined && band.maxAge !== undefined) parts.push(`${band.minAge}-${band.maxAge} y`);
  else if (band.minAge !== undefined) parts.push(`>=${band.minAge} y`);
  else if (band.maxAge !== undefined) parts.push(`<=${band.maxAge} y`);
  return parts.join(' ');
}

// ── Band selection ──────────────────────────────────────────────────────────

export interface BandContext {
  /** Age in whole years at the observation date, or null when unknown. */
  age: number | null;
  /** The owner's sex, or null when unset. NEVER inferred. */
  sex: 'male' | 'female' | null;
}

export interface BandSelection {
  band: LabBand | null;
  /** Why no band was selected, when one was not. */
  reason: 'no_bands' | 'sex_unset' | 'age_unknown' | 'no_band_for_age_sex' | null;
}

/**
 * Choose the band for a person's age and sex.
 *
 * SEX IS NEVER ASSUMED. A band bound to `male`/`female` is usable only when
 * `sex` is set; with sex unset a sex-specific band is NOT used and the result
 * stays unscored. Age-bound bands are used only when the age is known; with no
 * date of birth a band that constrains age cannot be confirmed and is skipped.
 *
 * Among the usable bands the most specific wins: a sex-specific band over a
 * sex-pooled one, and an age-constrained band over an unconstrained one.
 */
export function resolveBand(bands: LabBand[] | null | undefined, context: BandContext): BandSelection {
  if (!bands || bands.length === 0) return { band: null, reason: 'no_bands' };

  const ageKnown = context.age !== null && Number.isFinite(context.age);
  const sexKnown = context.sex === 'male' || context.sex === 'female';

  const sexUsable = (band: LabBand): boolean =>
    band.sex === 'any' || (sexKnown && band.sex === (context.sex as BandSex));

  const ageUsable = (band: LabBand): boolean => {
    if (band.minAge === undefined && band.maxAge === undefined) return true;
    if (!ageKnown) return false;
    const age = context.age as number;
    if (band.minAge !== undefined && age < band.minAge) return false;
    if (band.maxAge !== undefined && age > band.maxAge) return false;
    return true;
  };

  const candidates = bands.filter(band => sexUsable(band) && ageUsable(band));
  if (candidates.length > 0) {
    const specific = [...candidates].sort((a, b) => specificity(b) - specificity(a));
    return { band: specific[0] ?? null, reason: null };
  }

  // Nothing usable: say why, so the UI can explain rather than show a bare gap.
  const anySexUsable = bands.some(sexUsable);
  if (!anySexUsable) return { band: null, reason: 'sex_unset' };
  if (!ageKnown && bands.some(band => sexUsable(band) && (band.minAge !== undefined || band.maxAge !== undefined))) {
    return { band: null, reason: 'age_unknown' };
  }
  return { band: null, reason: 'no_band_for_age_sex' };
}

function specificity(band: LabBand): number {
  let score = 0;
  if (band.sex !== 'any') score += 2;
  if (band.minAge !== undefined || band.maxAge !== undefined) score += 1;
  return score;
}

// ── Age ─────────────────────────────────────────────────────────────────────

/**
 * Age in whole years on a given ISO date, from an ISO date of birth.
 * Returns null when either date is missing or unparseable — never a guess.
 */
export function ageOn(dateOfBirth: string | null | undefined, onDate: string | null | undefined): number | null {
  if (!dateOfBirth || !onDate) return null;
  const dob = parseIsoDate(dateOfBirth);
  const on = parseIsoDate(onDate);
  if (!dob || !on) return null;
  let age = on.year - dob.year;
  if (on.month < dob.month || (on.month === dob.month && on.day < dob.day)) age -= 1;
  return age >= 0 ? age : null;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Resolve the band for one observation, given the person's DOB/sex and the date
 * the observation belongs to. Returns the band, or the reason none applied.
 */
export function bandForObservation(
  bands: LabBand[] | null | undefined,
  profile: { dateOfBirth?: string | null; sex?: 'male' | 'female' | null } | null | undefined,
  onDate: string
): BandSelection {
  const age = ageOn(profile?.dateOfBirth ?? null, onDate);
  const sex = profile?.sex ?? null;
  return resolveBand(bands, { age, sex });
}