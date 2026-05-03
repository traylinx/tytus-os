// ============================================================
// Memo — atomic-note workspace with bidirectional [[wikilink]] resolution
// ============================================================
//
// Replaces the legacy in-tree Notes app (app/src/apps/Notes.tsx) for
// the apps-platform W4 wave. Two-pane layout:
//
//   Left pane:  list of memos (slug + title), click to select, "+
//               New" button to create.
//   Right pane: editor for the selected memo (title input + body
//               textarea), "Mirror to Brain" toggle, "Outliner mode"
//               toggle, backlinks panel.
//
// The component is a pure consumer of the bound HostClient + AppDb
// passed in via props — it does NOT call useHost() or pull globals.
// Saves are blur-driven (titlefield, bodyfield) plus immediate on
// toggles. Each save runs upsertLinks(db, id, body) so the link
// table stays in sync with the rendered surface.
//
// Outliner mode is a render concern only (M7.2 first cut): we split
// body by `\n` and render each line as a bullet, indented by leading
// whitespace (one indent step per 2 spaces or per tab). Tab/Shift+Tab
// adjust the leading whitespace of the cursor's line. The persisted
// body is still a plain string.
//
// Brain mirror toggle persists `mirror_to_brain` per memo. The actual
// Brain.append patch wiring lands in M8 PR-M8.x; the column is reserved
// here so it doesn't churn when that wave ships.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, NotebookPen, Link2, Tag, Sparkles, Trash2 } from 'lucide-react';
import type { AppDb, HostClient } from '@tytus/host-api';
import {
  listMemos,
  getMemo,
  createMemo,
  updateMemo,
  deleteMemo,
  listBacklinks,
  type MemoRow,
} from './repo/memoRepo';
import { slugifyTarget } from './repo/linkResolver';

// `Sparkles` is referenced here to keep the icon set imported even
// when the Brain-mirror UI doesn't render the sparkle (e.g. when
// disabled). erasableSyntaxOnly + noUnusedLocals would otherwise
// trip on a future-tense icon.
void Sparkles;

interface Props {
  db: AppDb;
  host: HostClient;
}

// ---- Slug derivation -------------------------------------------------
// Used for new-memo creation. The user types a title; the slug is
// derived deterministically. Same algorithm as linkResolver.slugifyTarget
// so [[Title]] resolves to the matching memo.
const deriveSlug = (title: string): string => {
  const s = slugifyTarget(title);
  return s.length > 0 ? s : `memo-${Date.now().toString(36)}`;
};

// ---- Outliner-mode helpers (render-only) -----------------------------
//
// Indent unit = 2 spaces OR 1 tab. Both render to one nested level.
// We don't normalise on save; the user's chosen whitespace is preserved
// verbatim in the body string.
const indentDepth = (line: string): number => {
  let depth = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\t') { depth += 1; i += 1; continue; }
    if (line[i] === ' ' && line[i + 1] === ' ') { depth += 1; i += 2; continue; }
    break;
  }
  return depth;
};

interface OutlinerLine {
  depth: number;
  text: string;
}

const parseOutline = (body: string): OutlinerLine[] => {
  return body.split('\n').map((raw) => {
    const depth = indentDepth(raw);
    const text = raw.slice(
      // Strip the leading whitespace we already counted.
      raw.length - raw.trimStart().length,
    );
    return { depth, text };
  });
};

// ---- Component ------------------------------------------------------
export function Memo({ db, host }: Props) {
  const [memos, setMemos] = useState<MemoRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<MemoRow | null>(null);
  const [backlinks, setBacklinks] = useState<MemoRow[]>([]);
  const [outliner, setOutliner] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // ---- load memo list at mount + on refresh ----
  const refreshList = useCallback(async () => {
    const rows = await listMemos(db);
    setMemos(rows);
  }, [db]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // ---- load active memo + its backlinks when selection changes ----
  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setActive(null);
      setBacklinks([]);
      return;
    }
    void (async () => {
      const row = await getMemo(db, selectedId);
      if (cancelled) return;
      setActive(row);
      setDraftTitle(row?.title ?? '');
      setDraftBody(row?.body ?? '');
      const back = row ? await listBacklinks(db, row.id) : [];
      if (!cancelled) setBacklinks(back);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selectedId]);

  // ---- save handlers (blur-driven) ----
  const saveTitle = useCallback(async () => {
    if (!active) return;
    if (draftTitle === active.title) return;
    const newSlug = deriveSlug(draftTitle);
    // Slug change is rare but supported. If the new slug collides we
    // fall back to title-only edit and surface a notification.
    try {
      await updateMemo(db, active.id, {
        title: draftTitle,
        slug: newSlug !== active.slug ? newSlug : undefined,
      });
    } catch {
      // Slug collision — keep the title edit, drop the slug change.
      await updateMemo(db, active.id, { title: draftTitle });
      host.notifications.notify({
        title: 'Slug already in use',
        body: 'Title saved, slug unchanged.',
        level: 'warning',
        unread: false,
      });
    }
    await refreshList();
    const fresh = await getMemo(db, active.id);
    setActive(fresh);
  }, [active, draftTitle, db, host, refreshList]);

  const saveBody = useCallback(async () => {
    if (!active) return;
    if (draftBody === active.body) return;
    await updateMemo(db, active.id, { body: draftBody });
    const fresh = await getMemo(db, active.id);
    setActive(fresh);
    setBacklinks(fresh ? await listBacklinks(db, fresh.id) : []);
  }, [active, draftBody, db]);

  const toggleMirrorToBrain = useCallback(async () => {
    if (!active) return;
    const next = !active.mirrorToBrain;
    await updateMemo(db, active.id, { mirrorToBrain: next });
    setActive({ ...active, mirrorToBrain: next });
  }, [active, db]);

  // ---- new memo ----
  const newMemo = useCallback(async () => {
    const baseTitle = 'Untitled';
    // Derive a unique slug by suffixing if the base is taken.
    let slug = deriveSlug(baseTitle);
    let n = 1;
    while (memos.some((m) => m.slug === slug)) {
      n += 1;
      slug = `${deriveSlug(baseTitle)}-${n}`;
    }
    const title = n === 1 ? baseTitle : `${baseTitle} ${n}`;
    const created = await createMemo(db, { slug, title });
    await refreshList();
    setSelectedId(created.id);
  }, [memos, db, refreshList]);

  const removeActive = useCallback(async () => {
    if (!active) return;
    await deleteMemo(db, active.id);
    setSelectedId(null);
    await refreshList();
  }, [active, db, refreshList]);

  // ---- outliner: keyboard handling ----
  const handleBodyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!outliner) return;
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart, selectionEnd, value } = ta;
      // Find the line bounds containing the cursor.
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      let lineEndIdx = value.indexOf('\n', selectionStart);
      if (lineEndIdx === -1) lineEndIdx = value.length;
      const line = value.slice(lineStart, lineEndIdx);
      let nextLine: string;
      let cursorDelta: number;
      if (e.shiftKey) {
        // Outdent: strip up to one indent step.
        if (line.startsWith('\t')) {
          nextLine = line.slice(1);
          cursorDelta = -1;
        } else if (line.startsWith('  ')) {
          nextLine = line.slice(2);
          cursorDelta = -2;
        } else {
          return;
        }
      } else {
        // Indent: prepend two spaces.
        nextLine = `  ${line}`;
        cursorDelta = 2;
      }
      const nextValue =
        value.slice(0, lineStart) + nextLine + value.slice(lineEndIdx);
      setDraftBody(nextValue);
      // Restore selection after React re-renders the textarea.
      requestAnimationFrame(() => {
        if (!bodyRef.current) return;
        const newPos = Math.max(lineStart, selectionStart + cursorDelta);
        const newEnd = Math.max(lineStart, selectionEnd + cursorDelta);
        bodyRef.current.selectionStart = newPos;
        bodyRef.current.selectionEnd = newEnd;
      });
    },
    [outliner],
  );

  const outline = useMemo(
    () => (outliner ? parseOutline(draftBody) : null),
    [outliner, draftBody],
  );

  // ---- render ----
  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        background: 'var(--tytus-bg, #fafafa)',
        color: 'var(--tytus-fg, #111)',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* Left: memo list */}
      <aside
        style={{
          width: 260,
          borderRight: '1px solid rgba(0,0,0,0.08)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(0,0,0,0.02)',
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <NotebookPen size={16} />
            <strong>Memo</strong>
          </div>
          <button
            type="button"
            onClick={() => void newMemo()}
            title="New memo"
            style={{
              border: '1px solid rgba(0,0,0,0.15)',
              background: 'white',
              borderRadius: 4,
              padding: '2px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
          >
            <Plus size={12} /> New
          </button>
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {memos.length === 0 && (
            <li
              style={{
                padding: '16px 12px',
                color: 'rgba(0,0,0,0.5)',
                fontSize: 13,
              }}
            >
              No memos yet — hit New.
            </li>
          )}
          {memos.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSelectedId(m.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background:
                    selectedId === m.id ? 'rgba(0,0,0,0.07)' : 'transparent',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  display: 'block',
                }}
              >
                <div style={{ fontWeight: 500, fontSize: 13 }}>{m.title}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(0,0,0,0.5)',
                    fontFamily: 'monospace',
                  }}
                >
                  {m.slug}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Right: editor */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {!active && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(0,0,0,0.4)',
              fontSize: 14,
            }}
          >
            Select a memo or create a new one.
          </div>
        )}
        {active && (
          <>
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid rgba(0,0,0,0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={() => void saveTitle()}
                style={{
                  flex: 1,
                  minWidth: 200,
                  fontSize: 16,
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                }}
              />
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                title="Outliner mode (Tab indents, Shift+Tab outdents)"
              >
                <input
                  type="checkbox"
                  checked={outliner}
                  onChange={(e) => setOutliner(e.target.checked)}
                />
                Outliner
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                title="Mirror this memo into Brain on save (engine wiring lands in M8)"
              >
                <input
                  type="checkbox"
                  checked={active.mirrorToBrain}
                  onChange={() => void toggleMirrorToBrain()}
                />
                Mirror to Brain
              </label>
              <button
                type="button"
                onClick={() => void removeActive()}
                title="Delete memo"
                style={{
                  border: '1px solid rgba(180,40,40,0.4)',
                  background: 'white',
                  color: 'rgb(180,40,40)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>

            <div style={{ padding: '6px 16px', fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
              <span style={{ fontFamily: 'monospace' }}>{active.slug}</span>
              {active.tags.length > 0 && (
                <span style={{ marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Tag size={10} /> {active.tags.join(', ')}
                </span>
              )}
            </div>

            {/* Body editor */}
            <div style={{ position: 'relative', flex: 1, display: 'flex', minHeight: 0 }}>
              <textarea
                ref={bodyRef}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                onBlur={() => void saveBody()}
                onKeyDown={handleBodyKeyDown}
                placeholder="Body — use [[Other Memo]] for wikilinks."
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  padding: '12px 16px',
                  fontFamily:
                    outliner
                      ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                      : 'inherit',
                  fontSize: 14,
                  lineHeight: 1.5,
                  resize: 'none',
                  minHeight: 0,
                }}
              />
            </div>

            {/* Outliner preview (read-only render of the same body) */}
            {outliner && outline && (
              <div
                style={{
                  borderTop: '1px dashed rgba(0,0,0,0.1)',
                  padding: '8px 16px',
                  background: 'rgba(0,0,0,0.02)',
                  fontSize: 13,
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>
                  Outline preview
                </div>
                {outline.map((l, i) =>
                  l.text.length === 0 ? (
                    <div key={i} style={{ height: 6 }} />
                  ) : (
                    <div
                      key={i}
                      style={{ paddingLeft: l.depth * 16, lineHeight: 1.4 }}
                    >
                      • {l.text}
                    </div>
                  ),
                )}
              </div>
            )}

            {/* Backlinks panel */}
            <div
              style={{
                borderTop: '1px solid rgba(0,0,0,0.08)',
                padding: '8px 16px',
                background: 'rgba(0,0,0,0.02)',
                maxHeight: 140,
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'rgba(0,0,0,0.6)',
                  marginBottom: 4,
                }}
              >
                <Link2 size={12} /> Backlinks ({backlinks.length})
              </div>
              {backlinks.length === 0 && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
                  No memos link to this one yet.
                </div>
              )}
              {backlinks.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  style={{
                    display: 'block',
                    background: 'transparent',
                    border: 'none',
                    color: 'rgb(40,80,200)',
                    padding: '2px 0',
                    cursor: 'pointer',
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                >
                  {b.title}{' '}
                  <span
                    style={{
                      fontSize: 11,
                      color: 'rgba(0,0,0,0.4)',
                      fontFamily: 'monospace',
                    }}
                  >
                    {b.slug}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default Memo;
