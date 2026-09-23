// ── Lab destinations for the command palette ────────────────────────────────
//
// The palette already indexes wearable metric names, so it must also index the
// lab analytes — otherwise a reader can search for a name the Lab page renders
// and be told there is no such thing.
//
// TYPE ONLY + DATA + PURE FUNCTIONS: this module is imported by a client
// component, so it may not touch the database, the filesystem or the network.

import { ANALYTES, normalizeName } from './analytes';

export interface LabDestination {
  id: string;
  label: string;
  description: string;
  href: string;
  type: 'lab';
}

/** A stable palette entry for one registered analyte. */
export function labDestinationFor(key: string): LabDestination | null {
  const analyte = ANALYTES.find(entry => entry.key === key);
  if (!analyte) return null;
  return {
    id: `lab-${analyte.key}`,
    label: analyte.displayName,
    description: `Lab result · ${analyte.category}${analyte.unit ? ` · ${analyte.unit}` : ''}`,
    href: `/lab/${analyte.key}`,
    type: 'lab',
  };
}

/**
 * Registered analytes whose key, display name or alias matches the query.
 * An empty query returns nothing: the palette shows the pages, not 150 analytes.
 */
export function searchLabAnalytes(query: string, limit = 6): LabDestination[] {
  const needle = normalizeName(query ?? '');
  if (needle.length < 2) return [];
  const matches: LabDestination[] = [];
  for (const analyte of ANALYTES) {
    const haystack = normalizeName([analyte.key, analyte.displayName, ...analyte.aliases].join(' '));
    if (!haystack.includes(needle)) continue;
    const destination = labDestinationFor(analyte.key);
    if (destination) matches.push(destination);
    if (matches.length >= limit) break;
  }
  return matches;
}
