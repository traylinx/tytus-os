// ============================================================
// ContextMenu — Dynamic right-click menu with edge detection
// ============================================================

import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useOS } from '@/hooks/useOSStore';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { registerShortcut } from '@/lib/shortcuts';

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  return IconComp ? <IconComp {...props} /> : null;
};

const ContextMenu = memo(function ContextMenu() {
  const { state, dispatch } = useOS();
  const menuRef = useRef<HTMLDivElement>(null);
  const { contextMenu } = state;

  // Phase 4.5e — keyboard navigation. activeIndex walks the
  // selectable items (skipping dividers + disabled). Esc closes
  // and restores focus to whichever element opened the menu.
  const focusableIndices = useMemo(
    () =>
      contextMenu.items
        .map((it, i) => (it.divider || it.disabled ? -1 : i))
        .filter((i) => i >= 0),
    [contextMenu.items],
  );
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const invokerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!contextMenu.visible) {
      if (invokerRef.current) {
        invokerRef.current.focus?.();
        invokerRef.current = null;
      }
      setActiveIndex(-1);
      return;
    }
    invokerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setActiveIndex(focusableIndices[0] ?? -1);
  }, [contextMenu.visible, focusableIndices]);

  useEffect(() => {
    if (!contextMenu.visible) return;
    const handleClick = () => dispatch({ type: 'HIDE_CONTEXT_MENU' });
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick, { once: true });
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClick);
    };
  }, [contextMenu.visible, dispatch]);

  useEffect(() => {
    if (!contextMenu.visible) return;
    const offEsc = registerShortcut('modal', 'Esc', () => {
      dispatch({ type: 'HIDE_CONTEXT_MENU' });
    });
    const offDown = registerShortcut('modal', 'Down', () => {
      setActiveIndex((cur) => {
        const i = focusableIndices.indexOf(cur);
        return focusableIndices[(i + 1) % focusableIndices.length] ?? cur;
      });
    });
    const offUp = registerShortcut('modal', 'Up', () => {
      setActiveIndex((cur) => {
        const i = focusableIndices.indexOf(cur);
        return (
          focusableIndices[
            (i - 1 + focusableIndices.length) % focusableIndices.length
          ] ?? cur
        );
      });
    });
    const offEnter = registerShortcut('modal', 'Enter', () => {
      const item = contextMenu.items[activeIndex];
      if (!item || item.divider || item.disabled) return;
      dispatch({ type: 'HIDE_CONTEXT_MENU' });
      handleMenuAction(item.action, state, dispatch);
    });
    return () => {
      offEsc();
      offDown();
      offUp();
      offEnter();
    };
  }, [
    activeIndex,
    contextMenu.items,
    contextMenu.visible,
    dispatch,
    focusableIndices,
    state,
  ]);

  // Edge detection
  let x = contextMenu.x;
  let y = contextMenu.y;
  if (menuRef.current) {
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (x + rect.width > vw) x = vw - rect.width - 8;
    if (y + rect.height > vh) y = vh - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
  }

  if (!contextMenu.visible) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[4000] py-1.5 select-none"
      style={{
        left: x,
        top: y,
        minWidth: 180,
        maxWidth: 280,
        background: 'var(--bg-context-menu)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        boxShadow: 'var(--shadow-lg)',
        animation: 'ctxAppear 120ms cubic-bezier(0, 0, 0.2, 1)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {contextMenu.items.map((item, idx) => {
        if (item.divider) {
          return (
            <div
              key={item.id}
              className="my-1 mx-2"
              style={{ height: 1, background: 'var(--border-subtle)' }}
            />
          );
        }
        const isActive = idx === activeIndex;
        return (
          <button
            key={item.id}
            role="menuitem"
            aria-current={isActive ? 'true' : undefined}
            className="w-full flex items-center gap-2.5 px-3 h-8 text-sm transition-colors"
            style={{
              color: item.disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              margin: '0 4px',
              width: 'calc(100% - 8px)',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              background: isActive ? 'var(--bg-hover)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              setActiveIndex(idx);
              if (!item.disabled) e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isActive
                ? 'var(--bg-hover)'
                : 'transparent';
            }}
            onClick={() => {
              if (item.disabled) return;
              dispatch({ type: 'HIDE_CONTEXT_MENU' });
              handleMenuAction(item.action, state, dispatch);
            }}
          >
            {item.icon && (
              <DynamicIcon name={item.icon} size={16} className="shrink-0" />
            )}
            <span className="flex-1 text-left truncate">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-[var(--text-disabled)] ml-2">{item.shortcut}</span>
            )}
          </button>
        );
      })}

      <style>{`
        @keyframes ctxAppear {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
});

function handleMenuAction(
  action: string,
  state: import('@/types').OSState | unknown,
  dispatch: React.Dispatch<import('@/types').OSAction>,
) {
  const [cmd, ...args] = action.split(':');
  switch (cmd) {
    case 'OPEN_APP': {
      if (args[0]) dispatch({ type: 'OPEN_WINDOW', appId: args[0] });
      break;
    }
    case 'OPEN_APP_WITH_FILE': {
      // Phase 7 cont — file open-with hooks. The caller (Files →
      // right-click) stashes `{ file, podId }` in
      // contextMenu.contextData; we forward it as window args so each
      // viewer can render an OpenedFileBanner. The contextData is
      // shaped by the caller — we accept undefined values silently.
      const appId = args[0];
      if (!appId) break;
      const data =
        (state as { contextMenu?: { contextData?: Record<string, unknown> } })
          ?.contextMenu?.contextData ?? {};
      const file = typeof data.file === 'string' ? data.file : undefined;
      const podId = typeof data.podId === 'string' ? data.podId : undefined;
      dispatch({
        type: 'OPEN_WINDOW',
        appId,
        title: file ? `${appId} — ${file}` : undefined,
        args: file ? { file, podId } : undefined,
      });
      break;
    }
    case 'NEW_FOLDER':
    case 'NEW_DOCUMENT':
    case 'OPEN_TERMINAL':
    case 'CHANGE_BG':
    case 'ARRANGE_ICONS':
    case 'SHOW_SETTINGS':
    case 'PIN_DOCK':
    case 'UNPIN_DOCK':
    case 'QUIT_APP': {
      // Placeholder: will be handled by the component that opens the menu
      break;
    }
    case 'MINIMIZE_ALL': {
      dispatch({ type: 'MINIMIZE_ALL' });
      break;
    }
    default:
      break;
  }
}

export default ContextMenu;
