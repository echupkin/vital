-- ── 0003 — analyst conversations and their turns ─────────────────────────────
--
-- The AI Analyst's conversations live here: a conversation, its turns, and the
-- provenance each answer was produced with. This is the record the reader sees
-- survive a refresh, a different browser and a different device.
--
-- HARD RULE, unchanged from 0001: no health data ever reaches this database.
-- There is no column for an observation, a metric series or a workout, and none
-- may be added. A message stores:
--   * the TEXT the reader saw (the question, or the answer rendered as text);
--   * its PROVENANCE (which provider, which model, which handler, the status);
--   * the bounded EVIDENCE payload the answer was grounded in — evidence cards
--     (metric id, window label, aggregation, sample count, link), the retrieval
--     note and per-metric observation COUNTS, the grounding audit and the
--     untrusted-notes note. Never a raw value, never a series: the chart series
--     an answer drew are deliberately NOT persisted, which is why a reloaded
--     answer shows its evidence cards and follow-ups but not its sparkline.
--
-- The runner creates its own `schema_migrations` bookkeeping table; it is not
-- declared here, so re-running this file can never disturb it.
--
-- Immutable once shipped (see migrate-core.mjs): a later change arrives as a
-- new file with the next version number.

CREATE TABLE IF NOT EXISTS analyst_conversations (
  id             BIGSERIAL    PRIMARY KEY,
  title          TEXT         NOT NULL DEFAULT 'New conversation',
  -- How many turns the conversation holds. Derived from analyst_messages by the
  -- writer on every append; kept so the list can show it without a second query.
  message_count  INTEGER      NOT NULL DEFAULT 0,
  archived_at    TIMESTAMPTZ,
  schema_version INTEGER      NOT NULL DEFAULT 1,
  revision       INTEGER      NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE analyst_conversations IS
  'One AI-Analyst conversation per row. Configuration and provenance only — no health data.';
COMMENT ON COLUMN analyst_conversations.title IS
  'Derived from the opening question unless the reader renames it.';
COMMENT ON COLUMN analyst_conversations.message_count IS
  'Turn count, refreshed by the writer on every append. Derived, not authoritative.';
COMMENT ON COLUMN analyst_conversations.archived_at IS
  'Set when the conversation is put away instead of deleted; NULL while it is live.';
COMMENT ON COLUMN analyst_conversations.revision IS
  'Bumped on every write to the conversation row, so a rename cannot silently overwrite.';

CREATE TABLE IF NOT EXISTS analyst_messages (
  id              BIGSERIAL   PRIMARY KEY,
  conversation_id BIGINT      NOT NULL REFERENCES analyst_conversations (id) ON DELETE CASCADE,
  role            TEXT        NOT NULL,
  content         TEXT        NOT NULL,
  title           TEXT,
  status          TEXT,
  provider        TEXT,
  model           TEXT,
  attribution     TEXT,
  handler_id      TEXT,
  payload         JSONB,
  schema_version  INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE analyst_messages IS
  'The turns of an analyst conversation: the text shown plus its provenance. No health data.';
COMMENT ON COLUMN analyst_messages.role IS
  'user — a question as typed; assistant — an answer (or the honest explanation shown instead).';
COMMENT ON COLUMN analyst_messages.content IS
  'The text the reader saw. For an assistant turn that produced an answer, the rendered answer; otherwise the message shown in its place.';
COMMENT ON COLUMN analyst_messages.status IS
  'The analyst status of the turn: ok, unsupported, misconfigured or error. NULL for a question.';
COMMENT ON COLUMN analyst_messages.attribution IS
  'The provenance line the UI shows, e.g. "OpenAI-compatible · gpt-4o-mini" or "Demo analyst · handler sleep-1-month".';
COMMENT ON COLUMN analyst_messages.payload IS
  'Bounded structured evidence for an assistant turn (evidence cards, retrieval note and counts, grounding audit). Never a raw value or a series.';
COMMENT ON COLUMN analyst_messages.handler_id IS
  'The retrieval handler that selected the context, or "general" for a free-form question.';

-- The two queries that actually run:
--   1. the conversation list, newest activity first, live conversations only;
CREATE INDEX IF NOT EXISTS analyst_conversations_recent_idx
  ON analyst_conversations (updated_at DESC, id DESC)
  WHERE archived_at IS NULL;

--   2. one conversation's turns, in the order they were said.
CREATE INDEX IF NOT EXISTS analyst_messages_conversation_idx
  ON analyst_messages (conversation_id, created_at, id);

-- Value constraints, mirroring what the API already validates, so a hand-written
-- INSERT (or a bug in a future writer) cannot store a shape the app refuses.
ALTER TABLE analyst_conversations
  ADD CONSTRAINT analyst_conversations_title_present CHECK (length(btrim(title)) > 0);

ALTER TABLE analyst_conversations
  ADD CONSTRAINT analyst_conversations_message_count_positive CHECK (message_count >= 0);

ALTER TABLE analyst_conversations
  ADD CONSTRAINT analyst_conversations_schema_version_positive CHECK (schema_version >= 1);

ALTER TABLE analyst_conversations
  ADD CONSTRAINT analyst_conversations_revision_positive CHECK (revision >= 0);

ALTER TABLE analyst_messages
  ADD CONSTRAINT analyst_messages_role_known CHECK (role IN ('user', 'assistant'));

ALTER TABLE analyst_messages
  ADD CONSTRAINT analyst_messages_content_present CHECK (length(btrim(content)) > 0);

ALTER TABLE analyst_messages
  ADD CONSTRAINT analyst_messages_status_known CHECK (
    status IS NULL OR status IN ('ok', 'unsupported', 'misconfigured', 'error')
  );

ALTER TABLE analyst_messages
  ADD CONSTRAINT analyst_messages_schema_version_positive CHECK (schema_version >= 1);

-- An assistant turn carries its status and attribution; a question does not.
ALTER TABLE analyst_messages
  ADD CONSTRAINT analyst_messages_attribution_by_role CHECK (
    (role = 'user' AND status IS NULL AND attribution IS NULL)
    OR (role = 'assistant' AND status IS NOT NULL AND attribution IS NOT NULL)
  );