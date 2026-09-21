-- ── 0001 — configuration tables ──────────────────────────────────────────────
--
-- Vital stores CONFIGURATION here and nothing else.
--
--   HARD RULE: no health data ever reaches this database. No observations, no
--   metric series, no workouts, no sleep episodes, no briefing text, no analyst
--   transcripts. Health history stays where it is produced and read: the Health
--   Auto Export source, fetched server-side and normalised in process.
--
-- What lives here is the same information the JSON files held before:
--   * `profile`      — the five fields the health report cannot contain:
--                      display name, date of birth, a note, the IANA timezone
--                      the app's calendar days are cut on, and the hour a new
--                      briefing may be written.
--   * `preferences`  — display choices: unit system, theme, notification flags.
--
-- Both tables are the OWNER'S SINGLE RECORD today (`id` is pinned to 1 by a CHECK
-- constraint below). Multi-tenancy is NOT built: a later migration would add a
-- `user_id` column, drop that CHECK and add a unique index on the new column.
-- Nothing in this schema assumes a single owner beyond that one constraint.
--
-- Every row carries `schema_version`, `revision` and `updated_at`:
--   * `schema_version` — the version of the APPLICATION RECORD SHAPE stored in
--     the row, so a future field change can be migrated row by row;
--   * `revision`       — bumped on every write; the API hands it to the client
--     so a stale write is rejected (409) instead of silently clobbering a
--     change made in another browser;
--   * `updated_at`     — when the row was last written, set by the database.
--
-- The runner creates its own `schema_migrations` bookkeeping table; it is not
-- declared here, so re-running this file can never disturb it.

CREATE TABLE IF NOT EXISTS profile (
  id             SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name           TEXT,
  date_of_birth  DATE,
  notes          TEXT,
  timezone       TEXT         NOT NULL,
  briefing_hour  SMALLINT     NOT NULL,
  schema_version INTEGER      NOT NULL DEFAULT 1,
  revision       INTEGER      NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE profile IS
  'The owner''s single profile record. Configuration only — no health data.';
COMMENT ON COLUMN profile.date_of_birth IS
  'ISO calendar date (YYYY-MM-DD). Optional; only the derived age is ever used as context.';
COMMENT ON COLUMN profile.timezone IS
  'IANA timezone. The single source of truth for the app''s calendar days.';
COMMENT ON COLUMN profile.briefing_hour IS
  'Local hour (0-23) at/after which a new briefing may be written.';
COMMENT ON COLUMN profile.revision IS
  'Bumped on every write; a client write carrying a stale revision is rejected with 409.';

CREATE TABLE IF NOT EXISTS preferences (
  id             SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  units          TEXT         NOT NULL,
  theme          TEXT         NOT NULL,
  notifications  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  schema_version INTEGER      NOT NULL DEFAULT 1,
  revision       INTEGER      NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE preferences IS
  'The owner''s single display-preferences record. Configuration only — no health data.';
COMMENT ON COLUMN preferences.notifications IS
  'Feature-highlight flags: {dailyBriefing, weeklyReport, staleData}. Nothing is scheduled or delivered.';
COMMENT ON COLUMN preferences.revision IS
  'Bumped on every write; a client write carrying a stale revision is rejected with 409.';

-- A future migration for the AI conversation store (part B) belongs in a NEW
-- file with the next version number. It is deliberately not created here.
