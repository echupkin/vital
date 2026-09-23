// ── /api/lab/reports/[id] — one report, and its deletion ─────────────────────
//
//   GET    → the report with its observations.
//   DELETE → the report (its observations cascade), and the stored PDF when no
//            other report references that content hash. `source_sha256` is
//            UNIQUE, so at most one report ever holds a hash; the check is still
//            made rather than assumed.
//
// The id is passed through as a query parameter: Postgres casts it to UUID and
// reports a malformed id as "no such report" rather than as a 500.

import { NextResponse } from 'next/server';
import { deleteStoredBytes } from '@/lib/lab/storage';
import { resolveLabConfig } from '@/lib/lab/config';
import { deleteReport, findReportBySha, getReport, listResults, storeClient } from '@/lib/db/lab-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

const INVALID_ID = { error: 'The report id must be a UUID.' };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json(INVALID_ID, { status: 400, headers: NO_STORE });
  }
  const client = storeClient();
  if (!client) {
    return NextResponse.json(
      { error: 'No Postgres database is configured, so no report can be read.' },
      { status: 503, headers: NO_STORE }
    );
  }
  const report = await getReport(client, id);
  if (!report) {
    return NextResponse.json({ error: 'No such report.' }, { status: 404, headers: NO_STORE });
  }
  const results = await listResults(client, id);
  return NextResponse.json({ report: { ...report, resultCount: results.length }, results }, { status: 200, headers: NO_STORE });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json(INVALID_ID, { status: 400, headers: NO_STORE });
  }
  const client = storeClient();
  if (!client) {
    return NextResponse.json(
      { error: 'No Postgres database is configured, so no report can be deleted.' },
      { status: 503, headers: NO_STORE }
    );
  }

  const report = await getReport(client, id);
  if (!report) {
    return NextResponse.json({ error: 'No such report.' }, { status: 404, headers: NO_STORE });
  }

  const deleted = await deleteReport(client, id);
  if (!deleted) {
    return NextResponse.json({ error: 'No such report.' }, { status: 404, headers: NO_STORE });
  }

  // The stored PDF goes only when nothing still references the hash.
  let fileRemoved = false;
  const stillReferenced = await findReportBySha(client, report.sourceSha256);
  if (!stillReferenced) {
    const config = resolveLabConfig();
    fileRemoved = await deleteStoredBytes(config.dir, report.sourceSha256);
  }

  return NextResponse.json({ deleted: true, reportId: id, fileRemoved }, { status: 200, headers: NO_STORE });
}