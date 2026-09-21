-- ── 0002 — value constraints ────────────────────────────────────────────────
--
-- Tightens the two configuration tables with the same rules the application
-- validates, so an out-of-range value cannot be stored by a hand-written INSERT
-- (or by a bug in a future writer) even though the API already rejects it.
--
-- Immutable once shipped: 0001 is never edited, the rules arrive as a new file.
-- Nothing here adds, drops or renames a column, and no health data is involved.

ALTER TABLE profile
  ADD CONSTRAINT profile_briefing_hour_range CHECK (briefing_hour BETWEEN 0 AND 23);

ALTER TABLE profile
  ADD CONSTRAINT profile_timezone_present CHECK (length(btrim(timezone)) > 0);

ALTER TABLE profile
  ADD CONSTRAINT profile_revision_positive CHECK (revision >= 0);

ALTER TABLE profile
  ADD CONSTRAINT profile_schema_version_positive CHECK (schema_version >= 1);

ALTER TABLE preferences
  ADD CONSTRAINT preferences_units_known CHECK (units IN ('metric', 'imperial'));

ALTER TABLE preferences
  ADD CONSTRAINT preferences_theme_known CHECK (theme IN ('light', 'dark', 'system'));

ALTER TABLE preferences
  ADD CONSTRAINT preferences_revision_positive CHECK (revision >= 0);

ALTER TABLE preferences
  ADD CONSTRAINT preferences_schema_version_positive CHECK (schema_version >= 1);
