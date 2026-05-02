// ============================================================
// Typed drag-and-drop payloads
// ============================================================
//
// Tytus OS uses native HTML5 DnD (no react-dnd / @dnd-kit). This
// module is the single place where payloads are encoded for the
// browser's `DataTransfer` and decoded back out — every drag source
// uses `serializePayload`, every drop target uses `parsePayload`,
// and a small `canAccept` matrix gates "this kind cannot land here".
//
// Why typed: a string MIME free-for-all is what we had before
// Phase 2. Two consumers had to agree on the MIME *and* on the
// shape of the JSON, with no compiler help. Cross-backend file ops
// (Phase 3) need to know whether the dragged item is a vfs node or
// a daemon path before they pick a code path — that branch lives
// here, exactly once.

import {
  FILE_REF_MIME,
  parseRefs,
  serializeRefs,
  type FileRef,
} from "./files/fileRef";

// ── Payload shapes ────────────────────────────────────────

export interface FilePayload {
  kind: "file";
  refs: FileRef[];
}
export interface DesktopIconPayload {
  kind: "desktop-icon";
  /** Desktop icon ids (NOT vfs node ids — desktop icons may point at
   *  vfs OR daemon files; the Desktop reads the icon record itself). */
  iconIds: string[];
}
export interface AppPayload {
  kind: "app";
  appId: string;
}
export interface AppWindowPayload {
  kind: "app-window";
  windowId: string;
}
export interface TrackPayload {
  kind: "track";
  /** Music Creator track id (audio bytes live in SQLite). */
  trackId: string;
  title: string;
  styleTags?: string;
  lyricsPreview?: string;
  durationMs?: number;
  hasAudio?: boolean;
}
export interface TextPayload {
  kind: "text";
  text: string;
}
/** Native host-file drop. The DataTransfer carries `File` objects on
 *  `e.dataTransfer.files`; this payload is just the marker so the drop
 *  matrix can recognise it. The actual files are read at drop time. */
export interface ExternalFilesPayload {
  kind: "external-files";
}

export type DnDPayload =
  | FilePayload
  | DesktopIconPayload
  | AppPayload
  | AppWindowPayload
  | TrackPayload
  | TextPayload
  | ExternalFilesPayload;

export type DnDKind = DnDPayload["kind"];

export const DND_KINDS: readonly DnDKind[] = [
  "file",
  "desktop-icon",
  "app",
  "app-window",
  "track",
  "text",
  "external-files",
];

// ── MIME types ────────────────────────────────────────────

export const DND_MIMES = {
  desktopIcon: "application/x-tytus-desktop-icon",
  app: "application/x-tytus-app",
  appWindow: "application/x-tytus-app-window",
  /** Cross-app — kept stable for compatibility with MusicCreator pre-Phase-2. */
  track: "application/x-juli3ta-track",
  /** Standard text/plain for plain-text drags. */
  text: "text/plain",
  /** Native file uploads from the host OS. */
  externalFiles: "Files",
  fileRef: FILE_REF_MIME,
} as const;

// ── Drop matrix ───────────────────────────────────────────
//
// `canAccept(target)(source)` returns true iff a drag of kind
// `source` is allowed to drop on a target that accepts the kinds
// listed below. Targets are conceptual labels — components map them
// to their own DOM element.

export type DropTargetKind =
  | "desktop"
  | "fileManagerPane"
  | "dock"
  | "dockAppIcon"
  | "trash"
  | "appWindow"
  | "external"; // dragend out of the OS, never a drop target

const DROP_MATRIX: Record<DropTargetKind, ReadonlySet<DnDKind>> = {
  desktop: new Set([
    "file",
    "track",
    "text",
    "external-files",
    "desktop-icon",
  ]),
  fileManagerPane: new Set([
    "file",
    "external-files",
    "desktop-icon",
    "track",
  ]),
  dock: new Set(["app"]),
  dockAppIcon: new Set([
    "file",
    "external-files",
    "track",
  ]),
  trash: new Set([
    "file",
    "desktop-icon",
  ]),
  appWindow: new Set([
    "file",
    "external-files",
    "track",
  ]),
  external: new Set([]),
};

export function canAccept(target: DropTargetKind, source: DnDKind): boolean {
  return DROP_MATRIX[target].has(source);
}

// ── Serialize ─────────────────────────────────────────────

/**
 * Stuff a payload onto a DataTransfer. Handles the main MIME write
 * + a `text/plain` fallback so dragging out of the OS into another
 * app gives the user *something* useful (the text body, the file
 * name, etc.). Caller handles `setDragImage` if a custom ghost is
 * desired (Phase 2.3 DragGhost component renders separately).
 */
export function serializePayload(
  dt: DataTransfer,
  payload: DnDPayload,
): void {
  switch (payload.kind) {
    case "file":
      dt.setData(DND_MIMES.fileRef, serializeRefs(payload.refs));
      // text/plain fallback: comma-separated names so a drop into a
      // text editor doesn't get stringified JSON.
      dt.setData(
        DND_MIMES.text,
        payload.refs.map(humanReadableRefName).join(", "),
      );
      break;
    case "desktop-icon":
      dt.setData(DND_MIMES.desktopIcon, JSON.stringify(payload.iconIds));
      dt.setData(DND_MIMES.text, payload.iconIds.join(", "));
      break;
    case "app":
      dt.setData(DND_MIMES.app, payload.appId);
      dt.setData(DND_MIMES.text, payload.appId);
      break;
    case "app-window":
      dt.setData(DND_MIMES.appWindow, payload.windowId);
      break;
    case "track":
      dt.setData(
        DND_MIMES.track,
        JSON.stringify({
          id: payload.trackId,
          title: payload.title,
          styleTags: payload.styleTags,
          lyricsPreview: payload.lyricsPreview,
          durationMs: payload.durationMs,
          hasAudio: payload.hasAudio,
        }),
      );
      dt.setData(DND_MIMES.text, payload.title);
      break;
    case "text":
      dt.setData(DND_MIMES.text, payload.text);
      break;
    case "external-files":
      // Host files come via dt.files; we don't manufacture those.
      break;
  }
}

// ── Parse ─────────────────────────────────────────────────

/**
 * Parse the *highest-priority* payload off a DataTransfer. Native
 * file drops win over file refs (they're a different intent), file
 * refs win over desktop icons / track / text. Returns null if no
 * known kind is present.
 */
export function parsePayload(dt: DataTransfer): DnDPayload | null {
  const types = Array.from(dt.types || []);
  const has = (m: string) =>
    types.includes(m) || types.includes(m.toLowerCase());

  // Host file drop (highest precedence — dt.files is opaque to other types).
  if (dt.files && dt.files.length > 0) {
    return { kind: "external-files" };
  }
  // FileRef[] — used for both Desktop and FileManager file drags.
  if (has(DND_MIMES.fileRef)) {
    const refs = parseRefs(dt.getData(DND_MIMES.fileRef));
    if (refs && refs.length > 0) return { kind: "file", refs };
  }
  if (has(DND_MIMES.desktopIcon)) {
    try {
      const ids = JSON.parse(dt.getData(DND_MIMES.desktopIcon));
      if (
        Array.isArray(ids) &&
        ids.every((id) => typeof id === "string")
      ) {
        return { kind: "desktop-icon", iconIds: ids };
      }
    } catch {}
  }
  if (has(DND_MIMES.appWindow)) {
    const id = dt.getData(DND_MIMES.appWindow);
    if (id) return { kind: "app-window", windowId: id };
  }
  if (has(DND_MIMES.app)) {
    const id = dt.getData(DND_MIMES.app);
    if (id) return { kind: "app", appId: id };
  }
  if (has(DND_MIMES.track)) {
    try {
      const t = JSON.parse(dt.getData(DND_MIMES.track));
      if (t && typeof t === "object" && typeof t.id === "string") {
        return {
          kind: "track",
          trackId: t.id,
          title: typeof t.title === "string" ? t.title : t.id,
          styleTags: typeof t.styleTags === "string" ? t.styleTags : undefined,
          lyricsPreview:
            typeof t.lyricsPreview === "string" ? t.lyricsPreview : undefined,
          durationMs:
            typeof t.durationMs === "number" ? t.durationMs : undefined,
          hasAudio: typeof t.hasAudio === "boolean" ? t.hasAudio : undefined,
        };
      }
    } catch {}
  }
  if (has(DND_MIMES.text)) {
    const text = dt.getData(DND_MIMES.text);
    if (text) return { kind: "text", text };
  }
  return null;
}

/**
 * Quick discriminator without paying full parse cost — useful in
 * `dragover` handlers where we only need to decide whether to
 * `preventDefault()` to allow the drop.
 */
export function detectKind(dt: DataTransfer): DnDKind | null {
  if (dt.files && dt.files.length > 0) return "external-files";
  const types = Array.from(dt.types || []);
  if (types.includes(DND_MIMES.fileRef)) return "file";
  if (types.includes(DND_MIMES.desktopIcon)) return "desktop-icon";
  if (types.includes(DND_MIMES.appWindow)) return "app-window";
  if (types.includes(DND_MIMES.app)) return "app";
  if (types.includes(DND_MIMES.track)) return "track";
  if (types.includes(DND_MIMES.text)) return "text";
  return null;
}

// ── Helpers ───────────────────────────────────────────────

function humanReadableRefName(ref: FileRef): string {
  if (ref.source === "vfs") return `vfs:${ref.nodeId}`;
  const segments = ref.path.split("/").filter(Boolean);
  return segments[segments.length - 1] || ref.path || "file";
}
