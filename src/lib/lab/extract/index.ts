// ── Extract one lab PDF ──────────────────────────────────────────────────────
//
//   const result = await extractLabDocument(bytes, { filename: 'x.pdf' });
//
// The whole pipeline, in order:
//
//   1. pdf-items  — read the text layer WITH GEOMETRY (server only);
//   2. layout     — group into lines, find the date-header row, derive one column
//                   centre per printed date, delimit analyte blocks, attribute
//                   every cell to a column and to a block;
//   3. parse      — understand each cell, each interval, each flag; map names to
//                   canonical keys; read the document kind and the document date;
//   4. model-assist — OPTIONAL, and only when step 2–3 found no complete analyte
//                   row at all; every value it proposes is validated against the
//                   document text before it is kept.
//
// The return value never carries an identity field: names, dates of birth,
// addresses, phone numbers and provider details are redacted on the way out.
//
// A page with no text layer at all (a scan) raises the explicit "looks like a
// scan; OCR is not implemented" warning — it never silently yields zero rows.

import { createHash } from 'node:crypto';
import type { ExtractionResult, ExtractionWarning } from '../types';
import { readPdfItems } from './pdf-items';
import { buildLayout, type DocumentLayout } from './layout';
import {
  assembleResult,
  detectDocumentDate,
  detectDocumentKind,
  detectLabName,
  interpretLayout,
  PARSER_VERSION,
  redact,
} from './parse';
import { assistExtraction, type ModelAssistDeps } from './model-assist';
import { interpretQuest, isQuestResultsLayout, questDocumentDate, QUEST_KIND_REASON } from './quest';

export { PARSER_VERSION } from './parse';
export type { ModelAssistDeps } from './model-assist';

export interface ExtractOptions {
  /** The uploaded file's name. Used only to read a date out of it. */
  filename?: string | null;
  /** A precomputed SHA-256 of the bytes, to avoid hashing them twice. */
  sha256?: string | null;
  /**
   * Offer the optional model pass when the deterministic pass finds no analyte
   * rows at all. Defaults to true; set false to guarantee no network call.
   */
  modelAssist?: boolean;
  /** Injected for tests: a completion function, or an environment. */
  modelDeps?: ModelAssistDeps;
}

/** SHA-256 of the uploaded bytes, lowercase hex. */
export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Read one lab PDF.
 *
 * Never throws for a document it cannot understand: an order form, a scan and an
 * unknown layout are all REPORTED (as `kind`, `notes` and warnings) rather than
 * raised, because "this is an order form" is a correct answer, not a failure.
 */
export async function extractLabDocument(
  bytes: Uint8Array,
  options: ExtractOptions = {}
): Promise<ExtractionResult> {
  const sourceBytes = bytes.byteLength;
  const sourceSha256 = options.sha256 && options.sha256.trim() ? options.sha256.trim() : sha256Of(bytes);

  let layout: DocumentLayout;
  let creationDate: string | null = null;
  let pdfPageCount = 0;
  try {
    const geometry = await readPdfItems(bytes);
    creationDate = geometry.creationDate;
    pdfPageCount = geometry.pageCount;
    layout = buildLayout(geometry);
  } catch (error) {
    return {
      parserVersion: PARSER_VERSION,
      kind: 'unknown',
      pageCount: 0,
      documentDate: null,
      labName: null,
      pass: 'none',
      observations: [],
      warnings: [
        {
          code: 'page_without_text',
          message: `The file could not be read as a PDF at all: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
          page: null,
          line: null,
        },
      ],
      rejections: [],
      sourceSha256,
      sourceBytes,
      notes: 'The file could not be read as a PDF, so nothing was extracted from it.',
    };
  }

  const text = layout.lines.map(line => line.text).join('\n');
  // A Quest Diagnostics results report prints one row per analyte in two result
  // columns and no date-header row, so it is routed to its own reader instead of
  // the trend-matrix one. A document with no Quest header takes the LabCorp path
  // exactly as before.
  const quest = isQuestResultsLayout(layout) ? interpretQuest(layout) : null;
  const { kind, reason } = quest
    ? { kind: 'results' as const, reason: QUEST_KIND_REASON }
    : detectDocumentKind(text, layout);
  const documentDate = quest
    ? questDocumentDate(layout) ?? detectDocumentDate({ text, filename: options.filename ?? null, creationDate })
    : detectDocumentDate({ text, filename: options.filename ?? null, creationDate });
  const labName = detectLabName(text);

  const columnsByPage = new Map<number, { date: string | null; dateText: string }[]>();
  const extraWarnings: ExtractionWarning[] = [];
  for (const header of layout.headers) {
    columnsByPage.set(header.page, header.columns.map(column => ({ date: column.date, dateText: column.dateText })));
  }
  for (const page of layout.pages) {
    if (!quest && kind === 'results' && page.itemCount > 0 && !columnsByPage.has(page.page)) {
      extraWarnings.push({
        code: 'no_column_header',
        message:
          'No date-header row was recognised on this page, so nothing on it could be attributed to a result date.',
        page: page.page,
        line: null,
      });
    }
  }

  const interpreted = quest
    ? quest
    : kind === 'results'
      ? interpretLayout(layout, columnsByPage)
      : { observations: [], warnings: layout.warnings, rejections: interpretRejections(layout) };

  let observations = interpreted.observations;
  let pass: ExtractionResult['pass'] = observations.length > 0 ? 'deterministic' : 'none';
  const warnings: ExtractionWarning[] = [...interpreted.warnings, ...extraWarnings];
  // A results document carries no note of its own, EXCEPT the one line that
  // reports the qualitative rows the closed vocabulary resolved — reported once
  // for the document rather than as a warning per row.
  let notes = kind === 'results' ? quest?.qualitativeNote ?? null : reason;

  if (kind === 'results' && observations.length === 0 && options.modelAssist !== false) {
    warnings.push({
      code: 'deterministic_pass_empty',
      message:
        'The deterministic pass found no complete analyte row, so the optional model pass was offered this document.',
      page: null,
      line: null,
    });
    const assisted = await assistExtraction(
      {
        lines: layout.lines.map(line => ({ lineNo: line.lineNo, text: line.text })),
        columns: layout.headers.flatMap(header =>
          header.columns.map(column => ({ dateText: column.dateText, date: column.date }))
        ),
      },
      options.modelDeps ?? {}
    );
    warnings.push(...assisted.warnings);
    if (assisted.observations.length > 0) {
      observations = assisted.observations;
      pass = 'model';
      notes = assisted.provider
        ? `Read by the optional model pass (${assisted.provider}); every value was checked against the document text.`
        : 'Read by the optional model pass; every value was checked against the document text.';
    }
  }

  const result = assembleResult({
    interpreted: { observations, warnings, rejections: interpreted.rejections },
    kind,
    kindReason: reason,
    documentDate,
    labName,
    pageCount: pdfPageCount,
    sourceSha256,
    sourceBytes,
    pass,
    observationsEmpty: observations.length === 0,
  });

  return { ...result, notes };
}

/** The rejected lines of a document that is not a results table, redacted. */
function interpretRejections(layout: DocumentLayout) {
  return layout.classified
    .filter((line): line is typeof line & { reason: NonNullable<typeof line.reason> } => line.reason !== null)
    .map(line => ({ page: line.page, lineNo: line.lineNo, text: redact(line.text), reason: line.reason }));
}