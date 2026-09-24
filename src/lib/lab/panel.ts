// ── Panels and specimens ─────────────────────────────────────────────────────
//
// A lab document prints its results in SECTIONS, each under a panel heading, and
// different sections can come from different SPECIMENS. The one that matters here
// is urine: a urinalysis page prints `glucose NEGATIVE` — a dipstick reading —
// under a heading such as `URINALYSIS, COMPLETE`, while a chemistry page prints
// `GLUCOSE 78 mg/dL`. Both resolve to the analyte key `glucose`, and until this
// gate both landed in ONE series, so a dipstick result was drawn, scored and
// "difference"-ed against a mg/dL series.
//
// THE PANEL IS THE REPORT'S OWN STATEMENT ABOUT THE SPECIMEN. This module reads
// exactly one thing out of the stored panel label: whether the heading the
// document printed names a urinalysis panel. It never infers a specimen from an
// analyte's name, its unit or its value — a label that says `URINALYSIS` is the
// document saying "this row is urine", and nothing else is claimed.
//
// HOW A SERIES IS IDENTIFIED. By (CANONICAL analyte key, specimen): the stored
// `analyte_key` is resolved through the registry's key+alias map first, so two
// spellings of one analyte (`bun` / `urea_nitrogen_bun`) form ONE series, and
// every non-urine row of an analyte stays in that one series however many panels
// it came from — `cholesterol` printed under a LabCorp `Lipid Panel` trend and
// under a Quest `LIPID PANEL WITH RATIOS` is the same measurement and must not be
// split into two charts — while a urinalysis row can never join it. Two specimens
// of one analyte are only split apart when both exist (see `seriesIdOf`), so a
// urine-only analyte keeps its single metric and no empty twin is manufactured.
//
// TYPES ONLY + DATA: no imports, so this is safe in the browser bundle.

/** The two things a stored row's panel can say about where it came from. */
export type PanelSpecimen = 'urine' | 'other';

/**
 * Panel headings that are a URINALYSIS: the report's own word for a urine
 * specimen. Everything else — a chemistry, lipid, thyroid, haematology or
 * hormone heading, and every LabCorp trend export — is `other`.
 *
 * `urine` covers `URINALYSIS, COMPLETE`, `URINALYSIS, MICROSCOPIC WITH REFLEX TO
 * CULTURE`, a `24 hour urine` collection and the LabCorp `Urinalysis` trend.
 */
const URINE_PANEL = /\b(?:urinalysis|urine|uro)\b/i;

/** True when a panel heading names a urinalysis. */
export function isUrinePanel(panel: string | null | undefined): boolean {
  return typeof panel === 'string' && URINE_PANEL.test(panel);
}

/**
 * Which specimen a stored row's panel puts it in. A row whose page printed no
 * panel heading is `other`: the document made no statement about its specimen, so
 * it is kept with the analytes' ordinary series rather than being moved into the
 * urine one on a guess.
 */
export function specimenOfPanel(panel: string | null | undefined): PanelSpecimen {
  return isUrinePanel(panel) ? 'urine' : 'other';
}

/** The separator between an analyte key and its specimen, inside a series id. */
export const URINE_SERIES_SEPARATOR = '~';

/**
 * The public id of one series — the key the Lab page and the detail route use.
 *
 * A `split` analyte has both a blood and a urine series; each gets its own id so
 * both are reachable and neither shadows the other. An analyte that is not split
 * keeps its bare key, which is what every stored link and the router already use.
 */
export function seriesIdOf(analyteKey: string, specimen: PanelSpecimen, split: boolean): string {
  return split && specimen === 'urine' ? `${analyteKey}${URINE_SERIES_SEPARATOR}urine` : analyteKey;
}

/**
 * The analyte key behind a series id: `glucose~urine` addresses the `glucose`
 * analyte's urine series, and everything keyed by the analyte (the registry, the
 * description) is looked up with this. An id without a specimen suffix is its own
 * analyte key.
 */
export function analyteKeyOfSeriesId(seriesId: string): string {
  const cut = seriesId.indexOf(URINE_SERIES_SEPARATOR);
  return cut === -1 ? seriesId : seriesId.slice(0, cut);
}

/**
 * The label of one series. Two specimens of the same analyte are labelled apart —
 * the reader must never have to guess which of the two charts holds the dipstick
 * result — and nothing else is relabelled.
 */
export function seriesNameOf(displayName: string, specimen: PanelSpecimen, split: boolean): string {
  if (!split) return displayName;
  return specimen === 'urine' ? `${displayName} (urine)` : `${displayName} (blood)`;
}
