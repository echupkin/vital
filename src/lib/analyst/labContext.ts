// ── Loading the analyst's lab context (SERVER ONLY) ──────────────────────────
//
// The lab block's DATA lives in Postgres (`lab_results`), not in the metric
// dataset the retrieval bundle is built from, so it is read here — asynchronously,
// bounded, and only from the existing series read model (`getSeries`) and report
// list (`listReports`). Nothing here re-implements the parser, the status engine
// or the panel/specimen rule: the block renders the same rows the Lab page
// renders, scored the same way, with the owner's own sex/date of birth choosing
// the fallback band exactly as the Lab page does.
//
// FAILURE IS STATED, NEVER HIDDEN. No database, an unreachable database or an
// unreadable profile all yield an `available: false` snapshot carrying the
// reason; the analyst then says the lab data is absent rather than answering
// from an empty set. A lab read failure must never fail the whole question, and
// it must never look like "there are no lab results".

import { getSeries, listReports, readSeriesProfile, storeClient, type AnalyteSeries, type SqlClient } from '@/lib/db/lab-store';
import { buildLabSnapshot, type LabSeriesInput, type LabSourceInput } from './labSnapshot';
import type { LabContextSnapshot } from './types';
import type { LabSpec } from './retrieval';

/** The shape the service injects in tests; the real one reads Postgres. */
export type LabLoader = (question: string, spec: LabSpec | null) => Promise<LabContextSnapshot | null>;

const NO_DATABASE_REASON =
  'No Postgres database is configured, so the stored lab results cannot be read. No lab data is in this context.';

function unavailable(reason: string): LabContextSnapshot {
  return buildLabSnapshot(
    { available: false, reason, documents: 0, totalObservations: 0, collisions: 0, series: [] },
    { question: '' }
  );
}

/** One series read model entry → the flattened shape the block builder takes. */
function toSeriesInput(series: AnalyteSeries): LabSeriesInput {
  return {
    seriesKey: series.seriesKey,
    analyteKey: series.analyteKey,
    displayName: series.displayName,
    specimen: series.specimen,
    registered: series.registered,
    unit: series.unit,
    points: series.points.map(point => ({
      on: point.resultOn,
      value: point.value,
      valueText: point.valueText,
      unit: point.unit,
      printedRefText: point.refText,
      interval: point.interval,
      status: point.status,
      statusLabel: point.statusLabel,
      tone: point.tone,
    })),
  };
}

/** Read the series read model and the document count from Postgres. */
async function readLabSource(client: SqlClient): Promise<LabSourceInput> {
  const profile = await readSeriesProfile(client);
  const series = await getSeries(client, profile);
  const reports = await listReports(client);
  return {
    available: true,
    reason: null,
    documents: reports.length,
    totalObservations: series.totalObservations,
    collisions: series.collisions,
    series: series.analytes.map(toSeriesInput),
  };
}

/**
 * Build the bounded lab block for one analyst question.
 *
 * `deps.client` lets a test inject a fake database; in production the process
 * pool is used. `deps.env` mirrors the service's injection convention so a test
 * never touches `process.env`.
 */
export async function loadLabSnapshot(
  question: string,
  spec: LabSpec | null,
  deps: { env?: NodeJS.ProcessEnv; client?: SqlClient | null } = {}
): Promise<LabContextSnapshot> {
  let client: SqlClient | null;
  try {
    client = deps.client ?? storeClient(deps.env ?? process.env);
  } catch {
    // A configured-but-invalid database setting: state it, do not throw.
    return unavailable('The Postgres configuration is invalid, so the stored lab results cannot be read.');
  }
  if (!client) return unavailable(NO_DATABASE_REASON);

  try {
    const source = await readLabSource(client);
    return buildLabSnapshot(source, { question, spec });
  } catch {
    return unavailable('The stored lab results could not be read, so no lab data is in this context.');
  }
}
