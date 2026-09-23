-- ── 0004 — uploaded lab reports and their observations ───────────────────────
--
-- AMENDMENT TO 0001. 0001 stated the hard rule "no health data ever reaches this
-- database", and 0003 restated it for the analyst store. This migration narrows
-- that rule; it does not drop it.
--
--   WHY THE RULE IS NARROWED HERE. The rule exists to keep health history in the
--   one place that already owns it: the Health Auto Export source, which is the
--   upstream system of record and is fetched server-side and normalised in
--   process. That reasoning does not hold for a lab report. A lab result has NO
--   upstream system of record: the PDF a person downloads from the lab's portal
--   is the only copy the application will ever see, and a portal may not keep it
--   forever. Refusing to store it would mean the application cannot show the
--   person their own results at all. So the uploaded document and the
--   observations read out of it are stored here.
--
--   WHAT DOES NOT CHANGE. HAE-sourced history continues to stay out: no metric
--   series, no workouts, no sleep episodes, no daily readings. The analyst store
--   (0003) is untouched. This migration adds two tables and one nullable column
--   to `profile`, and relaxes 0001's rule for those two tables only.
--
-- ── PRIVACY (mandatory) ──────────────────────────────────────────────────────
-- A lab PDF also carries the person's name, date of birth, home address, phone
-- number, an SSN field, and the ordering physician's name and NPI. NONE OF THAT
-- IS STORED. There is no column for any of it, and none may be added. The two
-- tables below hold:
--   * the DOCUMENT: what kind of PDF it was, the date the document was produced,
--     the lab's name, the file's name/size/hash, a page count, and the parser's
--     own bookkeeping;
--   * the OBSERVATIONS: lab metric, its value and unit, the reference interval
--     exactly as printed, the report's own flag token, and the analyte row's own
--     text in `source_line`.
-- The extractor redacts identity lines before they can reach `source_line` (see
-- src/lib/lab/extract/README.md). `source_line` holds the ANALYTE ROW only.
--
-- ── WHY lab_results IS ONE ROW PER OBSERVATION ───────────────────────────────
-- The lab's "Result Trends" documents are TREND MATRICES: one table header
-- carries several dates as columns, and each analyte row holds one cell per
-- date. One uploaded document therefore yields many observations per analyte,
-- each with its own `result_on` (the column date it belongs to) — never the
-- document's own date.
--
-- IMMUTABLE ONCE SHIPPED (see migrate-core.mjs): a later change arrives as a new
-- file with the next version number. The runner creates its own
-- `schema_migrations` bookkeeping table; it is not declared here.

-- ── The uploaded DOCUMENT ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_reports (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the parser decided the PDF is: a results table, an order form, or
  -- neither. An order form is a real, recognised outcome that yields no rows.
  kind            TEXT         NOT NULL CHECK (kind IN ('results', 'order', 'unknown')),
  -- The date the DOCUMENT itself was produced: an explicit field in its text,
  -- else its embedded creation date, else the date in its filename. NULL when
  -- none of those existed. NEVER invented, and never a date lifted from a result
  -- cell — those are `lab_results.result_on`.
  document_date   DATE,
  lab_name        TEXT,
  source_filename TEXT         NOT NULL,
  -- Content hash of the uploaded bytes: identifies the document and makes a
  -- re-upload of the same file recognisable.
  source_sha256   TEXT         NOT NULL UNIQUE,
  source_bytes    INTEGER      NOT NULL,
  page_count      INTEGER,
  -- The parser's own bookkeeping: its version, which pass produced the rows, the
  -- counts, and every warning it raised. Bounded metadata — never the PDF, never
  -- the document's text, never a person's identity.
  extraction      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  notes           TEXT,
  schema_version  INTEGER      NOT NULL DEFAULT 1,
  revision        INTEGER      NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE lab_reports IS
  'One uploaded lab PDF per row. It may carry several dates as COLUMNS, so its observations live in lab_results, one row each.';
COMMENT ON COLUMN lab_reports.kind IS
  'What the parser decided: results (a results table), order (an order form — recognised, yields no results), unknown.';
COMMENT ON COLUMN lab_reports.document_date IS
  'When the document itself was produced (explicit field, else its embedded creation date, else its filename). NULL when none was printed; never invented.';
COMMENT ON COLUMN lab_reports.lab_name IS
  'The laboratory, only when it named itself in the document text.';
COMMENT ON COLUMN lab_reports.source_sha256 IS
  'SHA-256 of the uploaded bytes. Unique, so re-uploading the same file is recognisable.';
COMMENT ON COLUMN lab_reports.extraction IS
  'Parser bookkeeping: parser version, which pass produced the rows, counts and warnings. Bounded metadata — never the document''s text or anyone''s identity.';
COMMENT ON COLUMN lab_reports.notes IS
  'A short human note about the document, e.g. why an order form produced no results. Never identity data.';

-- ── ONE OBSERVATION ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_results (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID         NOT NULL REFERENCES lab_reports (id) ON DELETE CASCADE,
  -- The observation's position in the document: 1-based, ordered by page, then
  -- top to bottom, then left to right. Unique per report because two cells on one
  -- printed line are two distinct observations.
  line_no           INTEGER      NOT NULL,
  -- Canonical key for the analyte (alt, hba1c, cholesterol_hdl_ratio, …). The
  -- printed name is preserved alongside it and is what a reader sees.
  analyte_key       TEXT         NOT NULL,
  -- The name as the report printed it, including any wrap ("Glycohemoglobin
  -- (GHb),Total"). Two analytes may print the SAME name with different ranges;
  -- they are two rows and must never be merged.
  printed_name      TEXT         NOT NULL,
  -- The COLUMN date this value belongs to — not the document's date.
  result_on         DATE         NOT NULL,
  value             NUMERIC,
  -- The printed string whenever the result is not a plain number ("<0.5",
  -- "Negative", "TRACE", "+").
  value_text        TEXT,
  -- The unit EXACTLY as printed. No conversion happens at rest.
  unit              TEXT,
  ref_low           NUMERIC,
  ref_high          NUMERIC,
  -- The reference interval exactly as printed, e.g. ">40 mg/dL", "0.00 - 4.44 ratio".
  ref_text          TEXT,
  ref_source        TEXT         NOT NULL CHECK (ref_source IN ('report', 'reference_table', 'manual', 'none')),
  -- Which age/sex band the interval came from, e.g. "male 30-39". NULL when the
  -- report printed a single interval, which is the usual case.
  ref_basis         TEXT,
  -- The report's OWN marker, as printed: High, Low, HH, LL, A, …
  printed_flag      TEXT,
  category          TEXT,
  -- Which pass produced the row.
  extraction_method TEXT         NOT NULL CHECK (extraction_method IN ('deterministic', 'model', 'manual')),
  confidence        NUMERIC,
  -- The analyte row's own text. NEVER the patient identity line: the extractor
  -- redacts those before they can reach this column.
  source_line       TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- A result must say SOMETHING: a number, or the text that was printed instead.
  CONSTRAINT lab_results_value_present CHECK (value IS NOT NULL OR value_text IS NOT NULL),
  CONSTRAINT lab_results_analyte_key_present CHECK (length(btrim(analyte_key)) > 0),
  CONSTRAINT lab_results_printed_name_present CHECK (length(btrim(printed_name)) > 0)
);

COMMENT ON TABLE lab_results IS
  'One OBSERVATION read out of a lab document: one analyte on one result date. A trend matrix yields many rows per document.';
COMMENT ON COLUMN lab_results.line_no IS
  'The observation''s reading-order position in the document (page, then top to bottom, then left to right). Unique per report.';
COMMENT ON COLUMN lab_results.analyte_key IS
  'Canonical analyte key from the alias map; an unrecognised name falls back to a slug of the printed name rather than being dropped.';
COMMENT ON COLUMN lab_results.printed_name IS
  'The analyte name exactly as printed. Duplicate names with different ranges legitimately coexist as separate rows and are never merged.';
COMMENT ON COLUMN lab_results.result_on IS
  'The COLUMN date this value belongs to. The document date is lab_reports.document_date; they are not the same thing.';
COMMENT ON COLUMN lab_results.value IS
  'The numeric result, or NULL when the report printed a non-numeric result (then value_text holds what it printed). Never 0 as a filler.';
COMMENT ON COLUMN lab_results.value_text IS
  'The printed result string when it is not a plain number: "<0.5", "Negative", "TRACE", "+".';
COMMENT ON COLUMN lab_results.unit IS
  'The unit EXACTLY as printed. Nothing is converted at rest.';
COMMENT ON COLUMN lab_results.ref_low IS
  'Lower bound of the printed interval, or NULL for a one-sided interval (see ref_text, which keeps the printed form).';
COMMENT ON COLUMN lab_results.ref_high IS
  'Upper bound of the printed interval, or NULL for a one-sided interval (see ref_text, which keeps the printed form).';
COMMENT ON COLUMN lab_results.ref_text IS
  'The reference interval exactly as printed, including the printed form of a one-sided interval (">40 mg/dL", "<100 mg/dL").';
COMMENT ON COLUMN lab_results.ref_source IS
  'Where the interval came from: the report line itself, a separate reference table, the owner, or none found.';
COMMENT ON COLUMN lab_results.ref_basis IS
  'Which age/sex band the interval was printed for, when the report said so. NULL for the usual single interval.';
COMMENT ON COLUMN lab_results.printed_flag IS
  'The report''s own marker exactly as printed (High, Low, HH, LL, A). Not computed here and never invented.';
COMMENT ON COLUMN lab_results.category IS
  'A coarse grouping for layout, assigned by a later gate. NULL until then — the extractor does not guess one from a name.';
COMMENT ON COLUMN lab_results.extraction_method IS
  'Which pass produced the row: deterministic (geometry, no model), model (the optional validated second pass), or manual.';
COMMENT ON COLUMN lab_results.confidence IS
  'A simple completeness score in [0,1]: how many of name, value, unit and interval were read. Not statistical, not clinical.';
COMMENT ON COLUMN lab_results.source_line IS
  'The ANALYTE ROW''s own text. Identity lines are redacted by the extractor and can never reach this column.';

-- The two queries that actually run:
--   1. one analyte's history, oldest first — the trend chart;
CREATE INDEX IF NOT EXISTS lab_results_analyte_idx
  ON lab_results (analyte_key, result_on);

--   2. every observation of one uploaded document.
CREATE INDEX IF NOT EXISTS lab_results_report_idx
  ON lab_results (report_id);

-- One observation per reading-order position, so a re-run cannot duplicate a row.
ALTER TABLE lab_results
  ADD CONSTRAINT lab_results_report_line_unique UNIQUE (report_id, line_no);

-- The document's own bookkeeping is already unique by content hash (the column's
-- UNIQUE above). The counts it carries must not be negative.
ALTER TABLE lab_reports
  ADD CONSTRAINT lab_reports_schema_version_positive CHECK (schema_version >= 1);

ALTER TABLE lab_reports
  ADD CONSTRAINT lab_reports_revision_positive CHECK (revision >= 0);

ALTER TABLE lab_reports
  ADD CONSTRAINT lab_reports_source_bytes_positive CHECK (source_bytes > 0);

-- ── profile.sex ──────────────────────────────────────────────────────────────
--
-- Lab reference intervals are frequently sex-specific, and a document printed
-- for one sex cannot be re-banded without knowing whose it is. This column is
-- set by the OWNER and is used SOLELY to choose which printed band applies.
-- It is NEVER inferred from a document: a scan of a printed "Sex: M" is a fact
-- about the paperwork, not a licence to write it into the profile.

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS sex TEXT;

ALTER TABLE profile
  ADD CONSTRAINT profile_sex_known CHECK (sex IS NULL OR sex IN ('male', 'female'));

COMMENT ON COLUMN profile.sex IS
  'Owner-set only. Used solely to select sex-specific reference bands; never inferred from an uploaded document.';