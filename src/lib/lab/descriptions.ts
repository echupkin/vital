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

import raw from './analyte-descriptions.json';
import { analyteByKey } from './analytes';

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
}

const DESCRIPTIONS: Record<string, AnalyteDescription> = raw;

/** Every canonical key that has a description. */
export const DESCRIBED_KEYS: string[] = Object.keys(DESCRIPTIONS);

/**
 * The description for a stored or canonical analyte key, or null when the
 * analyte has none. Never invents an entry: an absent thing is absent.
 */
export function analyteDescription(key: string): AnalyteDescription | null {
  if (!key) return null;
  const canonical = analyteByKey(key)?.key ?? key;
  return DESCRIPTIONS[canonical] ?? null;
}
