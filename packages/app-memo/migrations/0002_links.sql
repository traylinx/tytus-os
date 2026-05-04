-- Memo — bidirectional [[wikilink]] index. Each row = one outbound
-- link from a source memo to a target name. The target may not exist
-- as a memo yet (forward-reference); resolveLinks() fills it in once
-- a memo with the same slug is created.
--
-- The (source_id, position) pair uniquely identifies the link site
-- so re-parsing on save can upsert in place rather than wiping +
-- re-inserting.

CREATE TABLE IF NOT EXISTS app_memo_links (
  source_id    TEXT NOT NULL,            -- memo.id of the document holding the link
  position     INTEGER NOT NULL,         -- character offset of the [[ in the source body
  target_name  TEXT NOT NULL,            -- raw [[name]] as written
  target_id    TEXT,                     -- resolved memo.id (NULL = forward-ref)
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (source_id, position)
);

CREATE INDEX IF NOT EXISTS idx_app_memo_links_target_name
  ON app_memo_links(target_name);

CREATE INDEX IF NOT EXISTS idx_app_memo_links_target_id
  ON app_memo_links(target_id) WHERE target_id IS NOT NULL;
