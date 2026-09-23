// ── /api/lab/reports — upload and list ───────────────────────────────────────
//
//   POST multipart/form-data (field `file`):
//     validate PDF + size → hash the bytes → store content-addressed → extract →
//     return the DRAFT. The draft is NOT persisted: the owner reviews the rows
//     and posts them to /api/lab/reports/commit.
//
//     A PDF whose sha256 is already stored is not imported twice: the existing
//     report is returned with `duplicate: true` and a message saying so.
//
//   GET  → the stored reports, newest first, with per-report counts and the
//          result date range. With no database configured this is a 200 with
//          `available: false` and the honest reason, not an error.
//
// Nothing here returns a credential, a database address or a patient identity:
// the draft carries the parser's redacted rows and its own bookkeeping only.

import { NextResponse } from 'next/server';
import { extractLabDocument, sha256Of } from '@/lib/lab/extract';
import { buildDraft, isPdf } from '@/lib/lab/commit';
import { resolveLabConfig } from '@/lib/lab/config';
import { storeBytes } from '@/lib/lab/storage';
import { findReportBySha, listReports, storeClient } from '@/lib/db/lab-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

const NO_DATABASE_REASON =
  'No Postgres database is configured, so uploaded reports are not saved. Configure DATABASE_URL or the VITAL_PG_* variables to store them.';

export async function GET() {
  // The size cap travels with the list so the browser can refuse an oversize
  // file itself, with the same number the route enforces, instead of learning it
  // only after a doomed upload. It is not a secret: it is a documented limit.
  const { maxBytes } = resolveLabConfig();
  const client = storeClient();
  if (!client) {
    return NextResponse.json(
      { available: false, reason: NO_DATABASE_REASON, maxBytes, reports: [] },
      { status: 200, headers: NO_STORE }
    );
  }
  const reports = await listReports(client);
  return NextResponse.json({ available: true, maxBytes, reports }, { status: 200, headers: NO_STORE });
}

export async function POST(request: Request) {
  const config = resolveLabConfig();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'The upload must be multipart/form-data with a `file` part.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json(
      { error: 'No file was uploaded: send the PDF as the multipart field `file`.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = file.name && file.name.trim().length > 0 ? file.name : 'upload.pdf';

  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400, headers: NO_STORE });
  }
  if (bytes.byteLength > config.maxBytes) {
    return NextResponse.json(
      {
        error: `The uploaded file is ${bytes.byteLength} bytes, which is larger than the ${config.maxBytes}-byte limit. Raise VITAL_LAB_MAX_BYTES to accept it.`,
      },
      { status: 413, headers: NO_STORE }
    );
  }
  if (!isPdf(bytes)) {
    return NextResponse.json(
      { error: 'The uploaded file is not a PDF (it does not start with %PDF-).' },
      { status: 415, headers: NO_STORE }
    );
  }

  const sha256 = sha256Of(bytes);
  const client = storeClient();

  if (client) {
    const existing = await findReportBySha(client, sha256);
    if (existing) {
      return NextResponse.json(
        {
          duplicate: true,
          message:
            'This exact document is already stored (its SHA-256 matches an existing report), so it was not imported twice.',
          report: existing,
        },
        { status: 200, headers: NO_STORE }
      );
    }
  }

  const path = await storeBytes(config.dir, sha256, bytes);
  void path;

  const extraction = await extractLabDocument(bytes, {
    filename,
    sha256,
    modelAssist: config.modelAssistEnabled,
  });
  const draft = buildDraft(extraction, filename, sha256, bytes.byteLength);

  return NextResponse.json(
    { draft, stored: { sha256, bytes: bytes.byteLength }, available: Boolean(client) },
    { status: 201, headers: NO_STORE }
  );
}