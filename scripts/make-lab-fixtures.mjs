#!/usr/bin/env node
// ── Synthetic lab fixtures ───────────────────────────────────────────────────
//
//   node scripts/make-lab-fixtures.mjs
//
// Writes four hand-built PDFs into src/lib/lab/__fixtures__/. They are SYNTHETIC
// and contain round, obviously-fake numbers, a fake person and a fake address —
// no real report, value, name or date appears anywhere in them, and they are the
// only lab documents that may ever be committed.
//
// WHY THEY ARE BUILT BY HAND. The point of these files is GEOMETRY. A fixture
// written through a PDF library would place text the way that library likes it;
// these place every run at an explicit x/y with the same text-positioning
// operators a lab's report generator uses, so they reproduce the two things the
// parser exists to handle:
//
//   * a TREND MATRIX, where one table header carries several DATES AS COLUMNS and
//     every analyte row has one cell per date — so one document yields many
//     observations;
//   * INTERLEAVED values and flags, where a value sits above its own name line
//     and the report's `High` marker sits beside the interval, not beside the
//     value — which is why a line-based reader cannot work.
//
// The content streams are uncompressed (they can be read with any text editor),
// the only font is base Helvetica, and nothing but text-positioning operators is
// used. No PDF library is imported and no dependency is added.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'lib', 'lab', '__fixtures__');

/** Helvetica at 9pt advances roughly half its size per character. */
const CHAR = 0.52;
const LINE = 13.4;
const SIZE = 9;

/** Escape the three characters that are special inside a PDF string. */
function escapeText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** One positioned run of text: `BT … Tm (text) Tj ET`. */
function run(x, y, text, size = SIZE) {
  return `BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapeText(text)}) Tj ET\n`;
}

/** A run centred on `centre`, so a cell lands in the column it belongs to. */
function centred(centre, y, text, size = SIZE) {
  const width = CHAR * size * text.length;
  return run(centre - width / 2, y, text, size);
}

/** Build a PDF from one content-stream string per page. */
function buildPdf(contents) {
  const objects = [];
  let offset = 0;

  const push = (body) => {
    objects.push(`${objects.length + 1} 0 obj\n${body}\nendobj\n`);
  };

  // Object numbers are decided up front so nothing has to be rewritten after the
  // byte offsets are computed: 1 catalog, 2 pages, 3 font, then two per page.
  const pageRefs = contents.map((_, index) => `${4 + index * 2} 0 R`);

  push('<< /Type /Catalog /Pages 2 0 R >>');
  push(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${contents.length} >>`);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  contents.forEach((content, index) => {
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`
    );
    push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
  });

  const header = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets = [0];
  let body = '';
  for (const text of objects) {
    offsets.push(offset + Buffer.byteLength(header, 'latin1') + Buffer.byteLength(body, 'latin1'));
    body += text;
  }
  const full = header + body;

  const xrefOffset = Buffer.byteLength(full, 'latin1');
  // Each xref entry is exactly 20 bytes: 10-digit offset, generation, type, EOL.
  const entries = ['0000000000 65535 f\r\n'];
  for (const value of offsets.slice(1)) entries.push(`${String(value).padStart(10, '0')} 00000 n\r\n`);
  const xref = `xref\n0 ${objects.length + 1}\n${entries.join('')}`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(full + xref + trailer, 'latin1');
}

// ── Fixture (a): a trend matrix with three date columns ──────────────────────

function trendMatrix() {
  const c1 = 240;
  const c2 = 336;
  const c3 = 432;
  const out = [];
  let y = 632; // the header row's baseline; every later row steps down from it

  /** Start the next printed line and return its baseline y. */
  const nextLine = () => (y -= LINE);
  /** A left-margin (name region) run on the current line. */
  const left = (text) => out.push(run(56, y, text));
  /** A cell on the current line, centred on one of the three columns. */
  const cell = (centre, text) => out.push(centred(centre, y, text));

  out.push(run(36, 718, 'Result Trends', 14));
  out.push(run(36, 698, 'Results limited to those after Jan 1, 2020. Results found from Jan 15, 2020 - Mar 20, 2022.'));
  out.push(run(36, 681, 'Sample Person'));
  out.push(run(118, 681, 'Date of Birth: Jan 1, 1970'));
  out.push(run(48, 648, 'Jan 15, 2020 - Mar 20, 2022 (Table 1 of 1)'));
  // Header row: one date per COLUMN. Column centres are c1/c2/c3.
  out.push(run(56, 632, 'Component'));
  out.push(run(212, 632, 'Jan 15, 2020'));
  out.push(run(308, 632, 'Jun 30, 2021'));
  out.push(run(404, 632, 'Mar 20, 2022'));

  // 1. A wrapped name, a value printed ABOVE its own name line, the report's flag
  //    beside the interval, and a wrapped unit — the `MO%` shape from the real
  //    documents, all in one row.
  nextLine();
  left('Widget');
  nextLine();
  left('One');
  nextLine();
  cell(c1, '12.1 u/L'); // the value is printed ABOVE the interval line
  nextLine();
  left('Normal Range: 4.0 - 12.0');
  cell(c1, 'High');
  cell(c2, '9.3 u/L');
  cell(c3, '8.2 u/L');
  nextLine();
  left('u/L');

  // 2. A ratio interval with a two-decimal bound and three plain values.
  nextLine();
  left('Gamma Ratio');
  nextLine();
  left('Normal Range: 0.00 - 4.44 ratio');
  cell(c1, '1.10 ratio');
  cell(c2, '1.20 ratio');
  cell(c3, '1.30 ratio');

  // 3. An interval whose upper bound wraps onto the following line.
  nextLine();
  left('Delta Count');
  nextLine();
  left('Normal Range: 5 -');
  cell(c1, '60 K/ul');
  cell(c2, '41 K/ul');
  cell(c3, '30 K/ul');
  nextLine();
  left('50 K/ul');

  // 4 and 5. Two analytes printing the SAME name with DIFFERENT intervals. Both
  //    must survive; neither may be merged into the other.
  nextLine();
  left('Sigma Total');
  nextLine();
  left('Normal Range: 1.0 - 2.0');
  cell(c1, '1.5 g/l');
  cell(c2, '1.6 g/l');
  cell(c3, '1.7 g/l');
  nextLine();
  left('g/l');

  nextLine();
  left('Sigma Total');
  nextLine();
  left('Normal Range: 3.0 - 4.0');
  cell(c1, '3.5 g/l');
  cell(c2, '3.6 g/l');
  cell(c3, '3.7 g/l');
  nextLine();
  left('g/l');

  // 6. Every non-plain result form in one row.
  nextLine();
  left('Epsilon Trace');
  nextLine();
  left('Normal Range: <100 mg/dL');
  cell(c1, '<0.5 mg/dL');
  cell(c2, 'TRACE');
  cell(c3, '>39 mg/dL');

  // A row a person filled in rather than a result. It must be refused, with a
  // recorded reason, and its cells must not become observations.
  nextLine();
  left('Fasting?');
  cell(c1, 'Yes');
  cell(c2, 'Yes');
  cell(c3, 'Yes');

  return buildPdf([out.join('')]);
}

// ── Fixture (b): a single-date table ─────────────────────────────────────────

function singleDateTable() {
  const centre = 276;
  const out = [];
  out.push(run(36, 718, 'Result Trends', 14));
  out.push(run(36, 698, 'One date, two analytes.'));
  out.push(run(36, 681, 'Sample Person'));
  out.push(run(118, 681, 'Date of Birth: Jan 1, 1970'));
  out.push(run(36, 664, 'Report Date: Feb 2, 2021'));
  out.push(run(56, 632, 'Component'));
  out.push(run(250, 632, 'Feb 2, 2021'));
  out.push(run(430, 632, 'Units'));
  out.push(run(56, 618, 'Alpha Analyte'));
  out.push(run(56, 605, 'Normal Range: 1.0 - 3.0'));
  out.push(centred(centre, 605, '2.0 mg/dL'));
  out.push(run(56, 578, 'Beta Analyte'));
  out.push(run(56, 565, 'Normal Range: 4.0 - 6.0'));
  out.push(centred(centre, 565, '5.0 mg/dL'));
  return buildPdf([out.join('')]);
}

// ── Fixture (c): an order form ───────────────────────────────────────────────

function orderForm() {
  const out = [];
  out.push(run(36, 718, 'Sample Diagnostics Incorporated', 12));
  out.push(run(36, 698, 'Client #: 00000000'));
  out.push(run(36, 681, 'Sample Person'));
  out.push(run(200, 681, 'Date of Birth: Jan 1, 1970'));
  out.push(run(36, 668, '123 EXAMPLE ST'));
  out.push(run(36, 655, 'SAMPLEVILLE, CA 00000-0000'));
  out.push(run(36, 642, 'SSN: [SSN]'));
  out.push(run(36, 629, 'Collection Date:'));
  out.push(run(200, 629, 'Time:'));
  out.push(run(36, 615, 'Home Phone: (000) 000-0000'));
  out.push(run(36, 600, 'Internal Comments: SAMPLE'));
  out.push(run(250, 570, 'Profiles/Tests', 11));
  const tests = [
    '100 - Example Test One [SERUM]',
    '200 - Example Test Two [SERUM]',
    '300 - Example Test Three [BLOOD]',
    '400 - Example Panel, Complete [SERUM]',
  ];
  tests.forEach((test, index) => out.push(run(54, 550 - index * 11, test, 7)));
  out.push(run(54, 480, 'Continued on the next page..'));
  return buildPdf([out.join('')]);
}

// ── Fixture (d): a page with no text layer ───────────────────────────────────

function scanLikePage() {
  // Graphics only: a filled rectangle, no BT/Tj operators at all, which is what a
  // scanned page looks like once its image has been dropped.
  const content = '0.85 g 80 300 450 200 re f\n';
  return buildPdf([content]);
}

mkdirSync(OUT, { recursive: true });
const written = [
  ['trend-matrix.pdf', trendMatrix()],
  ['single-date.pdf', singleDateTable()],
  ['order-form.pdf', orderForm()],
  ['scan-like.pdf', scanLikePage()],
];
for (const [name, bytes] of written) {
  writeFileSync(join(OUT, name), bytes);
  console.log(`wrote ${join('src/lib/lab/__fixtures__', name)} (${bytes.length} bytes)`);
}