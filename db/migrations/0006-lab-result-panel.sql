-- ── 0006 — the panel a result row came from ─────────────────────────────────
--
-- AMENDMENT TO 0004. A lab document prints its results under a PANEL heading —
-- `LIPID PANEL WITH RATIOS`, `URINALYSIS, COMPLETE`, `COMPREHENSIVE METABOLIC
-- PANEL` — and, for the LabCorp trend exports, names the panel in the file name
-- instead. 0004 stored no such thing, so nothing recorded which panel or which
-- SPECIMEN a row came from, and a urine dipstick row (glucose, `NEGATIVE`) sat
-- in the same series as a serum chemistry row (glucose, 78 mg/dL).
--
-- `panel` is the heading the report itself printed (or the panel its own file
-- name states), NULL when the document printed none for that row. It is a LABEL,
-- never a judgement: nothing here says what a value means.
--
-- The panel is what tells the two specimens apart, because a label that names a
-- urinalysis panel is the report's own statement that the rows under it came
-- from urine. The series read model keeps a urinalysis series and a blood series
-- of the same analyte separate, so a dipstick result can never be drawn, scored
-- or differenced against a mg/dL series (see lab-store.ts).
--
-- Additive and nullable, so existing rows stay valid unchanged — their `panel`
-- is filled by the re-extraction the same gate ships (`npm run lab:backfill`).
-- IMMUTABLE ONCE SHIPPED: a later change arrives as the next numbered file (see
-- migrate-core.mjs).

ALTER TABLE lab_results
  ADD COLUMN IF NOT EXISTS panel TEXT;

COMMENT ON COLUMN lab_results.panel IS
  'The panel heading the report printed above this row (or the panel the file name states), exactly as printed. NULL when the document printed none for the row. Used to keep a urine series apart from a blood series of the same analyte.';

-- The read path's per-series history query — one analyte's rows within one panel,
-- oldest first — uses this the way `lab_results_analyte_idx` serves the
-- per-analyte one.
CREATE INDEX IF NOT EXISTS lab_results_analyte_panel_idx
  ON lab_results (analyte_key, panel, result_on);
