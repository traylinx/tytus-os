import { useState, useEffect, useCallback, useRef, useMemo, type ReactElement } from 'react';
import {
  FileText, Search, WrapText, List, X, FolderOpen,
  ChevronLeft, ChevronRight, Type, Eye
} from 'lucide-react';
import { useFileSystem } from '@/hooks/useFileSystem';
import { useCurrentWindowArgs } from '@/hooks/useCurrentWindow';
import OpenedFileBanner from '@/components/OpenedFileBanner';

interface DocumentViewerProps {
  fileNodeId?: string;
}

const EXTENSION_LANG: Record<string, string> = {
  txt: 'text', md: 'markdown', json: 'json', js: 'javascript',
  ts: 'typescript', html: 'html', css: 'css', py: 'python',
};

const SYNTAX_PATTERNS: Record<string, { pattern: RegExp; color: string }[]> = {
  json: [
    { pattern: /"[^"]*":/g, color: 'var(--syntax-json-key)' },
    { pattern: /"[^"]*"/g, color: 'var(--syntax-json-string)' },
    { pattern: /\b(true|false|null)\b/g, color: 'var(--syntax-json-bool)' },
    { pattern: /-?\d+\.?\d*/g, color: 'var(--syntax-json-number)' },
  ],
  javascript: [
    { pattern: /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|new|this|try|catch|async|await)\b/g, color: 'var(--syntax-tag)' },
    { pattern: /"[^"]*"|'[^']*'/g, color: 'var(--syntax-string)' },
    { pattern: /\b\d+\b/g, color: 'var(--syntax-number)' },
    { pattern: /\/\/.*$/gm, color: 'var(--syntax-comment)' },
    { pattern: /\b(console|document|window|Math|JSON|Array|Object|String|Number)\b/g, color: 'var(--syntax-type)' },
  ],
  typescript: [
    { pattern: /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|new|this|try|catch|async|await|interface|type|extends|implements)\b/g, color: 'var(--syntax-tag)' },
    { pattern: /"[^"]*"|'[^']*'/g, color: 'var(--syntax-string)' },
    { pattern: /\b\d+\b/g, color: 'var(--syntax-number)' },
    { pattern: /\/\/.*$/gm, color: 'var(--syntax-comment)' },
    { pattern: /\b(console|document|window|Math|JSON|Array|Object|string|number|boolean)\b/g, color: 'var(--syntax-type)' },
  ],
  html: [
    { pattern: /<[^>]+>/g, color: 'var(--syntax-tag)' },
    { pattern: /"[^"]*"/g, color: 'var(--syntax-string)' },
  ],
  css: [
    { pattern: /[.#][^{]+/g, color: 'var(--syntax-function)' },
    { pattern: /\b[a-z-]+(?=\s*:)/g, color: 'var(--syntax-attribute)' },
    { pattern: /:\s*[^;]+/g, color: 'var(--syntax-string)' },
  ],
};

function highlightLine(line: string, lang: string): ReactElement {
  const patterns = SYNTAX_PATTERNS[lang];
  if (!patterns || !line) return <>{line}</>;

  const elements: ReactElement[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    let bestMatch: { index: number; length: number; color: string; text: string } | null = null;
    for (const { pattern, color } of patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(remaining);
      if (match && (bestMatch === null || match.index < bestMatch.index)) {
        bestMatch = { index: match.index, length: match[0].length, color, text: match[0] };
      }
    }
    if (!bestMatch || bestMatch.length === 0) {
      elements.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (bestMatch.index > 0) {
      elements.push(<span key={key++}>{remaining.slice(0, bestMatch.index)}</span>);
    }
    elements.push(<span key={key++} style={{ color: bestMatch.color }}>{bestMatch.text}</span>);
    remaining = remaining.slice(bestMatch.index + bestMatch.length);
  }
  return <>{elements}</>;
}

export default function DocumentViewer({ fileNodeId }: DocumentViewerProps) {
  const { fs, readFile, getNodeById, getChildren } = useFileSystem();
  const [currentFileId, setCurrentFileId] = useState<string | undefined>(fileNodeId);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [pickerPath, setPickerPath] = useState<string>('Documents');
  const contentRef = useRef<HTMLDivElement>(null);

  const node = currentFileId ? getNodeById(currentFileId) : undefined;
  const content = currentFileId ? readFile(currentFileId) || '' : '';
  const lines = useMemo(() => content.split('\n'), [content]);
  const ext = node?.name?.split('.').pop()?.toLowerCase() || 'txt';
  const lang = EXTENSION_LANG[ext] || 'text';

  const fileInfo = useMemo(() => ({
    name: node?.name || 'No file open',
    size: node?.size || 0,
    type: ext.toUpperCase(),
    lines: lines.length,
  }), [node, ext, lines.length]);

  const searchMatches = useMemo(() => {
    if (!searchQuery) return [];
    const matches: number[] = [];
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(searchQuery.toLowerCase())) matches.push(i);
    });
    return matches;
  }, [searchQuery, lines]);

  const openFile = useCallback((id: string) => {
    setCurrentFileId(id);
    setShowFilePicker(false);
    setSearchQuery('');
  }, []);

  useEffect(() => {
    if (fileNodeId) setCurrentFileId(fileNodeId);
  }, [fileNodeId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(s => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const navigateSearch = (dir: number) => {
    if (searchMatches.length === 0) return;
    const next = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    const el = document.getElementById(`line-${searchMatches[next]}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const getTextFiles = useCallback(() => {
    const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css'];
    return Object.values(fs.nodes).filter(
      n => n.type === 'file' && textExts.some(ext => n.name.endsWith(ext))
    );
  }, [fs.nodes]);

  const launchedWith = useCurrentWindowArgs();

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-window)' }}>
      {launchedWith?.file && (
        <OpenedFileBanner
          file={launchedWith.file}
          podId={launchedWith.podId}
          appName="Document Viewer"
        />
      )}
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-panel)' }}>
        <button onClick={() => setShowFilePicker(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors" style={{ color: 'var(--text-primary)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <FolderOpen size={14} /> Open
        </button>
        <div className="w-px h-5 mx-1" style={{ background: 'var(--border-subtle)' }} />
        <button onClick={() => setShowLineNumbers(s => !s)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors" style={{ color: showLineNumbers ? 'var(--accent-primary)' : 'var(--text-secondary)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <List size={14} /> Lines
        </button>
        <button onClick={() => setWordWrap(s => !s)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors" style={{ color: wordWrap ? 'var(--accent-primary)' : 'var(--text-secondary)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <WrapText size={14} /> Wrap
        </button>
        <button onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(''); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors" style={{ color: showSearch ? 'var(--accent-primary)' : 'var(--text-secondary)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <Search size={14} /> Find
        </button>
        <div className="flex-1" />
        {node && (
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>{fileInfo.name}</span>
            <span>{fileInfo.size} bytes</span>
            <span>{fileInfo.type}</span>
            <span>{fileInfo.lines} lines</span>
          </div>
        )}
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-panel)' }}>
          <Search size={14} style={{ color: 'var(--text-secondary)' }} />
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSearchIndex(0); }}
            onKeyDown={e => { if (e.key === 'Enter') navigateSearch(e.shiftKey ? -1 : 1); }}
            placeholder="Search..."
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {searchMatches.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {searchIndex + 1}/{searchMatches.length}
            </span>
          )}
          <button onClick={() => navigateSearch(-1)} className="p-1 rounded-sm" style={{ color: 'var(--text-secondary)' }}><ChevronLeft size={14} /></button>
          <button onClick={() => navigateSearch(1)} className="p-1 rounded-sm" style={{ color: 'var(--text-secondary)' }}><ChevronRight size={14} /></button>
          <button onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="p-1 rounded-sm" style={{ color: 'var(--text-secondary)' }}><X size={14} /></button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto custom-scrollbar" ref={contentRef}>
        {node ? (
          <div className="flex" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' }}>
            {showLineNumbers && (
              <div className="select-none text-right pr-3 pl-2 py-2" style={{ color: 'var(--text-disabled)', background: 'var(--bg-panel)', minWidth: '48px' }}>
                {lines.map((_, i) => (
                  <div key={i} className="leading-5">{i + 1}</div>
                ))}
              </div>
            )}
            <div className={`flex-1 py-2 px-3 ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
              {lines.map((line, i) => {
                const isMatch = searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase());
                return (
                  <div
                    key={i}
                    id={`line-${i}`}
                    className="leading-5"
                    style={isMatch ? { background: 'rgba(124,77,255,0.2)' } : undefined}
                  >
                    {lang !== 'text' ? highlightLine(line, lang) : line || ' '}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--text-secondary)' }}>
            <FileText size={48} strokeWidth={1} />
            <p className="text-sm">No file open</p>
            <button
              onClick={() => setShowFilePicker(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm"
              style={{ background: 'var(--accent-primary)', color: '#fff' }}
            >
              <FolderOpen size={14} /> Open File
            </button>
          </div>
        )}
      </div>

      {/* File picker modal */}
      {showFilePicker && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-lg shadow-xl overflow-hidden" style={{ width: '480px', maxHeight: '400px', background: 'var(--bg-window)' }}>
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-panel)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Open File</span>
              <button onClick={() => setShowFilePicker(false)} className="p-1 rounded-sm"><X size={14} /></button>
            </div>
            <div className="overflow-auto custom-scrollbar p-2" style={{ maxHeight: '320px' }}>
              {getTextFiles().map(file => (
                <button
                  key={file.id}
                  onClick={() => openFile(file.id)}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-left text-sm transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <FileText size={14} style={{ color: 'var(--accent-primary)' }} />
                  <span className="flex-1">{file.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>{file.size || 0} B</span>
                </button>
              ))}
              {getTextFiles().length === 0 && (
                <div className="text-center py-8 text-sm" style={{ color: 'var(--text-secondary)' }}>No text files found</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
