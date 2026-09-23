#!/usr/bin/env node
// ── Lab extraction audit (LOCAL ONLY) ────────────────────────────────────────
//
//   node scripts/lab-audit.mjs <pdf> [<pdf> …]
//
// Runs the real lab extractor (src/lib/lab/extract) over PDF files given as
// arguments and prints, per file, what the parser made of it:
//
//   * the kind it decided on, and the document date and lab name it read;
//   * how many analyte blocks it found, how many OBSERVATIONS it wrote, and how
//     many printed lines it refused — with the reason for each refusal;
//   * every warning it raised;
//   * the canonical keys and printed names it recognised, with a per-key count.
//
// WHAT IT DELIBERATELY DOES NOT PRINT. It prints COUNTS and ANALYTE NAMES, never
// a measured value and never a raw document line, because the files it is meant
// to be pointed at are the owner's real medical records. Refused lines are
// printed as their REASON only. Nothing is written anywhere: this script is a
// measurement tool, it is not imported by any committed test, and it touches no
// database.
//
// It is run through Node's own TypeScript type-stripping, with a small resolver
// hook (below) that teaches Node the two things this repo does that Node does not
// do on its own: the `@/` path alias from tsconfig, and extension-less relative
// imports of `.ts` files. No build step, no extra dependency.

import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SRC = join(REPO, 'src');

// Node cannot resolve `@/x` or `./x` (no extension) in a .ts tree, and its own
// type-stripping rejects TypeScript parameter properties (which this repo uses),
// so the hook both resolves and transpiles. The transpiler is the project's own
// `typescript` devDependency — nothing new is installed to run this.
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
  const paths = candidates(specifier, context.parentURL ?? ${JSON.stringify(pathToFileURL(join(HERE, 'lab-audit.mjs')).href)});
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

/** Pretty column headings. */
function heading(text) {
  console.log(`\n${'─'.repeat(78)}\n${text}\n${'─'.repeat(78)}`);
}

async function main() {
  const files = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (files.length === 0) {
    console.error('usage: node scripts/lab-audit.mjs <pdf> [<pdf> …]');
    process.exit(2);
  }

  const { extractLabDocument } = await import(join(SRC, 'lib/lab/extract/index.ts'));

  const totals = { files: 0, observations: 0, blocks: 0, warnings: 0, rejections: 0 };

  for (const file of files) {
    totals.files++;
    let bytes;
    try {
      bytes = new Uint8Array(await readFile(file));
    } catch (error) {
      heading(`${file}`);
      console.log(`  unreadable: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    heading(`${file}  (${bytes.byteLength} bytes)`);

    let result;
    const started = Date.now();
    try {
      result = await extractLabDocument(bytes, { filename: file });
    } catch (error) {
      console.log(`  the parser threw: ${error instanceof Error ? error.stack : String(error)}`);
      continue;
    }
    const elapsed = Date.now() - started;

    console.log(`  kind           ${result.kind}`);
    console.log(`  pass           ${result.pass}`);
    console.log(`  document date  ${result.documentDate ?? '(none printed)'}`);
    console.log(`  lab          ${result.labName ?? '(not named in the document)'}`);
    console.log(`  pages          ${result.pageCount}`);
    console.log(`  observations   ${result.observations.length}`);
    console.log(`  warnings       ${result.warnings.length}`);
    console.log(`  refusals       ${result.rejections.length}`);
    console.log(`  took           ${elapsed} ms`);
    if (result.notes) console.log(`  notes          ${result.notes}`);

    // Per-analyte counts: keys and printed NAMES only, never a value.
    const byKey = new Map();
    for (const observation of result.observations) {
      const entry = byKey.get(observation.analyteKey) ?? { names: new Set(), dates: new Set(), count: 0 };
      entry.names.add(observation.printedName);
      entry.dates.add(observation.resultOn);
      entry.count++;
      byKey.set(observation.analyteKey, entry);
    }
    console.log(`  analytes       ${byKey.size}`);
    for (const [key, entry] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(
        `      ${key.padEnd(28)} ${String(entry.count).padStart(3)} obs  ${String(entry.dates.size).padStart(2)} dates  printed: ${[
          ...entry.names,
        ].join(' / ')}`
      );
    }

    if (result.warnings.length > 0) {
      console.log('  warning codes:');
      const codes = new Map();
      for (const warning of result.warnings) codes.set(warning.code, (codes.get(warning.code) ?? 0) + 1);
      for (const [code, count] of [...codes.entries()].sort()) console.log(`      ${code.padEnd(28)} ${count}`);
    }

    if (result.rejections.length > 0) {
      console.log('  refusal reasons:');
      const reasons = new Map();
      for (const rejection of result.rejections) reasons.set(rejection.reason, (reasons.get(rejection.reason) ?? 0) + 1);
      for (const [reason, count] of [...reasons.entries()].sort()) console.log(`      ${reason.padEnd(28)} ${count}`);
    }

    // Sources of the printed names, so a new layout's vocabulary is visible.
    console.log(`  printed names (${[...byKey.values()].reduce((sum, entry) => sum + entry.names.size, 0)}):`);
    const names = [...byKey.values()].flatMap(entry => [...entry.names]).sort();
    console.log(`      ${names.join(', ')}`);

    totals.observations += result.observations.length;
    totals.blocks += byKey.size;
    totals.warnings += result.warnings.length;
    totals.rejections += result.rejections.length;
  }

  heading('totals');
  console.log(`  files          ${totals.files}`);
  console.log(`  analytes       ${totals.blocks}`);
  console.log(`  observations   ${totals.observations}`);
  console.log(`  warnings       ${totals.warnings}`);
  console.log(`  refusals       ${totals.rejections}`);
  console.log('');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

