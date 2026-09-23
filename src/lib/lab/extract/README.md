# Lab document extraction

Turns an uploaded lab PDF into observations — one row per analyte **per printed date** — without
keeping any identity data. The PDF is the only copy of these results; nothing upstream holds them
(see the header of `db/migrations/0004-lab-reports.sql`).

```
bytes ─▶ pdf-items ─▶ layout ─▶ parse ─▶ (model-assist) ─▶ ExtractionResult
          geometry     structure  meaning    last resort
```

| File | Job |
| --- | --- |
| `pdf-items.ts` | Opens the PDF (server only, `pdfjs-dist` legacy build) and returns positioned text runs: `{ str, x, y, width, height }` per page. No canvas, no rendering, no images. |
| `layout.ts` | Geometry → structure: lines, the date-header row, one column per date, analyte blocks, cell→column attribution, flag attachment, wrapped text. |
| `parse.ts` | Structure → meaning: values, intervals, flags, name→canonical key, document kind, document date, redaction, confidence. |
| `model-assist.ts` | OPTIONAL second pass for a layout never seen before. Off unless the deterministic pass found nothing. |
| `index.ts` | `extractLabDocument(bytes, { filename, sha256, modelAssist, modelDeps })` — the whole pipeline. |

## Why geometry, and not a line regex

The documents interleave values and markers in the text layer, and they are trend matrices: one
header prints several dates as columns and every analyte row holds one cell per date. A line-based
regex cannot tell these apart:

```
Widget One
12.1 u/L                                   ← the flagged value, above its own name
Normal Range: 4.0 - 12.0 u/L   High   9.3 u/L   8.2 u/L
```

`High` sits beside the interval, not beside a value, and it belongs to the cell **one line up** in
the same column. The first value belongs to the first date, the other two to the next two. Only the x
position of each run resolves this.

## Tolerances, so a reviewer can reason about them

| Constant | Value | Meaning |
| --- | --- | --- |
| `LINE_TOLERANCE` | 4 pt | Runs whose baselines differ by less than this are one printed line. |
| `BLOCK_REACH` | 9 pt | A block's cells may sit this far **above** its own name line (a value printed above its name is still that analyte's). |
| `WRAP_REACH` | 20 pt | How far below a run its wrapped continuation may be. Wider than one line spacing, because a broken value's halves print on different baselines. |
| `JOIN_GAP` | 2 pt | A following run joins the cell above it only if their x ranges overlap within this. |
| column band | half the gap | Each date's band reaches the midpoint of the empty space to the next centre; the outermost bands mirror their one adjacent gap. |

A cell is attributed to the **nearest column centre**. If its x range touches no band — a cell outside
the table, or a table whose header could not be read — the cell is skipped with a warning
(`cell_out_of_columns`, `cell_outside_block`) rather than guessed into a column. A flag in a column
with no value warns `flag_without_value` and is not attached to anything.

Everything above is covered by `layout.test.ts`, which builds item lists with explicit x/y.

## What is stored, and what never is

Stored: the analyte keys and printed names, each result's own date, the value or its printed text, the
unit exactly as printed, the interval exactly as printed, the report's own flag, the lab name, and the
document's filename/hash/size. Units are never converted at rest.

Never stored, anywhere (not in `source_line`, not in a rejection, not in a prompt, not in a log): the
patient's name, date of birth, address, phone, SSN field, physician name or NPI. `redact()` replaces a
whole identity/contact/provider line with `[redacted: identity or provider details]`; `source_line`
holds the analyte row's own text only. `hasPii`/`redact` are unit-tested, and the end-to-end tests
assert that no identity string appears anywhere in the result. A value that cannot be read is `null` —
never `0`, never a guess.

## Measured limits

Against four real trend documents plus one real order form (run locally with the audit tool below,
which prints counts, kinds and analyte names — never a measured value):

* 198 observations from the four result documents: 80 (20 analytes × 4 dates), 8 (2 × 4, including a
  derived metric kept as its own analyte), 15 (5 × 3) and 95 (19 × 5). Aliases resolved: `SGPT (ALT)`,
  `SGOT (AST)`, `Glycohemoglobin (GHb),Total`, `CHD`, `NE%/LY%/MO%/EO%/BA%`, `NE#/LY#/MO#/EO#/BA#`.
* The order form is detected as `kind: 'order'`, produces 0 observations and says so in `notes`;
  its 56 refused lines carry a reason each.
* Two analytes printing the same name (`Protein Total`) with different intervals both survive, with
  their own intervals — nothing is deduplicated by display name.
* 1–2 pages, ~30–320 ms per document.

Deliberate limits:

* **No OCR.** A page with no text layer raises `page_without_text` ("looks like a scan; OCR is not
  implemented") and yields no rows — never silently empty ones.
* **No external reference ranges.** Intervals come only from what the document prints
  (`ref_source = 'report'`). `reference_table` and `manual` exist in the schema but nothing in this
  pipeline populates them, and no sex/age band is inferred from a document; `profile.sex` is
  owner-set and `ref_basis` only ever records a band the document itself printed.
* **The alias map is fixed.** An unseen synonym becomes a slug of its printed name (e.g.
  `Some New Marker` → `some_new_marker`) instead of a canonical key. The printed name is always kept,
  so nothing is lost, but the key will not match an existing series.
* **A wrap is joined only when the geometry supports it.** A name is joined to the line below only
  when that line is the interval (or another name fragment); a value is joined to the line below only
  when their x ranges overlap within `JOIN_GAP`. A wrap with a larger horizontal offset is left as two
  cells and the second is refused with a reason rather than merged.
* **One date header per page.** A page whose header is not recognised yields no rows and warns
  `no_column_header`. A trend document that repeats its dates only once for several pages is not
  supported.
* **No document date is invented.** Explicit printed field → the file's own creation date → the
  filename → `null` plus a `document_date_absent` warning.

## The optional model pass

Runs only when the deterministic pass produced no analyte rows at all, and only when the existing
analyst provider is configured (`src/lib/analyst/config.ts` + `provider.ts` — no parallel env vars).
It sends bounded, **PII-stripped** text (`MAX_PROMPT_LINES` 240, `MAX_PROMPT_LINE_CHARS` 160), and
keeps a row only if its printed name, value, printed text, unit, interval, flag and date appear
verbatim in the document (`MAX_CANDIDATES` 200). Everything else is dropped and reported. Surviving
rows carry `extraction_method: 'model'`, and `ExtractionResult.pass` states which pass produced the
rows. A readable document never reaches the network.

## Checking a new layout

```
node scripts/lab-audit.mjs <file.pdf> [<file.pdf> …]      # local only; outside the repo's tests
```

It prints, per file: kind, pass, document date, lab, page count, observations, warnings, refusals,
per-analyte counts (key, count, distinct dates, printed name) and the reasons rows were refused.
Then, in order:

1. **`kind` unknown?** The date-header row was not recognised. Check for `no_column_header`. Confirm
   the header line prints at least two dates as separate runs, or one date plus a first column labelled
   `Component`.
2. **Observations 0 with `page_without_text`?** The page is a scan. Nothing to fix without OCR.
3. **Refusals other than the furniture reasons** (`document_title`, `notice_line`, `table_caption`,
   `identity_line`, `letterhead_line`, `not_a_result_line`, `column_header`, `order_entry`,
   `non_metric_row`, `outside_table_region`, `no_result`, `empty`)? A result row is being refused:
   read the reason, then extend `classifyLine` or the block rules.
4. **Fewer observations than analytes × dates?** Look for `cell_out_of_columns`,
   `cell_outside_block`, `flag_without_value` and `unparsable_value` warnings — the document's
   geometry or value form is new.
5. **Unexpected keys in the analyte list?** Add the printed synonym to the alias map in `parse.ts`.
6. **`value` null where a number was expected?** The printed form is unreadable; add it to
   `parseValueCell` (as `valueText`, never as a fabricated number).

Then add a synthetic PDF to `scripts/make-lab-fixtures.mjs` reproducing the new geometry, and an
end-to-end expectation in `extract.test.ts`, **before** changing a tolerance. Loosening a tolerance
to make one document work is how a parser starts mis-assigning cells in another.