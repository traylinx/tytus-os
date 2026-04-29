// ============================================================
// Desktop — Wallpaper + draggable desktop icons + context menu
// ============================================================

import { useCallback, memo, useState, useRef, useEffect } from 'react';
import { useOS } from '@/hooks/useOSStore';
import { usePinnedPods } from '@/hooks/usePinnedPods';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { navigate } from '@/lib/router';
import * as Icons from 'lucide-react';
import { Box, Star } from 'lucide-react';
import type { LucideProps } from 'lucide-react';

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
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

const Desktop = memo(function Desktop() {
  const { state, dispatch } = useOS();
  const { desktopIcons, theme } = state;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
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
      if (icon.appId) {
        dispatch({ type: 'OPEN_WINDOW', appId: icon.appId });
      }
    },
    [dispatch]
  );

  const handleIconMouseDown = useCallback(
    (e: React.MouseEvent, icon: typeof desktopIcons[0]) => {
      e.stopPropagation();
      dispatch({ type: 'SELECT_DESKTOP_ICON', id: icon.id });
      if (icon.appId) {
        setDraggingId(icon.id);
        setDragOffset({ x: e.clientX, y: e.clientY });
      }
    },
    [dispatch]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingId) return;
      const dx = e.clientX - dragOffset.x;
      const dy = e.clientY - dragOffset.y;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;

      const icon = desktopIcons.find((i) => i.id === draggingId);
      if (!icon) return;

      const nx = Math.round((icon.position.x + dx) / GRID_X) * GRID_X + 16;
      const ny = Math.round((icon.position.y + dy) / GRID_Y) * GRID_Y + 16;

      dispatch({
        type: 'UPDATE_DESKTOP_ICON_POSITION',
        id: draggingId,
        position: { x: Math.max(16, nx), y: Math.max(16, ny) },
      });
      setDragOffset({ x: e.clientX, y: e.clientY });
    },
    [draggingId, dragOffset, desktopIcons, dispatch]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingId(null);
  }, []);

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
        backgroundImage: `url(${theme.wallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        top: 28,
        bottom: 68,  // matches dock lift+height (6 + 56 + 6 buffer)
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleDesktopContextMenu}
      onClick={() => dispatch({ type: 'SELECT_DESKTOP_ICON', id: null })}
    >
      {/* Desktop Icons */}
      {desktopIcons.map((icon) => (
        <div
          key={icon.id}
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
                { id: 'open', label: 'Open', icon: 'ExternalLink', action: `OPEN_APP:${icon.appId}` },
                { id: 'div1', label: '', action: '', divider: true },
                { id: 'cut', label: 'Cut', icon: 'Scissors', action: 'CUT' },
                { id: 'copy', label: 'Copy', icon: 'Copy', action: 'COPY' },
                { id: 'rename', label: 'Rename', icon: 'Edit', action: 'RENAME' },
                { id: 'div2', label: '', action: '', divider: true },
                { id: 'trash', label: 'Move to Trash', icon: 'Trash2', action: 'TRASH' },
              ],
              contextData: { iconId: icon.id },
            });
          }}
        >
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center transition-all"
            style={{
              background: icon.isSelected ? 'rgba(124,77,255,0.20)' : 'transparent',
              border: icon.isSelected ? '1px dashed rgba(124,77,255,0.50)' : '1px solid transparent',
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
              background: icon.isSelected ? 'rgba(124,77,255,0.30)' : 'transparent',
            }}
          >
            {icon.name}
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
              {`Pod ${podId}`}
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
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            boxShadow: 'var(--shadow-lg)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2.5 px-3 h-8 text-sm transition-colors"
            style={{
              color: 'var(--text-primary)',
              borderRadius: 4,
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
            <span className="flex-1 text-left">Unpin</span>
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
