// ── /api/lab/reports/[id]/reparse — apply a parser improvement ───────────────
//
//   POST → re-extract the stored PDF (from its content address, so the bytes are
//          exactly the ones the hash names) and REPLACE the report's
//          observations in one transaction. The report's revision is bumped.
//
// This is the only way a parser improvement reaches an already-stored document;
// it never edits the file and never merges two parses, because a mix of an old
// and a new parse would be a result set that never existed.

import { NextResponse } from 'next/server';
import { extractLabDocument, sha256Of } from '@/lib/lab/extract';
import { resolveLabConfig } from '@/lib/lab/config';
import { readStoredBytes } from '@/lib/lab/storage';
import { getReport, listResults, replaceResults, storeClient } from '@/lib/db/lab-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'The report id must be a UUID.' }, { status: 400, headers: NO_STORE });
  }

  const client = storeClient();
  if (!client) {
    return NextResponse.json(
      { error: 'No Postgres database is configured, so no report can be re-parsed.' },
      { status: 503, headers: NO_STORE }
    );
  }

  const report = await getReport(client, id);
  if (!report) {
    return NextResponse.json({ error: 'No such report.' }, { status: 404, headers: NO_STORE });
  }

  const config = resolveLabConfig();
  const bytes = await readStoredBytes(config.dir, report.sourceSha256);
  if (!bytes) {
    return NextResponse.json(
      {
        error:
          'The stored PDF for this report is not on disk, so it cannot be re-parsed. The document can be uploaded again.',
      },
      { status: 410, headers: NO_STORE }
    );
  }

  // The bytes on disk must still hash to the report's own hash, or the
  // re-parse would be attributing a different document to this report.
  if (sha256Of(bytes) !== report.sourceSha256) {
    return NextResponse.json(
      { error: 'The stored file no longer matches this report\u2019s content hash, so it was not re-parsed.' },
      { status: 409, headers: NO_STORE }
    );
  }

  const extraction = await extractLabDocument(bytes, {
    filename: report.sourceFilename,
    sha256: report.sourceSha256,
    modelAssist: config.modelAssistEnabled,
  });

  if (extraction.kind !== 'results') {
    return NextResponse.json(
      {
        error: `Re-parsing produced a "${extraction.kind}" document, which carries no result rows, so the stored observations were left untouched.`,
        kind: extraction.kind,
      },
      { status: 422, headers: NO_STORE }
    );
  }

  const results = await replaceResults(client, id, extraction.observations);
  const updated = await getReport(client, id);
  const stored = await listResults(client, id);

  return NextResponse.json(
    {
      report: updated,
      results: stored,
      replaced: results.length,
      warnings: extraction.warnings,
      pass: extraction.pass,
    },
    { status: 200, headers: NO_STORE }
  );
}