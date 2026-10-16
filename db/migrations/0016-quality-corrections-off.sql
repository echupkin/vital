-- ── 0016 — data-quality corrections turned off ──────────────────────────────
--
-- Vital corrects two data-quality findings itself (see
-- `src/lib/adapters/quality-correct.ts`): records that only repeat others —
-- the finer records beside an hourly total that already contains them, and
-- on-the-hour copies of a reading — are left out of Vital's own totals. The
-- export server is never changed. The correction is ON by default; a row here
-- means the reader turned it off for that check in Settings → Connections, and
-- removing the row ("Fix it") turns it on again.
--
-- HARD RULE, unchanged from 0001: no health data ever reaches this database.
-- A row is CONFIGURATION: which check. It never holds a record, a day or a
-- value — which records repeat is recomputed from the health data every load.
--
--   check_id   a correctable QualityCheckId ('overlapping-exports', 'duplicate-readings')
--
-- Immutable once shipped (see migrate-core.mjs).

CREATE TABLE IF NOT EXISTS quality_correction_off (
  check_id      TEXT        PRIMARY KEY,
  turned_off_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
