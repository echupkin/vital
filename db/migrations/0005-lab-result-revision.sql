-- ── 0005 — per-observation revision ─────────────────────────────────────────
--
-- AMENDMENT TO 0004. A manual correction edits ONE observation; the reader has
-- to be able to tell a corrected row from one the parser produced. 0004 gave
-- `lab_reports` a revision counter but not `lab_results`, so a correction could
-- only flip `extraction_method` and there was no way to say how many times the
-- row had been touched.
--
-- This adds that counter. It is additive and defaulted, so existing rows are
-- valid unchanged. IMMUTABLE ONCE SHIPPED: a later change arrives as the next
-- numbered file (see migrate-core.mjs).

ALTER TABLE lab_results
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE lab_results
  ADD CONSTRAINT lab_results_revision_positive CHECK (revision >= 1);

COMMENT ON COLUMN lab_results.revision IS
  'How many times this observation has been written. Stays 1 for a parsed row; a manual correction bumps it and sets extraction_method = manual.';