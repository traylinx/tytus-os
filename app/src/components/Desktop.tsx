// ============================================================
// Desktop — Wallpaper + draggable desktop icons + context menu
// ============================================================

import { useCallback, memo, useState, useRef, useEffect } from 'react';
import { useOS, useNotifications } from '@/hooks/useOSStore';
import { useFileSystem, getIconForFileName } from '@/hooks/useFileSystem';
import { usePinnedPods } from '@/hooks/usePinnedPods';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { navigate } from '@/lib/router';
import * as Icons from 'lucide-react';
import { Box, Star } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { BrandIcon, isBrandIconName } from './BrandIcon';
import { useI18n } from '@/i18n';
import { parsePayload, type DnDPayload } from '@/lib/dnd';
import { useSelection, lassoRect, rectsIntersect } from '@/lib/selection';
import { registerShortcut } from '@/lib/shortcuts';
import SelectionLasso from './SelectionLasso';

// Cross-app DnD MIME — must match the one declared in MusicCreator.
// Kept duplicated here (instead of pulled from a shared lib) because the
// Desktop has no other reason to depend on MusicCreator's source file
// and importing it would force the app's whole module graph into the
// always-mounted Desktop component.
//
// Payload is intentionally slim — `hasAudio` is a flag, not the audio
// itself. Audio bytes live in SQLite and are referenced via `id` so the
// dataTransfer stays under a few KB. Older payloads carried the full
// base64 audio data URL (MBs), which made cross-app paste unreliable.
const MIME_TRACK = 'application/x-juli3ta-track';
interface DraggedTrackPayload {
  id: string;
  title: string;
  styleTags?: string;
  lyricsPreview?: string;
  durationMs?: number;
  hasAudio?: boolean;
}

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  if (isBrandIconName(name)) {
    return <BrandIcon name={name} size={(props.size as number) ?? 24} className={props.className} />;
  }
  const IconComp = (Icons as unknown as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  return IconComp ? <IconComp {...props} /> : <Icons.HelpCircle {...props} />;
};

const GRID_X = 80;
const GRID_Y = 90;

// Reserved Pods Zone — manifest §2.5: top-left, 4 cols × 2 rows = 8 slots,
// matches the 8-pin cap from usePinnedPods. Pinned pod icons are absolutely
// positioned independent of the user-icon system; in v1 user icons stay
// where they are and may visually overlap. The "cannot be displaced" rule
// (manifest §2.5) is deferred to v2.
const RESERVED_X = 16;
const RESERVED_Y = 16;
const RESERVED_COLS = 4;

interface PinMenu {
  podId: string;
  x: number;
  y: number;
}

// Sprint Phase 4 — desktop drag state lives in a ref, not React state, so
// we never cause a re-render mid-drag (which would unbind window listeners
// and drop mouseup). Window listeners are attached only during an active
// drag and removed on mouseup OR component unmount.
interface DragState {
  id: string;
  startClient: { x: number; y: number };
  startPosition: { x: number; y: number };
  hasDragged: boolean;
  suppressNextClick: boolean;
}

const ICON_SIZE = 64; // visual footprint used for bounds clamping
const DRAG_THRESHOLD = 5; // px of pointer travel before we consider it a drag

const sanitize = (s: string): string => {
  const trimmed = (s || 'untitled').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
  return trimmed || 'untitled';
};

const Desktop = memo(function Desktop() {
  const { state, dispatch } = useOS();
  const { t } = useI18n();
  const { desktopIcons } = state;
  const fsApi = useFileSystem();
  const { addNotification } = useNotifications();
  const [dropHover, setDropHover] = useState(false);
  // Force re-render only on the icon currently being dragged so the
  // visual style (opacity 0.5) follows. We don't store position in state.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const desktopRef = useRef<HTMLDivElement>(null);

  // Reserved Pods Zone — manifest §2.5
  const pins = usePinnedPods();
  const daemon = useDaemonStateContext();
  const liveAgentPods = new Set(
    (daemon.state?.agents ?? []).map((a) => a.pod_id),
  );
  const [pinMenu, setPinMenu] = useState<PinMenu | null>(null);

  // Close the pin context menu on any outside click. Mirrors ContextMenu's
  // approach so behaviour stays consistent across right-click affordances.
  useEffect(() => {
    if (!pinMenu) return;
    const close = () => setPinMenu(null);
    const t = setTimeout(() => {
      window.addEventListener('click', close, { once: true });
      window.addEventListener('contextmenu', close, { once: true });
    }, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [pinMenu]);

  const openPinnedPod = useCallback(
    (podId: string) => {
      dispatch({ type: 'OPEN_WINDOW', appId: 'pod-inspector' });
      navigate({
        kind: 'pod',
        podId,
        action: 'overview',
        params: new URLSearchParams(),
      });
    },
    [dispatch],
  );

  const handleIconDoubleClick = useCallback(
    (icon: typeof desktopIcons[0]) => {
      // After a successful drag, suppress the open. The flag is set in
      // handleWindowMouseMove and cleared after the next click cycle.
      if (dragRef.current?.suppressNextClick) return;
      if (icon.appId) {
        dispatch({ type: 'OPEN_WINDOW', appId: icon.appId });
        return;
      }
      // File-shaped icons resolve to a VFS node + the right viewer app.
      if (icon.fileSystemNodeId) {
        const node = fsApi.getNodeById(icon.fileSystemNodeId);
        if (!node) return;
        if (node.refTrackId) {
          dispatch({ type: 'OPEN_OR_FOCUS_WINDOW', appId: 'musicplayer', args: { music: { trackId: node.refTrackId } } });
        } else if (node.name.endsWith('.txt') || node.name.endsWith('.md') || (node.mimeType ?? '').startsWith('text/')) {
          dispatch({ type: 'OPEN_OR_FOCUS_WINDOW', appId: 'texteditor', args: { editor: { nodeId: node.id } } });
        }
      }
    },
    [dispatch, fsApi]
  );

  // Window-level handlers — installed on mousedown, removed on mouseup
  // or on unmount. Stable references so add/remove always match.
  const handleWindowMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    const rect = desktopRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;

    const totalDx = e.clientX - drag.startClient.x;
    const totalDy = e.clientY - drag.startClient.y;

    // Threshold compares against ORIGINAL mousedown — not last tick. This
    // is the bug fix: the previous code re-set dragOffset every tick so
    // sub-5px ticks always slipped under the threshold.
    if (!drag.hasDragged && Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD) return;
    drag.hasDragged = true;
    drag.suppressNextClick = true;

    const rawX = drag.startPosition.x + totalDx;
    const rawY = drag.startPosition.y + totalDy;

    const maxX = Math.max(16, rect.width - ICON_SIZE - 16);
    const maxY = Math.max(16, rect.height - ICON_SIZE - 16);

    const snappedX = Math.round((rawX - 16) / GRID_X) * GRID_X + 16;
    const snappedY = Math.round((rawY - 16) / GRID_Y) * GRID_Y + 16;

    dispatch({
      type: 'UPDATE_DESKTOP_ICON_POSITION',
      id: drag.id,
      position: {
        x: Math.min(maxX, Math.max(16, snappedX)),
        y: Math.min(maxY, Math.max(16, snappedY)),
      },
    });
  }, [dispatch]);

  const handleWindowMouseUp = useCallback(() => {
    window.removeEventListener('mousemove', handleWindowMouseMove);
    setDraggingId(null);
    // Do NOT clear dragRef.current yet — handleIconDoubleClick and the
    // parent desktop onClick read suppressNextClick on the same event
    // cycle. We clear it on the next mousedown.
  }, [handleWindowMouseMove]);

  // Phase 3.0 — multi-select via useSelection. Reducer's
  // SELECT_DESKTOP_ICON keeps tracking the "anchor" icon for back-compat
  // with components that still read `icon.isSelected`; the new Set-
  // backed selection drives the multi-item drag/clipboard/trash code.
  const selection = useSelection({ keyOf: (i: typeof desktopIcons[0]) => i.id });

  // Esc clears selection. Registered via the central shortcut router
  // so modal stack precedence works out.
  useEffect(() => {
    return registerShortcut('active-app', 'Esc', () => {
      if (selection.size > 0) selection.clear();
      else return false; // let other handlers see Esc
    });
  }, [selection]);

  // Phase 3.0a — lasso. Tracks mousedown coords on empty area;
  // moves > LASSO_THRESHOLD pixels promote to lasso mode and we
  // continuously hit-test icon rects against the rectangle.
  const LASSO_THRESHOLD = 4;
  const [lasso, setLasso] = useState<{
    active: boolean;
    start: { x: number; y: number };
    cursor: { x: number; y: number };
  } | null>(null);
  const lassoStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleDesktopMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Bail if the mousedown originated on an icon — handled separately.
      const target = e.target as Element;
      if (target.closest('[data-desktop-icon]')) return;
      const containerRect = desktopRef.current?.getBoundingClientRect();
      const ox = containerRect ? e.clientX - containerRect.x : e.clientX;
      const oy = containerRect ? e.clientY - containerRect.y : e.clientY;
      lassoStartRef.current = { x: ox, y: oy };

      const onMove = (mv: MouseEvent) => {
        const start = lassoStartRef.current;
        if (!start) return;
        const cx = containerRect ? mv.clientX - containerRect.x : mv.clientX;
        const cy = containerRect ? mv.clientY - containerRect.y : mv.clientY;
        if (
          Math.abs(cx - start.x) > LASSO_THRESHOLD ||
          Math.abs(cy - start.y) > LASSO_THRESHOLD
        ) {
          const r = lassoRect(start, { x: cx, y: cy });
          // Hit-test all icons in real time.
          const hits = desktopIcons
            .filter((icon) =>
              rectsIntersect(
                {
                  x: icon.position.x,
                  y: icon.position.y,
                  w: 64,
                  h: 80,
                },
                r,
              ),
            );
          selection.replace(hits);
          setLasso({ active: true, start, cursor: { x: cx, y: cy } });
        }
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        lassoStartRef.current = null;
        setLasso(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [desktopIcons, selection],
  );

  const handleIconMouseDown = useCallback(
    (e: React.MouseEvent, icon: typeof desktopIcons[0]) => {
      // Only start drag on primary button — right-click belongs to the
      // context menu, middle-click is a no-op.
      if (e.button !== 0) return;
      e.stopPropagation();

      // Multi-select modifier handling (Phase 3.0).
      if (e.metaKey || e.ctrlKey) {
        selection.toggle(icon);
      } else if (e.shiftKey) {
        selection.rangeFrom(icon, desktopIcons);
      } else if (!selection.isSelected(icon)) {
        selection.selectOne(icon);
      }
      dispatch({ type: 'SELECT_DESKTOP_ICON', id: icon.id });

      // Reset suppress flag from prior drag now that we're starting fresh.
      dragRef.current = {
        id: icon.id,
        startClient: { x: e.clientX, y: e.clientY },
        startPosition: icon.position,
        hasDragged: false,
        suppressNextClick: false,
      };
      setDraggingId(icon.id);
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp, { once: true });
    },
    [desktopIcons, dispatch, handleWindowMouseMove, handleWindowMouseUp, selection]
  );

  // Unmount cleanup — if the desktop unmounts mid-drag (HMR, route
  // change, lost mouseup) drop the window listeners so they don't leak.
  useEffect(() => () => {
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
    dragRef.current = null;
  }, [handleWindowMouseMove, handleWindowMouseUp]);

  // ── Drop handlers ─────────────────────────────────────────
  // The desktop accepts tracks (from Music Creator), plain text (from
  // Text Editor or the OS clipboard), and OS-level files. Each drop
  // creates a real VFS file in ~/Desktop AND a desktop icon pointing at
  // it, so the user can re-open / drag onwards just like macOS.
  const findDesktopFolderId = useCallback((): string => fsApi.ensureUserFolder('Desktop'), [fsApi]);

  const findFreeSlot = useCallback(() => {
    // Snap to the next free grid slot below the reserved pods zone (4×2)
    // — start at column 0 row 2 and walk left-to-right, top-to-bottom.
    const used = new Set(state.desktopIcons.map((i) => `${i.position.x},${i.position.y}`));
    let placed = false;
    let x = 16, y = 16 + 2 * GRID_Y;
    for (let row = 2; row < 8 && !placed; row++) {
      for (let col = 0; col < 8 && !placed; col++) {
        const px = 16 + col * GRID_X;
        const py = 16 + row * GRID_Y;
        if (!used.has(`${px},${py}`)) { x = px; y = py; placed = true; }
      }
    }
    return { x, y };
  }, [state.desktopIcons]);

  const placeIcon = useCallback((nodeId: string, name: string, iconName: string) => {
    const pos = findFreeSlot();
    dispatch({
      type: 'ADD_DESKTOP_ICON',
      icon: {
        name,
        icon: iconName,
        fileSystemNodeId: nodeId,
        position: pos,
        isSelected: false,
      },
    });
  }, [dispatch, findFreeSlot]);

  /** Phase 3.1 — drop a daemon-backed file on the Desktop. Creates a
   * shortcut icon whose `daemonShortcut` field points at the daemon
   * file. No bytes are copied into the vfs. */
  const placeDaemonShortcut = useCallback(
    (ref: {
      source: string;
      path: string;
      binding?: number;
      pod?: string;
      readonly?: boolean;
    }, name: string, iconName: string) => {
      const pos = findFreeSlot();
      dispatch({
        type: 'ADD_DESKTOP_ICON',
        icon: {
          name,
          icon: iconName,
          daemonShortcut: ref,
          position: pos,
          isSelected: false,
        },
      });
    },
    [dispatch, findFreeSlot],
  );

  // Phase 2 — DnD migrated to typed payloads via lib/dnd. Drop matrix
  // for the desktop accepts file/track/text/external-files/desktop-icon;
  // dragover only previews when the kind is acceptable.
  const handleDesktopDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    const acceptable =
      types.includes(MIME_TRACK) ||
      types.includes('text/plain') ||
      types.includes('Files') ||
      types.includes('application/x-tytus-file-ref');
    if (acceptable) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!dropHover) setDropHover(true);
    }
  }, [dropHover]);

  const handleDesktopDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDropHover(false);
  }, []);

  const handleDesktopDrop = useCallback(async (e: React.DragEvent) => {
    setDropHover(false);

    // Native files take precedence over MIME data — exactly one
    // payload kind is meaningful per drop.
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const desktopId = findDesktopFolderId();
      if (!desktopId) return;
      for (const file of Array.from(e.dataTransfer.files)) {
        const isText = file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md');
        if (!isText) continue;
        const content = await file.text();
        const nodeId = fsApi.createFile(desktopId, file.name, content, { mimeType: file.type || 'text/plain' });
        placeIcon(nodeId, file.name, getIconForFileName(file.name));
      }
      return;
    }

    const payload: DnDPayload | null = parsePayload(e.dataTransfer);
    if (!payload) return;
    e.preventDefault();

    if (payload.kind === 'track') {
      const baseName = sanitize(payload.title.replace(/\s*\((lyrics|cover)\)\s*$/, ''));
      const desktopId = findDesktopFolderId();
      if (!desktopId) return;
      const isAudio = Boolean(payload.hasAudio);
      const fileName = isAudio ? `${baseName}.mp3` : `${baseName}.lyrics.txt`;
      const existing = fsApi.findChildByName(desktopId, fileName);
      const nodeId = existing
        ? existing.id
        : (isAudio
            ? fsApi.createFile(desktopId, fileName, '', { mimeType: 'audio/mpeg', refTrackId: payload.trackId })
            : fsApi.createFile(desktopId, fileName, payload.lyricsPreview ?? '', { mimeType: 'text/plain' }));
      if (!existing) placeIcon(nodeId, fileName, getIconForFileName(fileName));
      addNotification({
        appId: 'desktop',
        appName: 'Desktop',
        appIcon: isAudio ? 'Music' : 'FileText',
        title: t('desktop.notify.dropTitle'),
        message: t('desktop.notify.dropBody', { name: fileName }),
        isRead: false,
      });
      return;
    }

    if (payload.kind === 'text' && payload.text.trim()) {
      const desktopId = findDesktopFolderId();
      if (!desktopId) return;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const fileName = `note-${stamp}-${Math.random().toString(36).slice(2, 5)}.txt`;
      const nodeId = fsApi.createFile(desktopId, fileName, payload.text, { mimeType: 'text/plain' });
      placeIcon(nodeId, fileName, getIconForFileName(fileName));
      addNotification({
        appId: 'desktop',
        appName: 'Desktop',
        appIcon: 'FileText',
        title: t('desktop.notify.dropTitle'),
        message: t('desktop.notify.dropBody', { name: fileName }),
        isRead: false,
      });
      return;
    }

    // Phase 3.1 — Files → Desktop creates daemon shortcut icon(s).
    // No bytes copied. Multiple refs in a single drop fan out to N
    // icons placed in the next free grid slots.
    if (payload.kind === 'file' && payload.refs.length > 0) {
      let placed = 0;
      for (const ref of payload.refs) {
        if (ref.source === 'daemon') {
          const fileName = ref.path.split('/').filter(Boolean).pop() || ref.path;
          placeDaemonShortcut(
            {
              source: ref.daemonSource,
              path: ref.path,
              binding: ref.binding,
              pod: ref.pod,
              readonly: ref.readonly,
            },
            fileName,
            getIconForFileName(fileName),
          );
          placed++;
        }
        // vfs source on Desktop drop: nothing to do — already on the
        // Desktop, or being moved between desktops we don't support.
      }
      if (placed > 0) {
        addNotification({
          appId: 'desktop',
          appName: 'Desktop',
          appIcon: 'FileText',
          title: t('desktop.notify.dropTitle'),
          message: t('desktop.notify.dropBody', {
            name: placed === 1 ? payload.refs[0].source === 'daemon' ? (payload.refs[0].path.split('/').pop() || '') : '' : `${placed} items`,
          }),
          isRead: false,
        });
      }
      return;
    }

    // desktop-icon kind on Desktop is a no-op (icons can't drop on
    // themselves). It surfaces in Phase 4 as the Trash drop.
  }, [findDesktopFolderId, fsApi, placeIcon, placeDaemonShortcut, addNotification, t]);

  const handleDesktopContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dispatch({
        type: 'SHOW_CONTEXT_MENU',
        x: e.clientX,
        y: e.clientY,
        menuType: 'desktop',
        items: [
          { id: 'new-folder', label: 'New Folder', icon: 'FolderPlus', action: 'NEW_FOLDER' },
          { id: 'new-doc', label: 'New Document', icon: 'FilePlus', action: 'NEW_DOCUMENT' },
          { id: 'div1', label: '', action: '', divider: true },
          { id: 'open-term', label: 'Open in Terminal', icon: 'Terminal', action: 'OPEN_APP:terminal' },
          { id: 'div2', label: '', action: '', divider: true },
          { id: 'change-bg', label: 'Change Background', icon: 'Image', action: 'CHANGE_BG' },
          { id: 'arrange', label: 'Arrange Icons', icon: 'LayoutGrid', action: 'ARRANGE_ICONS' },
          { id: 'div3', label: '', action: '', divider: true },
          { id: 'display-settings', label: 'Display Settings', icon: 'Monitor', action: 'SHOW_SETTINGS' },
        ],
      });
    },
    [dispatch]
  );

  return (
    <div
      ref={desktopRef}
      className="fixed inset-0 z-10"
      style={{
        top: 28,
        bottom: 68, // matches dock lift+height (6 + 56 + 6 buffer)
        outline: dropHover ? '2px dashed rgba(124,77,255,0.55)' : 'none',
        outlineOffset: -8,
        transition: 'outline-color 120ms ease',
      }}
      onContextMenu={handleDesktopContextMenu}
      onDragOver={handleDesktopDragOver}
      onDragLeave={handleDesktopDragLeave}
      onDrop={handleDesktopDrop}
      onMouseDown={handleDesktopMouseDown}
      onClick={() => {
        // After a drag ends, ignore the click so the user's selection
        // isn't cleared the moment they release the mouse.
        if (dragRef.current?.suppressNextClick) {
          dragRef.current = null;
          return;
        }
        // Empty-area click clears multi-selection.
        selection.clear();
        dispatch({ type: 'SELECT_DESKTOP_ICON', id: null });
      }}
    >
      {/* Lasso overlay (Phase 3.0a) */}
      {lasso && (
        <SelectionLasso
          active={lasso.active}
          start={lasso.start}
          cursor={lasso.cursor}
        />
      )}

      {/* Desktop Icons */}
      {desktopIcons.map((icon) => (
        <div
          key={icon.id}
          data-desktop-icon
          className="absolute flex flex-col items-center gap-1 cursor-pointer group"
          style={{
            left: icon.position.x,
            top: icon.position.y,
            width: 64,
            opacity: draggingId === icon.id ? 0.5 : 1,
            animation: 'iconAppear 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
          onDoubleClick={() => handleIconDoubleClick(icon)}
          onMouseDown={(e) => handleIconMouseDown(e, icon)}
          onContextMenu={(e) => {
            e.stopPropagation();
            dispatch({
              type: 'SHOW_CONTEXT_MENU',
              x: e.clientX,
              y: e.clientY,
              menuType: 'file',
              items: [
                { id: 'open', label: t('context.open'), icon: 'ExternalLink', action: `OPEN_APP:${icon.appId}` },
                { id: 'div1', label: '', action: '', divider: true },
                { id: 'cut', label: t('context.cut'), icon: 'Scissors', action: 'CUT' },
                { id: 'copy', label: t('context.copy'), icon: 'Copy', action: 'COPY' },
                { id: 'rename', label: t('context.rename'), icon: 'Edit', action: 'RENAME' },
                { id: 'div2', label: '', action: '', divider: true },
                { id: 'trash', label: t('context.moveToTrash'), icon: 'Trash2', action: 'TRASH' },
              ],
              contextData: { iconId: icon.id },
            });
          }}
        >
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center transition-all"
            style={{
              background: (icon.isSelected || selection.isSelected(icon)) ? 'rgba(124,77,255,0.20)' : 'transparent',
              border: (icon.isSelected || selection.isSelected(icon)) ? '1px dashed rgba(124,77,255,0.50)' : '1px solid transparent',
            }}
          >
            <DynamicIcon
              name={icon.icon}
              size={32}
              className="text-[var(--text-primary)] drop-shadow-lg"
              style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.8))' }}
            />
          </div>
          <span
            className="text-[10px] font-medium text-center px-1 py-0.5 rounded-sm max-w-[72px] truncate leading-tight"
            style={{
              color: '#E0E0E0',
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              background: (icon.isSelected || selection.isSelected(icon)) ? 'rgba(124,77,255,0.30)' : 'transparent',
            }}
          >
            {icon.appId ? t(`app.${icon.appId}.name`) : icon.name}
          </span>
        </div>
      ))}

      {/* Reserved Pods Zone (manifest §2.5) — pinned pods rendered as
          absolutely-positioned overlay icons in a 4x2 grid at top-left.
          Empty when no pins, so we don't reserve visual space. Stale pins
          (pod no longer in daemon state) render at 50% opacity with a
          yellow status dot — user can right-click to Unpin. */}
      {pins.pinned.map((podId, i) => {
        const col = i % RESERVED_COLS;
        const row = Math.floor(i / RESERVED_COLS);
        const left = RESERVED_X + col * GRID_X;
        const top = RESERVED_Y + row * GRID_Y;
        const isLive = liveAgentPods.has(podId);
        const dotColor = isLive ? '#9CA3AF' /* grey: present */ : '#FACC15' /* yellow: stale */;
        return (
          <div
            key={`pin-${podId}`}
            className="absolute flex flex-col items-center gap-1 cursor-pointer group"
            data-testid={`desktop-pin-${podId}`}
            style={{
              left,
              top,
              width: 64,
              opacity: isLive ? 1 : 0.5,
              animation: 'iconAppear 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
            onClick={(e) => {
              e.stopPropagation();
              openPinnedPod(podId);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPinMenu({ podId, x: e.clientX, y: e.clientY });
            }}
          >
            <div
              className="relative w-12 h-12 rounded-lg flex items-center justify-center transition-all"
              style={{
                background: 'rgba(124,77,255,0.10)',
                border: '1px solid rgba(124,77,255,0.30)',
              }}
            >
              <Box
                size={32}
                className="drop-shadow-lg"
                style={{
                  color: 'var(--accent, #7C4DFF)',
                  filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.8))',
                }}
              />
              {/* Star overlay — pinned indicator */}
              <Star
                size={12}
                className="absolute -top-1 -right-1"
                style={{
                  color: '#FACC15',
                  fill: '#FACC15',
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
                }}
              />
              {/* Status dot — bottom-right corner */}
              <span
                className="absolute -bottom-0.5 -right-0.5 rounded-full"
                style={{
                  width: 10,
                  height: 10,
                  background: dotColor,
                  border: '2px solid rgba(0,0,0,0.6)',
                }}
              />
            </div>
            <span
              className="text-[10px] font-medium text-center px-1 py-0.5 rounded-sm max-w-[72px] truncate leading-tight"
              style={{
                color: '#E0E0E0',
                textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              }}
            >
              {t('desktop.podLabel', { podId })}
            </span>
          </div>
        );
      })}

      {/* Pin right-click menu (local — global ContextMenu doesn't accept
          custom callbacks). Single "Unpin" item. */}
      {pinMenu && (
        <div
          className="fixed z-[4000] py-1.5 select-none"
          data-testid="desktop-pin-menu"
          style={{
            left: pinMenu.x,
            top: pinMenu.y,
            minWidth: 140,
            background: 'var(--bg-context-menu)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
            boxShadow: 'var(--shadow-lg)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2.5 px-3 h-8 text-sm transition-colors"
            style={{
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              margin: '0 4px',
              width: 'calc(100% - 8px)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            onClick={() => {
              pins.unpin(pinMenu.podId);
              setPinMenu(null);
            }}
          >
            <Icons.StarOff size={16} className="shrink-0" />
            <span className="flex-1 text-left">{t('desktop.unpin')}</span>
          </button>
        </div>
      )}

      <style>{`
        @keyframes iconAppear {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
});

export default Desktop;
