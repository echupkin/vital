-- ── 0009 — activity maps ────────────────────────────────────────────────────
--
-- Activity → Maps shows any number of maps of where outdoor workouts went. Each
-- map is an AREA the reader framed (a bounding box), a name, and the display
-- choices saved with it: which activity types to draw, what the line colour
-- means, the basemap and the date range. See `src/lib/activity-maps/types.ts`.
--
-- HARD RULE, unchanged from 0001: no health data ever reaches this database. A
-- map is CONFIGURATION: four coordinates and a few ids. It never holds a route,
-- a GPS point, a heart-rate reading or any other observation — routes are read
-- live from the source on every request, held in server memory only, and never
-- stored. The box itself is a location the reader chose (often near home),
-- which is why it is kept here and nowhere else, and never logged.
--
-- `bbox` and `settings` are JSONB because each is always read and written whole
-- and validated by the application on the way in and out. As with the theme
-- picks there is deliberately no CHECK on metric or basemap ids: a new one would
-- otherwise need a migration, and an unknown one reads back as the default.

CREATE TABLE IF NOT EXISTS activity_maps (
  id         TEXT         PRIMARY KEY,
  position   INTEGER      NOT NULL,
  name       TEXT         NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  bbox       JSONB        NOT NULL,
  settings   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  revision   INTEGER      NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_maps_position ON activity_maps (position);

COMMENT ON TABLE activity_maps IS
  'Activity maps (configuration only — a framed area and display choices, never a route or observation).';
COMMENT ON COLUMN activity_maps.bbox IS
  'The framed area: {south, west, north, east} in degrees.';
COMMENT ON COLUMN activity_maps.settings IS
  'Display choices: {activityTypes, metric, basemap, range}. Unknown ids read back as defaults.';
COMMENT ON COLUMN activity_maps.revision IS
  'Bumped on every write; a write naming a stale revision is refused.';
