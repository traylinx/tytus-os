-- Studio — long-form composition surface. Documents are the user-facing
-- unit; blocks are the typed leaves the multi-block UI renders + the
-- engine patches against (see ai-engine/src/edits/algebra.ts for the
-- patch shape M6.x will speak against this table).
--
-- Block kinds shipped in M6.2: heading-{1,2,3} | paragraph | bullet |
-- code | image | embed | separator. Per-kind metadata rides along in
-- meta_json (e.g. { "language": "ts" } for code, { "src": "...",
-- "alt": "...", "caption": "..." } for image, { "kind": "sheet",
-- "targetId": "..." } for embed). The repo (documentRepo.ts)
-- (de)serialises meta ↔ meta_json at the boundary so callers see
-- typed objects.
--
-- `position` is an integer sort key — leave gaps (e.g. 1024-step) so
-- drag-reorder can insert between siblings without rewriting the whole
-- list. `moveBlocks` re-numbers compacted positions when the gaps run
-- out.

CREATE TABLE IF NOT EXISTS app_studio_documents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'Untitled',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_studio_blocks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  meta_json   TEXT NOT NULL DEFAULT '{}',
  position    INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES app_studio_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_studio_blocks_document_position
  ON app_studio_blocks(document_id, position);

CREATE INDEX IF NOT EXISTS idx_app_studio_documents_updated
  ON app_studio_documents(updated_at DESC);
