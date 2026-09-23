// ── /api/lab/reports/commit — persist the owner-reviewed rows ────────────────
//
//   POST JSON { kind, documentDate, sourceFilename, sourceSha256, sourceBytes,
//               pageCount?, labName?, extraction?, notes?, results: [...] }
//
// Inserts the report and its observations in ONE transaction — never partially.
//
// An ORDER FORM IS REFUSED with a clear message ("this is a lab order, not
// results — nothing was imported"). A well-formed payload with one malformed row
// is refused whole; there is no partial import.

import { NextResponse } from 'next/server';
import { validateCommitPayload } from '@/lib/lab/commit';
import { findReportBySha, insertReport, storeClient } from '@/lib/db/lab-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The request body must be JSON.' }, { status: 400, headers: NO_STORE });
  }

  const validated = validateCommitPayload(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: validated.status, headers: NO_STORE });
  }

  const client = storeClient();
  if (!client) {
    return NextResponse.json(
      {
        error:
          'No Postgres database is configured, so nothing can be stored. Configure DATABASE_URL or the VITAL_PG_* variables.',
      },
      { status: 503, headers: NO_STORE }
    );
  }

  const duplicate = await findReportBySha(client, validated.report.sourceSha256);
  if (duplicate) {
    return NextResponse.json(
      {
        error:
          'This document is already stored (its SHA-256 matches an existing report), so it was not imported again.',
        duplicate: true,
        report: duplicate,
      },
      { status: 409, headers: NO_STORE }
    );
  }

  const stored = await insertReport(client, validated.report, validated.results);
  return NextResponse.json(
    {
      report: { ...stored.report, resultCount: stored.results.length },
      results: stored.results,
    },
    { status: 201, headers: NO_STORE }
  );
}