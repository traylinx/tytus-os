// ============================================================
// Text Editor — Multi-file text editor with syntax highlighting
// ============================================================
//
// Lifted from app/src/apps/TextEditor.tsx (deleted in W7 commit
// a359db8) as part of SPRINT-TYTUS-APP-SYSTEM-V1 Phase 5.
// Shell-internal hooks (`useFileSystem`, `useCurrentWindowArgs`)
// replaced with `host.fs.*` async calls and
// `host.windows.current.args`. Open-dialog file enumeration
// switched from full-graph traversal to async listing of the
// three user folders Documents / Desktop / Downloads.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FileText, FolderOpen, Save, Search, X, Plus, WrapText,
  Hash, ZoomIn, ZoomOut,
} from 'lucide-react';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { HostClient, UserFolderName } from '@tytus/host-api';

interface Props {
  host: HostClient;
}

// Local type for the optional window-args payload. The shared
// `WindowArgsByApp` map does not yet include a `'text-editor'`
// entry — keeping the shape app-local until the host wiring is
// negotiated. Apps reading their own args is allowed.
interface TextEditorArgs {
  editor?: {
    nodeId?: string;
    fileName?: string;
    initialContent?: string;
  };
}

interface OpenFile {
  id: string;
  name: string;
  content: string;
  isModified: boolean;
  cursorLine: number;
  cursorCol: number;
}

interface BrowsableFile {
  id: string;
  name: string;
  mimeType?: string;
  folder: UserFolderName;
}

const HIGHLIGHT_PATTERNS: Record<string, { pattern: RegExp; color: string }[]> = {
  js: [
    { pattern: /\/\/.*$/gm, color: 'var(--syntax-comment)' },
    { pattern: /\/\*[\s\S]*?\*\//g, color: 'var(--syntax-comment)' },
    { pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, color: 'var(--syntax-string)' },
    { pattern: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|try|catch|throw|typeof|instanceof)\b/g, color: 'var(--syntax-tag)' },
    { pattern: /\b(true|false|null|undefined)\b/g, color: 'var(--syntax-tag)' },
    { pattern: /\b\d+(?:\.\d+)?\b/g, color: 'var(--syntax-number)' },
  ],
  ts: [
    { pattern: /\/\/.*$/gm, color: 'var(--syntax-comment)' },
    { pattern: /\/\*[\s\S]*?\*\//g, color: 'var(--syntax-comment)' },
    { pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, color: 'var(--syntax-string)' },
    { pattern: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|try|catch|interface|type|extends|implements|readonly)\b/g, color: 'var(--syntax-tag)' },
    { pattern: /\b(string|number|boolean|any|void|null|undefined|true|false)\b/g, color: 'var(--syntax-type)' },
    { pattern: /\b\d+(?:\.\d+)?\b/g, color: 'var(--syntax-number)' },
  ],
  json: [
    { pattern: /"(?:[^"\\]|\\.)*"(?=\s*:)/g, color: 'var(--syntax-json-key)' },
    { pattern: /"(?:[^"\\]|\\.)*"/g, color: 'var(--syntax-json-string)' },
    { pattern: /\b(true|false|null)\b/g, color: 'var(--syntax-json-bool)' },
    { pattern: /\b\d+(?:\.\d+)?\b/g, color: 'var(--syntax-json-number)' },
  ],
  md: [
    { pattern: /^#{1,6}\s+.*/gm, color: 'var(--syntax-tag)' },
    { pattern: /\*\*(?:[^*]+)\*\*/g, color: 'var(--syntax-string)' },
    { pattern: /`[^`]+`/g, color: 'var(--syntax-function)' },
    { pattern: /^\s*[-*+]\s+/gm, color: 'var(--syntax-variable)' },
    { pattern: /^\s*\d+\.\s+/gm, color: 'var(--syntax-variable)' },
  ],
};

const BROWSABLE_FOLDERS: UserFolderName[] = ['documents', 'desktop', 'downloads'];

const FOLDER_LABEL: Record<UserFolderName, string> = {
  documents: 'Documents',
  desktop: 'Desktop',
  downloads: 'Downloads',
  music: 'Music',
};

const getFileExt = (name: string): string => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.js' || ext === '.jsx') return 'js';
  if (ext === '.ts' || ext === '.tsx') return 'ts';
  if (ext === '.json') return 'json';
  if (ext === '.md') return 'md';
  return '';
};

// Only text-shaped files are openable here. An audio/video/binary node
// (e.g. a Music Creator track shortcut with refTrackId) would render as
// garbage in the textarea — filter them out so the dialog stays useful.
const isTextish = (name: string, mime?: string): boolean => {
  if (mime?.startsWith('text/')) return true;
  if (mime && (mime === 'application/json' || mime === 'application/xml' || mime === 'application/javascript')) return true;
  const lower = name.toLowerCase();
  return /\.(txt|md|markdown|json|xml|csv|tsv|js|jsx|ts|tsx|css|scss|html|htm|py|rb|go|rs|java|c|cpp|h|sh|yml|yaml|toml|ini|env|log)$/.test(lower);
};

export function TextEditor({ host }: Props) {
  const FileIcon = useCallback(
    ({ name, ...props }: { name: string } & LucideProps) => {
      const iconName = host.fs.getIconForFileName(name);
      const Comp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[iconName];
      return Comp ? <Comp {...props} /> : <Icons.File {...props} />;
    },
    [host],
  );

  const args = host.windows.current.args as TextEditorArgs | undefined;
  const editorArgs = args?.editor;
  const seededRef = useRef(false);

  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [showOpen, setShowOpen] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [fontSize, setFontSize] = useState(13);
  const [wordWrap, setWordWrap] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [recentFiles, setRecentFiles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('texteditor_recent') || '[]'); } catch { return []; }
  });
  const [browsable, setBrowsable] = useState<BrowsableFile[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Refs let us mirror the textarea's scroll position to the syntax
  // overlay + the line-number gutter without re-rendering on every
  // scroll tick. translateY beats scrollTop for the gutter because
  // the gutter is `overflow-hidden` and would otherwise be locked.
  const overlayRef = useRef<HTMLDivElement>(null);
  const gutterInnerRef = useRef<HTMLDivElement>(null);

  const activeFile = files.find(f => f.id === activeFileId) || null;
  const lines = useMemo(() => activeFile ? activeFile.content.split('\n') : [], [activeFile]);
  const fileExt = activeFile ? getFileExt(activeFile.name) : '';

  const flashStatus = useCallback((text: string, ms = 2000) => {
    setStatusText(text);
    setTimeout(() => setStatusText(null), ms);
  }, []);

  const saveRecent = useCallback((ids: string[]) => {
    setRecentFiles(ids);
    try { localStorage.setItem('texteditor_recent', JSON.stringify(ids)); } catch { /* quota */ }
  }, []);

  const newFile = useCallback(() => {
    const id = 'new-' + Date.now();
    const file: OpenFile = { id, name: 'Untitled.txt', content: '', isModified: false, cursorLine: 1, cursorCol: 1 };
    setFiles(prev => [...prev, file]);
    setActiveFileId(id);
  }, []);

  const refreshBrowsable = useCallback(async () => {
    const out: BrowsableFile[] = [];
    for (const folder of BROWSABLE_FOLDERS) {
      try {
        const folderId = await host.fs.ensureUserFolder(folder);
        const children = await host.fs.list(folderId);
        for (const node of children) {
          if (node.isDirectory) continue;
          if (node.refTrackId || node.refVoiceRecordingId) continue;
          if (!isTextish(node.name, node.mimeType)) continue;
          out.push({ id: node.id, name: node.name, mimeType: node.mimeType, folder });
        }
      } catch {
        // Folder may not exist yet on first launch — skip silently.
      }
    }
    setBrowsable(out);
  }, [host]);

  // Open a file by FileNode id. Async because the new host-api `read`
  // returns a Promise; the legacy sync `readFile(id)` is gone.
  const openFileById = useCallback(async (nodeId: string) => {
    const existing = files.find(f => f.id === nodeId);
    if (existing) {
      setActiveFileId(nodeId);
      setShowOpen(false);
      return;
    }
    try {
      const node = await host.fs.getNodeById(nodeId);
      if (!node || node.isDirectory) {
        flashStatus('File not found');
        return;
      }
      // Hard refuse on non-text nodes (audio/video/binary, Music Creator
      // shortcut nodes carrying refTrackId, etc.) — the textarea would
      // just show garbage.
      if (node.refTrackId || node.refVoiceRecordingId) return;
      if (!isTextish(node.name, node.mimeType)) {
        flashStatus(`Not a text file: ${node.name}`, 2500);
        return;
      }
      const raw = await host.fs.read(nodeId);
      const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      const file: OpenFile = { id: nodeId, name: node.name, content, isModified: false, cursorLine: 1, cursorCol: 1 };
      setFiles(prev => [...prev, file]);
      setActiveFileId(nodeId);
      setShowOpen(false);
      const updated = [nodeId, ...recentFiles.filter(r => r !== nodeId)].slice(0, 10);
      saveRecent(updated);
    } catch (err) {
      flashStatus(`Open failed: ${(err as Error).message}`, 3000);
    }
  }, [files, host, recentFiles, saveRecent, flashStatus]);

  // Save: existing nodes → `host.fs.write`; freshly-typed buffers
  // (`new-*` ids) land in `Documents/` via `host.fs.createFile`. Async
  // throughout — the legacy sync hook is gone.
  const saveActiveFile = useCallback(async () => {
    if (!activeFile) return;
    try {
      if (activeFile.id.startsWith('new-')) {
        const docs = await host.fs.ensureUserFolder('documents');
        const newId = await host.fs.createFile(
          docs,
          activeFile.name,
          activeFile.content,
          { mimeType: 'text/plain' },
        );
        setFiles(prev => prev.map(f => f.id === activeFile.id
          ? { ...f, id: newId, isModified: false }
          : f));
        setActiveFileId(newId);
        const updated = [newId, ...recentFiles.filter(r => r !== newId)].slice(0, 10);
        saveRecent(updated);
        flashStatus(`Saved to Documents/${activeFile.name}`);
      } else {
        await host.fs.write(activeFile.id, activeFile.content);
        setFiles(prev => prev.map(f => f.id === activeFile.id
          ? { ...f, isModified: false }
          : f));
        flashStatus(`Saved ${activeFile.name}`);
      }
    } catch (err) {
      flashStatus(`Save failed: ${(err as Error).message}`, 3000);
    }
  }, [activeFile, host, recentFiles, saveRecent, flashStatus]);

  const closeFile = useCallback((id: string) => {
    setFiles(prev => {
      const filtered = prev.filter(f => f.id !== id);
      if (activeFileId === id) {
        setActiveFileId(filtered.length > 0 ? filtered[filtered.length - 1].id : null);
      }
      return filtered;
    });
  }, [activeFileId]);

  const updateContent = useCallback((content: string) => {
    if (!activeFile) return;
    setFiles(prev => prev.map(f => f.id === activeFile.id
      ? { ...f, content, isModified: true }
      : f));
  }, [activeFile]);

  const handleCursorChange = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || !activeFile) return;
    const val = ta.value;
    const pos = ta.selectionStart;
    const line = val.slice(0, pos).split('\n').length;
    const col = pos - val.lastIndexOf('\n', pos - 1);
    setFiles(prev => prev.map(f => f.id === activeFile.id
      ? { ...f, cursorLine: line, cursorCol: col }
      : f));
  }, [activeFile]);

  // Pre-load buffer when launched with args.editor (e.g. Music Creator
  // → "Open in Text Editor"). Runs once per window mount: a window
  // re-renders constantly, but the seed must only fire on first mount
  // or we'd push duplicate buffers each tick.
  useEffect(() => {
    if (seededRef.current || !editorArgs) return;
    seededRef.current = true;

    let cancelled = false;
    const seed = async () => {
      if (editorArgs.nodeId) {
        try {
          const node = await host.fs.getNodeById(editorArgs.nodeId);
          if (cancelled) return;
          if (node && !node.isDirectory) {
            const raw = await host.fs.read(node.id);
            if (cancelled) return;
            const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
            setFiles(prev => prev.some(f => f.id === node.id)
              ? prev
              : [...prev, { id: node.id, name: node.name, content, isModified: false, cursorLine: 1, cursorCol: 1 }]);
            setActiveFileId(node.id);
            return;
          }
        } catch {
          // fall through to unsaved-buffer path
        }
      }

      // No persistent node — open as an unsaved buffer. Save will land
      // it in Documents via the existing saveActiveFile path.
      const id = `new-${Date.now()}`;
      const file: OpenFile = {
        id,
        name: editorArgs.fileName || 'Untitled.txt',
        content: editorArgs.initialContent ?? '',
        isModified: Boolean(editorArgs.initialContent),
        cursorLine: 1,
        cursorCol: 1,
      };
      if (cancelled) return;
      setFiles(prev => [...prev, file]);
      setActiveFileId(id);
    };

    void seed();
    return () => { cancelled = true; };
  }, [editorArgs, host]);

  // Keyboard shortcuts. saveActiveFile is async — fire-and-forget here,
  // it owns its own status feedback.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void saveActiveFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowFind(v => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        setShowOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [saveActiveFile, newFile]);

  // Refresh the Open dialog file list whenever it's about to be shown.
  // No long-lived watcher: keeps the lift small + matches markdown-preview's
  // "list-on-demand" pattern. Phase-6 can swap to host.fs.watch().
  useEffect(() => {
    if (!showOpen) return;
    void refreshBrowsable();
  }, [showOpen, refreshBrowsable]);

  // Highlighted lines
  const renderHighlighted = (line: string, ext: string) => {
    if (!ext || !HIGHLIGHT_PATTERNS[ext]) return line;
    const patterns = HIGHLIGHT_PATTERNS[ext];
    let result: React.ReactNode[] = [line];
    patterns.forEach(({ pattern, color }) => {
      const newResult: React.ReactNode[] = [];
      result.forEach((node, i) => {
        if (typeof node !== 'string') { newResult.push(node); return; }
        let lastIndex = 0;
        const matches = [...node.matchAll(new RegExp(pattern, 'g'))];
        matches.forEach((match) => {
          const idx = match.index ?? 0;
          if (idx > lastIndex) newResult.push(node.slice(lastIndex, idx));
          newResult.push(<span key={`${i}-${idx}`} style={{ color }}>{match[0]}</span>);
          lastIndex = idx + match[0].length;
        });
        if (lastIndex < node.length) newResult.push(node.slice(lastIndex));
      });
      result = newResult;
    });
    return result;
  };

  // Recent-files panel needs node names. Async lookups would flicker the
  // empty state; instead we cache a name+textish snapshot keyed by id.
  // Refreshed alongside the Open dialog (cheap — same `list()` calls).
  const recentSnapshot = useMemo(() => {
    const idx = new Map<string, BrowsableFile>();
    for (const b of browsable) idx.set(b.id, b);
    return idx;
  }, [browsable]);

  // Trigger an initial browsable load so the Recent panel can render
  // names even before the user opens the dialog.
  useEffect(() => {
    void refreshBrowsable();
  }, [refreshBrowsable]);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-window)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 h-10 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-titlebar)' }}>
        <button onClick={newFile} className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)]" title="New (Ctrl+N)">
          <Plus size={14} /> New
        </button>
        <button onClick={() => setShowOpen(true)} className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)]" title="Open (Ctrl+O)">
          <FolderOpen size={14} /> Open
        </button>
        <button onClick={() => { void saveActiveFile(); }} className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)]" title="Save (Ctrl+S)">
          <Save size={14} /> Save
        </button>
        <div className="w-px h-5 mx-1" style={{ background: 'var(--border-subtle)' }} />
        <button onClick={() => setShowFind(!showFind)} className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)]">
          <Search size={14} /> Find
        </button>
        <button onClick={() => setWordWrap(!wordWrap)} className={`flex items-center gap-1 px-2 py-1 rounded-sm text-xs ${wordWrap ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'} hover:bg-[var(--bg-hover)]`} title="Word Wrap">
          <WrapText size={14} />
        </button>
        <button onClick={() => setShowLineNumbers(!showLineNumbers)} className={`flex items-center gap-1 px-2 py-1 rounded-sm text-xs ${showLineNumbers ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'} hover:bg-[var(--bg-hover)]`} title="Line Numbers">
          <Hash size={14} />
        </button>
        <div className="flex-1" />
        {statusText && (
          <span className="text-[10px] mr-2" style={{ color: 'var(--text-secondary)' }}>{statusText}</span>
        )}
        <button onClick={() => setFontSize(s => Math.max(8, s - 1))} className="p-1 rounded-sm hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
          <ZoomOut size={14} />
        </button>
        <span className="text-[10px] text-[var(--text-secondary)] w-6 text-center">{fontSize}</span>
        <button onClick={() => setFontSize(s => Math.min(32, s + 1))} className="p-1 rounded-sm hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
          <ZoomIn size={14} />
        </button>
      </div>

      {/* Find bar */}
      {showFind && (
        <div className="flex items-center gap-2 px-3 h-9 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-titlebar)' }}>
          <Search size={14} className="text-[var(--text-secondary)]" />
          <input
            autoFocus
            value={findQuery}
            onChange={e => setFindQuery(e.target.value)}
            placeholder="Find..."
            className="flex-1 rounded-input bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]"
          />
          <button onClick={() => setShowFind(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tabs — outer is a div+role="tab" so the close affordance can be a
          real <button> without nesting. Avoids the React validateDOMNesting
          warning while keeping keyboard click semantics. */}
      {files.length > 0 && (
        <div className="flex items-center gap-0 border-b overflow-x-auto custom-scrollbar" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-titlebar)' }}>
          {files.map(f => (
            <div
              key={f.id}
              role="tab"
              tabIndex={0}
              onClick={() => setActiveFileId(f.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveFileId(f.id); } }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border-r min-w-0 shrink-0 transition-colors cursor-pointer outline-none"
              style={{
                borderColor: 'var(--border-subtle)',
                background: activeFileId === f.id ? 'var(--bg-window)' : 'transparent',
                color: activeFileId === f.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderBottom: activeFileId === f.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
              }}
            >
              <FileIcon name={f.name} size={12} />
              <span className="truncate max-w-[120px]">{f.isModified ? '● ' : ''}{f.name}</span>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); closeFile(f.id); }}
                className="ml-1 hover:text-[var(--accent-error)]"
                aria-label={`Close ${f.name}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Editor area — single scroller (the textarea). Both the line-number
          gutter and the syntax-highlight overlay are pure visual layers:
          they don't scroll themselves, they translate by -scrollTop on
          each onScroll tick. Avoids the previous "two scrollbars" bug. */}
      {activeFile ? (
        <div className="flex-1 flex overflow-hidden relative">
          {/* Line numbers — outer is overflow-hidden, inner div translates
              with the textarea's scrollTop. */}
          {showLineNumbers && (
            <div
              className="shrink-0 overflow-hidden py-2 text-right select-none"
              style={{
                width: 48,
                background: 'var(--bg-titlebar)',
                borderRight: '1px solid var(--border-subtle)',
                fontSize,
                lineHeight: `${fontSize + 6}px`,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <div ref={gutterInnerRef} style={{ willChange: 'transform' }}>
                {lines.map((_, i) => (
                  <div
                    key={i}
                    className="px-2"
                    style={{
                      color: i + 1 === activeFile.cursorLine ? 'var(--text-primary)' : 'var(--text-disabled)',
                      fontWeight: i + 1 === activeFile.cursorLine ? 600 : 400,
                    }}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Textarea owns all scroll. The highlight overlay lives behind
              the (transparent-text) textarea and slides with it. */}
          <div className="flex-1 relative overflow-hidden">
            <textarea
              ref={textareaRef}
              value={activeFile.content}
              onChange={e => updateContent(e.target.value)}
              onKeyUp={handleCursorChange}
              onClick={handleCursorChange}
              onScroll={(e) => {
                const top = (e.currentTarget as HTMLTextAreaElement).scrollTop;
                if (overlayRef.current) overlayRef.current.style.transform = `translateY(${-top}px)`;
                if (gutterInnerRef.current) gutterInnerRef.current.style.transform = `translateY(${-top}px)`;
              }}
              spellCheck={false}
              className="absolute inset-0 w-full h-full resize-none outline-none bg-transparent text-transparent caret-[var(--text-primary)] p-2 z-10 custom-scrollbar"
              style={{
                fontSize,
                lineHeight: `${fontSize + 6}px`,
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                tabSize: 4,
              }}
            />
            {/* Syntax highlight overlay — non-scrolling; scrollTop synced
                from the textarea's onScroll above. */}
            <div
              ref={overlayRef}
              className="absolute inset-0 pointer-events-none p-2"
              style={{
                fontSize,
                lineHeight: `${fontSize + 6}px`,
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                tabSize: 4,
                color: 'var(--text-primary)',
                willChange: 'transform',
              }}
            >
              {fileExt && HIGHLIGHT_PATTERNS[fileExt]
                ? lines.map((line, i) => (
                  <div key={i}>{renderHighlighted(line, fileExt)}</div>
                ))
                : activeFile.content
              }
            </div>
          </div>

          {/* Find matches indicator */}
          {showFind && findQuery && (
            <div className="absolute bottom-8 right-4 px-2 py-1 rounded-sm text-[10px]" style={{ background: 'var(--accent-primary)', color: 'white' }}>
              {(activeFile.content.match(new RegExp(findQuery, 'g')) || []).length} matches
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <FileText size={48} className="text-[var(--text-disabled)] opacity-30" />
          <div className="text-sm text-[var(--text-secondary)]">Open a file or create a new document</div>
          <div className="flex gap-2">
            <button onClick={newFile} className="px-4 py-2 rounded-sm text-xs font-medium" style={{ background: 'var(--accent-primary)', color: 'white' }}>
              New File
            </button>
            <button onClick={() => setShowOpen(true)} className="px-4 py-2 rounded-sm text-xs font-medium border" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              Open File
            </button>
          </div>
          {recentFiles.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] text-[var(--text-disabled)] uppercase tracking-wider mb-2 text-center">Recent Files</div>
              {recentFiles.slice(0, 5).map(rf => {
                const node = recentSnapshot.get(rf);
                if (!node) return null;
                return (
                  <button
                    key={rf}
                    onClick={() => { void openFileById(rf); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 rounded-sm text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <FileIcon name={node.name} size={12} /> {node.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Status bar */}
      {activeFile && (
        <div className="flex items-center gap-4 px-3 h-6 border-t shrink-0 text-[10px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-titlebar)', color: 'var(--text-secondary)' }}>
          <span>{activeFile.name.split('.').pop()?.toUpperCase() || 'TXT'}</span>
          <span>UTF-8</span>
          <span>Ln {activeFile.cursorLine}, Col {activeFile.cursorCol}</span>
          <span>{activeFile.content.length} chars</span>
          <span>{activeFile.content.split(/\s+/).filter(Boolean).length} words</span>
          <div className="flex-1" />
          {activeFile.isModified && <span className="text-[var(--accent-warning)]">Modified</span>}
        </div>
      )}

      {/* Open file dialog */}
      {showOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-[480px] max-h-[400px] rounded-lg flex flex-col overflow-hidden" style={{ background: 'var(--bg-window)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Open File</h3>
              <button onClick={() => setShowOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar p-2">
              {browsable.length === 0 && (
                <div className="px-3 py-6 text-xs text-center text-[var(--text-disabled)]">
                  No text files in Documents, Desktop, or Downloads.
                </div>
              )}
              {browsable.map(f => (
                <button
                  key={f.id}
                  onClick={() => { void openFileById(f.id); }}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-sm text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <FileIcon name={f.name} size={14} className="text-[var(--text-secondary)]" />
                  <span className="flex-1 text-left">{f.name}</span>
                  <span className="text-[var(--text-disabled)]">{FOLDER_LABEL[f.folder]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

