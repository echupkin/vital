// ── Analyte descriptions ────────────────────────────────────────────────────
//
// Patient-facing copy about what an analyte is, and what a high or low value may
// mean. The copy was written and audited by the research pass; the per-entry
// source and the audit outcome for every sentence live in
// `analyte-descriptions SOURCES.md`, beside the JSON.
//
// RENDERED VERBATIM. Nothing here rewords, trims, shortens or "improves" the
// copy: the audit trail is only meaningful if the text on screen is the text
// that was checked against the cited page. The ONE truncation that is allowed is
// the Lab card's short line, which is a presentation concern and lives in
// `./view` (`cardDescription`) so it can be tested.
//
// KEYED BY THE REGISTRY'S CANONICAL KEY, looked up through the registry. A
// stored key the extractor wrote (e.g. `protein_total`) resolves to its registry
// entry first, so a description is found by what the analyte IS, not by which
// spelling of its key happened to be stored. An analyte with no entry returns
// null and is rendered as absent — never as an empty box.
//
// A SECOND SPELLING OF ONE MEASUREMENT SHARES THE FIRST ONE'S COPY. The series
// read model keeps the differential percentage a report prints as `BA%` (stored
// key `basophils_pct`) as its own series, named apart from the one a bare
// `BASOPHILS` produces — but it is the same measurement, so it must show the
// same audited sentence. `COPY_OF_KEY` below points each such key at the entry
// whose copy it carries; nothing is invented, retyped or reworded.
//
// RESOLVED PER SERIES, NOT PER KEY. An analyte can be measured on more than one
// specimen: `glucose` is blood sugar on a chemistry panel and a dipstick reading
// on a urinalysis one, and the two are different measurements. Copy about the
// blood test shown on the urine card would be a factual error about what was
// tested, so the lookup takes the series' specimen and will NOT serve an entry
// whose own specimen contradicts it. See `seriesDescription`.

import raw from './analyte-descriptions.json';
import { analyteByKey } from './analytes';
import type { PanelSpecimen } from './panel';

export interface AnalyteDescription {
  /** What the analyte is, in one or two plain sentences. */
  whatItIs: string;
  /** What a high value may mean, when the source states it. */
  ifHigh?: string;
  /** What a low value may mean, when the source states it. */
  ifLow?: string;
  /** The cited page's own title, shown as the visible link text. */
  sourceTitle: string;
  /** The cited page, opened in a new tab so the sentence can be checked. */
  sourceUrl: string;
  /**
   * Which specimen this copy describes. A urinalysis entry declares `urine`; an
   * entry that declares nothing describes the analyte's ordinary, non-urine
   * report (so it behaves as `other`). The field exists so the lookup can refuse
   * to serve, say, blood-glucose copy to a urine series — set it whenever the
   * copy names or implies a specimen. See the header of
   * `analyte-descriptions SOURCES.md`.
   */
  specimen?: PanelSpecimen;
}

/**
 * The specimen an entry's copy describes: its own declaration when it makes one,
 * and `other` — the analyte's ordinary, non-urine report — when it does not.
 */
function describesSpecimen(entry: AnalyteDescription): PanelSpecimen {
  return entry.specimen ?? 'other';
}

// Imported JSON cannot carry the narrow `specimen` union — TypeScript widens it
// to `string` — so the table is asserted to the interface here. That assertion is
// paid for by a test: every `specimen` the file actually declares must be one of
// the two allowed values, so a typo cannot slip through the cast.
const DESCRIPTIONS: Record<string, AnalyteDescription> = raw as unknown as Record<
  string,
  AnalyteDescription
>;

/** Every canonical key that has a description. */
export const DESCRIBED_KEYS: string[] = Object.keys(DESCRIPTIONS);

/**
 * Keys whose SERIES is a separate measurement of the same thing as another
 * registry entry, and which therefore carry that entry's audited copy.
 *
 * The differential percentages are stored under two spellings — a report that
 * prints a bare `NEUTROPHILS` writes `neutrophils`, one that prints its columns
 * as `NE%`/`BA%` writes `neutrophils_pct`/`basophils_pct` — and the series read
 * model keeps each spelling as its own series (`../db/lab-store`), each with its
 * own display name so the two can never be confused. They are the SAME
 * measurement, though, so the second spelling must show the same sentence about
 * what a neutrophil (or basophil, …) percentage is, rather than the empty box an
 * undescribed key renders. Nothing is invented and nothing is reworded: the
 * copied entry is the one the research pass audited.
 */
const COPY_OF_KEY: Record<string, string> = {
  neutrophils_pct: 'neutrophils',
  lymphocytes_pct: 'lymphocytes',
  monocytes_pct: 'monocytes',
  eosinophils_pct: 'eosinophils',
  basophils_pct: 'basophils',
};

/** The entry a key's copy lives under: the key itself, or the entry it copies. */
function copyKeyFor(canonicalKey: string): string {
  return COPY_OF_KEY[canonicalKey] ?? canonicalKey;
}

/**
 * The description for a stored or canonical analyte key, or null when the
 * analyte has none. This is the SPECIMEN-AGNOSTIC lookup: it ignores which
 * specimen a series came from. It answers "does this analyte have copy at all",
 * which is what the coverage tests pin; a page that knows its series' specimen
 * must use `seriesDescription` so it cannot be served the wrong specimen's copy.
 */
export function analyteDescription(key: string): AnalyteDescription | null {
  if (!key) return null;
  const canonical = analyteByKey(key)?.key ?? key;
  return DESCRIPTIONS[copyKeyFor(canonical)] ?? null;
}

/**
 * The pure resolution rule, over any entry table: the description for one
 * series — an analyte together with the specimen its rows were printed under.
 *
 * Two steps, and the second is deliberately narrow:
 *   1. a SPECIMEN-QUALIFIED entry (`<key>_<specimen>`, e.g. `glucose_urine`) wins,
 *      because it is the entry written for this specimen;
 *   2. the BASE entry (`<key>`) is used ONLY when its own specimen does not
 *      contradict the series': an entry that declares `urine` never serves an
 *      `other` series, and an entry that declares nothing (or `other`) never
 *      serves a `urine` series.
 *
 * A series whose specimen differs from the base entry's renders NOTHING rather
 * than the wrong specimen's copy. Taking the table as an argument keeps the rule
 * itself unit-testable against a fixture, apart from the shipped copy.
 */
export function descriptionForSeries(
  entries: Record<string, AnalyteDescription>,
  analyteKey: string,
  specimen: PanelSpecimen
): AnalyteDescription | null {
  if (!analyteKey) return null;
  const qualified = entries[`${analyteKey}_${specimen}`];
  if (qualified && describesSpecimen(qualified) === specimen) return qualified;
  const base = entries[analyteKey];
  if (base && describesSpecimen(base) === specimen) return base;
  return null;
}

/**
 * The description for one SERIES, resolved through the registry: `(analyte,
 * specimen)` rather than the analyte key alone. A series with no honest entry —
 * no specimen-qualified copy and no base entry its specimen does not contradict
 * — returns null and is rendered as absent. Never invents an entry: an absent
 * thing is absent.
 */
export function seriesDescription(
  analyteKey: string,
  specimen: PanelSpecimen = 'other'
): AnalyteDescription | null {
  if (!analyteKey) return null;
  const canonical = analyteByKey(analyteKey)?.key ?? analyteKey;
  return descriptionForSeries(DESCRIPTIONS, copyKeyFor(canonical), specimen);
}