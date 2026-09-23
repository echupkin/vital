// ── Lab reads for the browser ───────────────────────────────────────────────
//
// The three reads the Lab page and the analyte detail page make, and nothing
// else. All of them go through the existing `/api/lab/*` routes: the summary
// route serves the scored series, the reports route serves the stored documents,
// and one report read supplies the per-row provenance (the source filename, the
// printed name, the extraction pass and the interval exactly as printed) that
// the series read model does not carry.
//
// NO HEALTH VALUE IS EVER LOGGED, here or anywhere: a failure is reported as the
// route's own message, never as a value.
//
// Nothing is invented on a failure: an unreadable read returns an error the page
// shows, and the page never substitutes zeroes, demo rows or a plausible guess.

import type {
  LabAnalyte,
  LabReportDocument,
  LabSummary,
  LabExtractionMethod,
} from './view';

/** One stored row's provenance, keyed by its `resultId`. */
export interface RowProvenance {
  reportId: string;
  documentDate: string | null;
  sourceFilename: string;
  printedName: string;
  extractionMethod: LabExtractionMethod;
  /** The interval exactly as the document printed it, e.g. ">40 mg/dL". */
  refText: string | null;
  printedFlag: string | null;
}

export interface LabDocumentsState {
  available: boolean;
  reason: string | null;
  documents: LabReportDocument[];
}

export class LabReadError extends Error {}

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `The lab endpoint answered HTTP ${res.status} with no usable message.`;
    throw new LabReadError(message);
  }
  if (body === null) throw new LabReadError(`The lab endpoint answered HTTP ${res.status} with a body that was not JSON.`);
  return body as T;
}

/** The scored series: per analyte, every stored observation with its interval and status. */
export async function fetchLabSummary(): Promise<LabSummary> {
  const body = await readJson<Partial<LabSummary>>('/api/lab/summary');
  return {
    available: body.available ?? false,
    reason: body.reason,
    profile: {
      sexSet: body.profile?.sexSet ?? false,
      dateOfBirthSet: body.profile?.dateOfBirthSet ?? false,
    },
    analytes: (body.analytes ?? []) as LabAnalyte[],
    totalObservations: body.totalObservations ?? 0,
    collisions: body.collisions ?? 0,
  };
}

/** The stored documents, newest first, with their counts and result date range. */
export async function fetchLabDocuments(): Promise<LabDocumentsState> {
  // The route names this field `reports`; the page calls them documents, because
  // one uploaded PDF can be a trend matrix holding several result dates.
  const body = await readJson<{ available?: boolean; reason?: string; reports?: LabReportDocument[] }>(
    '/api/lab/reports'
  );
  return {
    available: body.available ?? false,
    reason: body.reason ?? null,
    documents: body.reports ?? [],
  };
}

interface ReportRead {
  report: { id: string; documentDate: string | null; sourceFilename: string };
  results: Array<{
    id: string;
    reportId: string;
    printedName: string;
    extractionMethod: LabExtractionMethod;
    refText: string | null;
    printedFlag: string | null;
  }>;
}

/**
 * Provenance for every stored row, keyed by `resultId`.
 *
 * A document that cannot be read contributes nothing rather than a guess: the
 * caller shows the rows it could not attribute as such.
 */
export async function fetchProvenance(reportIds: string[]): Promise<Map<string, RowProvenance>> {
  const unique = [...new Set(reportIds.filter(id => id.length > 0))];
  const map = new Map<string, RowProvenance>();
  const reads = await Promise.all(
    unique.map(async id => {
      try {
        return await readJson<ReportRead>(`/api/lab/reports/${encodeURIComponent(id)}`);
      } catch {
        return null;
      }
    })
  );
  for (const read of reads) {
    if (!read?.report) continue;
    for (const result of read.results ?? []) {
      map.set(result.id, {
        reportId: read.report.id,
        documentDate: read.report.documentDate,
        sourceFilename: read.report.sourceFilename,
        printedName: result.printedName,
        extractionMethod: result.extractionMethod,
        refText: result.refText,
        printedFlag: result.printedFlag,
      });
    }
  }
  return map;
}
