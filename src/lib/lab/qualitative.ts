// ── The closed qualitative vocabulary (pure) ─────────────────────────────────
//
// A lab report sometimes prints a RESULT as a word rather than a number:
// `NEGATIVE`, `POSITIVE`, `NONE SEEN`. This module is the ONE place that decides
// what such a word may be scored against, and it is deliberately CLOSED:
//
//     POSITIVE · NEGATIVE · NONE SEEN        (case-insensitive, nothing else)
//
// Anything else — `YELLOW`, `TRACE`, `CLEAR`, `1+` — is NOT interpreted here.
// Those rows keep their honest unscored behaviour with the reason recorded, and
// no number is ever invented for them.
//
// WHAT A RESOLUTION MAY REST ON. Exactly three things, and each one is stated in
// the note so the row can never be read as more than it is:
//
//   * MATCH    — the result is the same word the report printed as its own
//                expected value (`NEGATIVE` vs an expected `NEGATIVE`). A
//                per-field suffix on the expected value (`NONE SEEN /HPF`,
//                `NONE SEEN /LPF`) is ignored when the two are compared, and the
//                printed text is kept as evidence.
//   * OPPOSITE — `POSITIVE` where the report expects `NEGATIVE`, or the other
//                way round. That is the REPORT'S OWN CONVENTION for the column
//                the result was printed under. It is not a diagnosis.
//   * ZERO     — `NONE SEEN` means the thing was not seen, i.e. ZERO. Zero
//                satisfies an expectation that is an upper limit at or above
//                zero (`< OR = 5 /HPF`). No number is invented: the fact that
//                zero satisfies it is the whole basis.
//
// A QUALITATIVE ROW IS STILL NOT A MEASUREMENT. Nothing here produces a value:
// `value` stays null, `value_text` keeps the printed text, and the caller shows
// the note as the basis of the call. This module has no imports, so both the
// importer and the status engine can use it and cannot disagree.

/** The whole vocabulary. There is no other word this importer interprets. */
export type QualitativeWord = 'positive' | 'negative' | 'none_seen';

/** The vocabulary as the reader sees it, for the wording of every refusal. */
export const QUALITATIVE_VOCABULARY = 'POSITIVE, NEGATIVE, NONE SEEN';

/** Whitespace collapsed, trimmed, upper-cased — the report's own spelling kept. */
function normalise(text: string | null | undefined): string {
  return (text ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * The printed text without a per-field suffix: `NONE SEEN /HPF` ⇒ `NONE SEEN`.
 * The suffix is what distinguishes one field's expectation from another
 * (`/HPF` per high-power field, `/LPF` per low-power field); it does not change
 * what was seen, so it is dropped when the two texts are compared. The printed
 * text itself is never altered — only the comparison ignores the suffix.
 */
export function stripFieldSuffix(text: string | null | undefined): string {
  return (text ?? '')
    .trim()
    .replace(/\s*\/\s*[A-Za-z][A-Za-z0-9]*\s*$/, '')
    .trim();
}

/** True when the text carried a per-field suffix that the comparison drops. */
function hadFieldSuffix(text: string | null | undefined): boolean {
  const raw = normalise(text);
  return raw !== '' && stripFieldSuffix(raw).toUpperCase() !== raw;
}

/**
 * The vocabulary word a printed text is, or null when it is not in the
 * vocabulary. A per-field suffix is ignored, so `NONE SEEN /LPF` is `none_seen`.
 */
export function qualitativeWord(text: string | null | undefined): QualitativeWord | null {
  const core = normalise(stripFieldSuffix(text));
  if (core === 'POSITIVE') return 'positive';
  if (core === 'NEGATIVE') return 'negative';
  if (core === 'NONE SEEN') return 'none_seen';
  return null;
}

/** The verdict a qualitative row can be given. */
export type QualitativeStatus = 'in_range' | 'out_of_expected';

export interface QualitativeResolution {
  status: QualitativeStatus;
  /** WHAT the verdict rests on, in the reader's words. Never a clinical claim. */
  note: string;
}

export interface QualitativeInput {
  /** The result exactly as the report printed it (`NEGATIVE`, `NONE SEEN`). */
  valueText: string | null | undefined;
  /** The expected value the report printed beside it, or null when it printed none. */
  expectedText: string | null | undefined;
  /** True when the printed expectation is an UPPER limit (`< OR = 5 /HPF`). */
  upperLimit?: boolean;
  /** The numeric upper limit the report printed, when it printed one. */
  upperLimitValue?: number | null;
}

/** The words as the note quotes them: the printed text, or "none printed". */
function quoted(text: string | null | undefined): string {
  const shown = (text ?? '').trim();
  return `"${shown}"`;
}

const isPolar = (word: QualitativeWord): boolean => word === 'positive' || word === 'negative';

/**
 * Resolve a qualitative result against the expected value the report printed.
 *
 * Returns null when the result is not in the vocabulary at all — the caller then
 * keeps its own honest unscored behaviour (see `uninterpretedNote` for the
 * wording). Otherwise returns the verdict and the basis for it. A combination
 * the vocabulary does not cover is NOT guessed at; use `unresolvedNote` for it.
 */
export function resolveQualitative(input: QualitativeInput): QualitativeResolution | null {
  const word = qualitativeWord(input.valueText);
  if (word === null) return null;

  const expectedWord = qualitativeWord(input.expectedText);
  const shown = (input.valueText ?? '').trim();

  if (expectedWord !== null && expectedWord === word) {
    const suffix = hadFieldSuffix(input.expectedText)
      ? ' The per-field suffix on the expected value (such as /HPF or /LPF) does not change what was seen, so it is ignored when the two are compared.'
      : '';
    return {
      status: 'in_range',
      note: `The basis for calling this row in range is that the result matches the expected value the report printed: the result is ${quoted(
        shown
      )} and the report's expected value is ${quoted(input.expectedText)}.${suffix} No number is involved and nothing was measured.`,
    };
  }

  if (isPolar(word) && expectedWord !== null && isPolar(expectedWord) && expectedWord !== word) {
    return {
      status: 'out_of_expected',
      note: `The report prints ${normalise(input.expectedText)} as the expected result and this value is ${normalise(
        shown
      )}. That is the report's own convention for the result it expects — it is not a diagnosis, and no number is invented for the row.`,
    };
  }

  if (word === 'none_seen' && (input.upperLimit === true || startsWithUpperBound(input.expectedText))) {
    const limit = input.upperLimitValue ?? null;
    if (limit !== null && limit < 0) {
      return {
        status: 'out_of_expected',
        note: `Nothing was seen: the result ${quoted(
          shown
        )} means zero, and the expectation the report printed (${quoted(
          input.expectedText
        )}) is an upper limit BELOW zero, which zero does not satisfy. No number is invented for the result.`,
      };
    }
    return {
      status: 'in_range',
      note: `Nothing was seen: the result ${quoted(
        shown
      )} means zero, and the expectation the report printed (${quoted(
        input.expectedText
      )}) is an upper limit, so zero satisfies it. No number is invented for the result — the basis is that nothing was seen and the printed expectation is an upper limit.`,
    };
  }

  return null;
}

/** True when a printed expectation is an upper limit by its own comparator. */
function startsWithUpperBound(text: string | null | undefined): boolean {
  return /^</.test((text ?? '').trim());
}

/**
 * Why a result that is not in the vocabulary is left unscored. The wording names
 * the vocabulary, so a reader can see the rule that was applied rather than
 * being left to guess why a word was refused.
 */
export function uninterpretedNote(valueText: string | null | undefined, expectedText: string | null | undefined): string {
  const shown = (valueText ?? '').trim();
  const expected = (expectedText ?? '').trim();
  if (expected === '') {
    return `The result was printed as text (${quoted(
      shown
    )}) and the report printed no expected value to compare it with, so it is not scored.`;
  }
  return `The result was printed as text (${quoted(
    shown
  )}), which is not one of the qualitative values this importer interprets (${QUALITATIVE_VOCABULARY}), so the row is left unscored and no number is invented for it.`;
}

/**
 * Why a combination the vocabulary does not cover was left unscored. Naming the
 * three resolutions makes it clear that nothing was guessed.
 */
export function unresolvedNote(valueText: string | null | undefined, expectedText: string | null | undefined): string {
  const shown = (valueText ?? '').trim();
  const expected = (expectedText ?? '').trim();
  if (expected === '') {
    return `The result was printed as text (${quoted(
      shown
    )}) and the report printed no expected value to compare it with, so it is not scored.`;
  }
  return `The result was printed as ${quoted(shown)} and the expected value the report printed is ${quoted(
    expected
  )}. This importer resolves a qualitative result only when it matches the expected value, when it is the opposite of a POSITIVE/NEGATIVE pair, or when "NONE SEEN" satisfies an upper limit — so the row is left unscored rather than guessed at.`;
}
