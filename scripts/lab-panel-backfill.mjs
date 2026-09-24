#!/usr/bin/env node
// ── Backfill `lab_results.panel` (LOCAL ONLY) ────────────────────────────────
//
//   node --env-file=.env scripts/lab-panel-backfill.mjs [<dir>] [--dry-run]
//
// Writes, on every ALREADY-STORED row, the panel heading its report printed above
// it — the one part of 0006 that cannot be derived from anything already stored.
//
// WHY RE-EXTRACT RATHER THAN RE-IMPORT. Re-importing a stored document would
// replace its rows wholesale: every one would get a new id and a new `created_at`.
// The rows are the owner's data, and the SAME row must stay the same row. So each
// stored report is matched to its source PDF BY CONTENT (sha256), the PDF is read
// again with the CURRENT parser, and each extracted observation is paired with the
// stored row it came from; only `panel` is written. Nothing is inserted, no report
// is created, and a document that is already stored is never re-imported — the
// duplicate guard is not even consulted, because this script does not import.
//
// HOW A ROW IS PAIRED. By the shape the REPORT printed — analyte key plus the
// value text, unit and interval wording — within that key, so a parser change
// that ADDS rows cannot shift a panel onto the wrong one. A row that pairs with
// nothing is left exactly as it is and reported (by analyte key, never by value):
// a panel is only ever recorded from the observation it came from.
//
// WHAT IT PRINTS. Counts, panel headings, analyte keys and per-report status.
// Never a measured value, never a name, date or identifier.
//
// It is run through Node's own TypeScript type-stripping with the same small
// resolver hook the lab audit uses (see scripts/lab-audit.mjs): the project's own
// `typescript` devDependency does the transpiling, and nothing new is installed.

import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { resolveDatabaseConfig, databaseTarget } from '../src/lib/db/pg-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SRC = join(REPO, 'src');

const HOOK = `
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import ts from ${JSON.stringify(pathToFileURL(join(REPO, 'node_modules/typescript/lib/typescript.js')).href)};

const SRC = ${JSON.stringify(SRC)};

function candidates(specifier, parent) {
  if (specifier.startsWith('@/')) return [resolvePath(SRC, specifier.slice(2))];
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const base = dirname(fileURLToPath(parent));
    return [resolvePath(base, specifier)];
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const paths = candidates(specifier, context.parentURL ?? ${JSON.stringify(pathToFileURL(join(HERE, 'lab-panel-backfill.mjs')).href)});
  if (paths) {
    for (const path of paths) {
      for (const attempt of [path, path + '.ts', path + '.tsx', resolvePath(path, 'index.ts')]) {
        if (existsSync(attempt) && !attempt.endsWith('.json')) return nextResolve(pathToFileURL(attempt).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    const text = readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', source: 'export default ' + text + ';', shortCircuit: true };
  }
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        isolatedModules: true,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(HOOK)}`);

/**
 * What the report PRINTED for a row, as a stable identity within its key. Accepts
 * both a stored row (snake_case, numeric columns arriving as strings) and a fresh
 * observation (camelCase), because the two must compare equal.
 */
function printedShape(row) {
  const text = value => (value === null || value === undefined ? '' : String(value)).trim().toLowerCase();
  return [
    text(row.value),
    text(row.value_text ?? row.valueText),
    text(row.unit),
    text(row.ref_text ?? row.refText),
  ].join('|');
}

/**
 * Pair the stored rows of one report with the observations a fresh extraction
 * produced. Ambiguity is never resolved by guessing: a row pairs only with an
 * observation of its own key whose printed shape is identical.
 */
function pairRows(rows, observations) {
  const queues = new Map();
  for (const observation of observations) {
    const queue = queues.get(observation.analyteKey) ?? [];
    queue.push(observation);
    queues.set(observation.analyteKey, queue);
  }

  const pairs = [];
  const unpaired = [];
  for (const row of rows) {
    const queue = queues.get(row.analyte_key) ?? [];
    const wanted = printedShape(row);
    let index = queue.findIndex(observation => printedShape(observation) === wanted);
    if (index === -1 && queue.length === 1 && rows.filter(entry => entry.analyte_key === row.analyte_key).length === 1) {
      // The only row of that key and the only observation of it: they are the same
      // reading even if a parser change altered how it is spelled.
      index = 0;
    }
    if (index === -1) {
      unpaired.push(row);
      continue;
    }
    pairs.push({ row, observation: queue[index] });
    queue.splice(index, 1);
  }

  const leftover = [...queues.values()].flat();
  return { pairs, unpaired, leftover };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dir = resolve(args.find(arg => !arg.startsWith('--')) ?? join(REPO, 'data', 'lab'));

  const config = resolveDatabaseConfig(process.env);
  if (!config.configured || config.invalid) {
    console.error(
      `[lab-panel] no usable Postgres configuration (${config.reason ?? 'unset'}). Run with: node --env-file=.env scripts/lab-panel-backfill.mjs`
    );
    process.exit(2);
  }

  const { extractLabDocument } = await import(join(SRC, 'lib/lab/extract/index.ts'));
  const { updateResultPanel } = await import(join(SRC, 'lib/db/lab-store.ts'));

  const files = readdirSync(dir).filter(name => name.toLowerCase().endsWith('.pdf'));
  const byHash = new Map();
  for (const name of files) {
    const bytes = new Uint8Array(readFileSync(join(dir, name)));
    byHash.set(sha256(bytes), { name, bytes });
  }
  console.log(`[lab-panel] ${files.length} PDF(s) in ${dir}${dryRun ? ' (dry run: nothing is written)' : ''}`);

  const client = new pg.Client({ connectionString: config.url, ssl: config.ssl ? { rejectUnauthorized: false } : undefined, application_name: 'vital-lab-panel-backfill' });
  await client.connect();

  const totals = { reports: 0, rows: 0, paired: 0, updated: 0, unpaired: 0, added: 0, missing: 0 };

  try {
    const reports = await client.query(
      `SELECT r.id,
              r.source_sha256,
              r.source_filename,
              r.document_date,
              count(l.id) AS result_count
         FROM lab_reports r
         LEFT JOIN lab_results l ON l.report_id = r.id
        GROUP BY r.id, r.source_sha256, r.source_filename, r.document_date, r.created_at
        ORDER BY r.created_at`
    );

    for (const report of reports.rows) {
      const file = byHash.get(String(report.source_sha256).toLowerCase());
      if (!file) {
        totals.missing += 1;
        continue;
      }
      byHash.delete(String(report.source_sha256).toLowerCase());
      totals.reports += 1;

      // The panel a TREND document covers comes from its FILE NAME, so the name the
      // row was imported under is the name the re-extraction must use.
      const extraction = await extractLabDocument(file.bytes, { filename: report.source_filename });
      const rows = (
        await client.query(
          `SELECT id, line_no, analyte_key, printed_name, panel, value, value_text, unit, ref_text
             FROM lab_results
            WHERE report_id = $1
            ORDER BY line_no`,
          [report.id]
        )
      ).rows;

      const { pairs, unpaired, leftover } = pairRows(rows, extraction.observations);
      totals.rows += rows.length;
      totals.paired += pairs.length;
      totals.unpaired += unpaired.length;
      totals.added += leftover.length;

      const panels = new Set();
      let changed = 0;
      for (const { row, observation } of pairs) {
        if (observation.panel !== null) panels.add(observation.panel);
        if ((row.panel ?? null) === (observation.panel ?? null)) continue;
        changed += 1;
        if (!dryRun) await updateResultPanel(client, row.id, observation.panel);
      }
      totals.updated += changed;

      const label = `${report.source_filename} (${report.result_count} stored rows)`;
      console.log(
        `\n  ${label}\n    parsed ${extraction.observations.length} observation(s), paired ${pairs.length}` +
          `, panel written on ${changed}${dryRun ? ' (would be)' : ''}`
      );
      for (const panel of panels) console.log(`    panel: ${panel}`);
      if (unpaired.length > 0) {
        console.log(`    UNPAIRED stored rows (left untouched): ${unpaired.map(row => row.analyte_key).join(', ')}`);
      }
      if (leftover.length > 0) {
        console.log(
          `    observations with no stored row (NOT imported by this script): ${leftover
            .map(observation => `${observation.analyteKey}${observation.panel ? ` [${observation.panel}]` : ''}`)
            .join(', ')}`
        );
      }
    }

    if (byHash.size > 0) {
      console.log(
        `\n  ${byHash.size} PDF(s) on disk are NOT stored as a report — nothing to backfill for them, and this script imports nothing.`
      );
    }
  } finally {
    await client.end().catch(() => {});
  }

  console.log(
    `\n[lab-panel] ${dryRun ? 'would update' : 'updated'} ${totals.updated} of ${totals.rows} stored row(s) across ${
      totals.reports
    } report(s); paired ${totals.paired}, unpaired ${totals.unpaired}, recovered-but-not-imported ${totals.added}, report(s) whose PDF is missing ${totals.missing}.`
  );
}

main().catch(error => {
  console.error(`[lab-panel] FATAL: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});