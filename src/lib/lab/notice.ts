// ── The educational notice, in one place ────────────────────────────────────
//
// The rest of the app states this same sentence (the analyst service owns the
// canonical copy as EDUCATIONAL_NOTICE). It is repeated here as a literal for
// one reason only: the analyst service is server-side and must not be pulled
// into a client bundle to read a constant. notice.test.ts asserts the two
// strings are identical, so a change in either place fails the suite instead of
// quietly drifting.
//
// What it says matters: an interval is a population reference interval, this is
// educational information about the reader's own imported records, and it is
// not medical advice, not a diagnosis and not a substitute for a clinician.

export const LAB_EDUCATIONAL_NOTICE =
  'Educational information about your own recorded data. Not medical advice, not a diagnosis, and not a substitute for a clinician.';

/**
 * The second, lab-specific disclosure: a population reference interval covers
 * the central ~95% of a healthy reference group, so about one healthy person in
 * twenty falls outside it by chance alone.
 */
export const LAB_INTERVAL_NOTICE =
  'A reference interval is a population range for a reference group, not a personal target: roughly one healthy person in twenty falls outside it by chance alone. “Out of range” is not a diagnosis.';

/** Where an imported value came from, stated wherever one is shown. */
export const LAB_SOURCE_NOTICE =
  'Every value here was imported from a PDF you uploaded and is shown exactly as the document printed it. Vital does not measure these values and does not convert them.';
