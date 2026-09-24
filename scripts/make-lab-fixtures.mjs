#!/usr/bin/env node
// ── Synthetic lab fixtures ───────────────────────────────────────────────────
//
//   node scripts/make-lab-fixtures.mjs
//
// Writes five hand-built PDFs into src/lib/lab/__fixtures__/. They are SYNTHETIC
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

// ── Fixture (e): a Quest-style results report ────────────────────────────────

/**
 * A Quest Diagnostics results layout: ONE row per analyte, with the value in
 * whichever of two RESULT COLUMNS applies (`In Range` / `Out Of Range`), the
 * interval in a third column carried inline with its unit, and ALL-CAPS panel
 * labels between the rows. Two pages, so the repeated patient block and the
 * per-page `Collected:` date are both exercised.
 *
 * Every value here is round and obviously fake, and the identity fields are
 * placeholders whose only job is to prove they are refused and never stored.
 */
function questResults() {
  const nameX = 28;
  const rowX = 40;
  const subX = 52;
  const panelX = 28;
  const inRangeX = 240;
  const outOfRangeX = 316;
  const referenceX = 404;
  const labX = 560;

  /** The block every page of a Quest report repeats above its table. */
  const block = (out, collected, reported) => {
    out.push(run(36, 750, 'Sample Quest Diagnostics Report', 12));
    out.push(run(480, 764, 'Report Status: Final'));
    out.push(run(480, 732, 'SAMPLE, PERSON'));
    out.push(run(20, 716, 'Patient Information   Specimen Information   Client Information', 8));
    out.push(run(20, 700, 'DOB: Jan 1, 1970'));
    out.push(run(120, 700, 'AGE: 50'));
    out.push(run(20, 686, 'Gender: M'));
    out.push(run(120, 686, 'Fasting: Y'));
    out.push(run(20, 672, 'Phone: (000) 000-0000'));
    out.push(run(20, 658, 'Patient ID: SAMPLEID'));
    out.push(run(20, 644, 'Health ID: 0000000000000000'));
    out.push(run(230, 700, `Specimen: SPEC0000`));
    out.push(run(230, 686, 'Requisition: 0000000'));
    out.push(run(230, 672, 'Lab Ref #: 0000000000000000'));
    out.push(run(230, 658, `Collected: ${collected}`));
    out.push(run(230, 644, `Reported: ${reported} / 17:00 CDT`));
    out.push(run(430, 700, 'Client #: 00000000'));
    out.push(run(430, 686, 'PHYSICIAN, SAMPLE'));
    out.push(run(430, 672, '000 EXAMPLE ST'));
    out.push(run(430, 658, 'SAMPLEVILLE, CA 00000-0000'));
  };

  /** The table header, with one x per column. */
  const tableHeader = out => {
    out.push(run(nameX, 592, 'Test Name'));
    out.push(run(inRangeX, 592, 'In Range'));
    out.push(run(outOfRangeX, 592, 'Out Of Range'));
    out.push(run(referenceX, 592, 'Reference Range'));
    out.push(run(labX, 592, 'Lab'));
  };

  /** The footer every page carries below the table. */
  const footer = (out, page) => {
    out.push(run(20, 40, 'CLIENT SERVICES: (000) 000-0000'));
    out.push(run(230, 40, 'SPECIMEN: SPEC0000'));
    out.push(run(20, 26, 'Quest, Quest Diagnostics and the associated logo are the trademarks of Quest Diagnostics.'));
    out.push(run(520, 26, `Page ${page} of 2`));
  };

  // ── Page one ───────────────────────────────────────────────────────────────
  const one = [];
  block(one, '01/02/2021 / 08:00 CDT', '01/02/2021');
  tableHeader(one);
  // A value in the IN RANGE column, and an interval carrying its unit inline.
  one.push(run(rowX, 572, 'ALPHA ANALYTE'));
  one.push(run(inRangeX, 572, '12.1'));
  one.push(run(referenceX, 572, '4.0-12.0 u/L'));
  one.push(run(labX, 572, 'IG'));
  // A value in the OUT OF RANGE column: the column itself is the report's marker,
  // and the trailing token beside the value must not become a unit.
  one.push(run(rowX, 552, 'BETA ANALYTE'));
  one.push(run(outOfRangeX, 552, '15.5 H'));
  one.push(run(referenceX, 552, '4.0-12.0 u/L'));
  one.push(run(labX, 552, 'IG'));
  // A QUALITATIVE result that matches the printed expected value textually.
  one.push(run(rowX, 532, 'GAMMA COLOR'));
  one.push(run(inRangeX, 532, 'YELLOW'));
  one.push(run(referenceX, 532, 'YELLOW'));
  // A QUALITATIVE result that does NOT match it.
  one.push(run(rowX, 512, 'DELTA KETONES'));
  one.push(run(outOfRangeX, 512, '1+'));
  one.push(run(referenceX, 512, 'NEGATIVE'));
  footer(one, 1);

  // ── Page two ───────────────────────────────────────────────────────────────
  const two = [];
  block(two, '01/03/2021 / 09:30 CDT', '01/03/2021');
  tableHeader(two);
  // A PANEL label: ALL CAPS, no value and no interval. It must be refused, never
  // imported as an analyte with an empty value.
  two.push(run(panelX, 572, 'EPSILON PANEL'));
  // A calculated interval: `(calc)` is neither a number nor a unit.
  two.push(run(rowX, 552, 'EPSILON METRIC'));
  two.push(run(inRangeX, 552, '7.0'));
  two.push(run(referenceX, 552, '1.0-9.0 mg/dL (calc)'));
  // A NAME that wraps onto the next line, where its value and interval sit.
  two.push(run(rowX, 532, 'ZETA LONG'));
  two.push(run(subX, 512, 'NAME TEST'));
  two.push(run(inRangeX, 512, '3.0'));
  two.push(run(referenceX, 512, '1.0-5.0'));
  // An interval with no unit at all.
  two.push(run(rowX, 492, 'ETA BARE'));
  two.push(run(inRangeX, 492, '5.5'));
  two.push(run(referenceX, 492, '5.0-8.0'));
  footer(two, 2);

  return buildPdf([one.join(''), two.join('')]);
}

mkdirSync(OUT, { recursive: true });
const written = [
  ['trend-matrix.pdf', trendMatrix()],
  ['single-date.pdf', singleDateTable()],
  ['order-form.pdf', orderForm()],
  ['scan-like.pdf', scanLikePage()],
  ['quest-results.pdf', questResults()],
];
for (const [name, bytes] of written) {
  writeFileSync(join(OUT, name), bytes);
  console.log(`wrote ${join('src/lib/lab/__fixtures__', name)} (${bytes.length} bytes)`);
}