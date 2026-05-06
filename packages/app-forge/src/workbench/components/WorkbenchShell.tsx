
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { HostClient } from '@tytus/host-api';
import {
  Blocks,
  Bot,
  Bug,
  ChevronDown,
  File,
  FileCode2,
  FilePlus2,
  FileSearch,
  Folder,
  FolderOpen,
  GitBranch,
  Eye,
  MessageSquareText,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Plus,
  Play,
  Search,
  Send,
  Settings,
  UserCircle,
  X,
} from 'lucide-react';
import { hasFileSystemAccessApi, openFiles, openFolder, saveWorkbenchFile } from '../fileAccess';
import { labelForLanguage } from '../language';
import { markdownToHtml } from '../markdown';
import type { ActivityView, ChatMessage, CursorPosition, OutputArtifact, SecondaryTab, WorkbenchFile, WorkbenchFolder } from '../types';

const WorkbenchMonacoEditor = lazy(() => import('../editor/WorkbenchMonacoEditor').then((module) => ({ default: module.WorkbenchMonacoEditor })));

const welcomeFile: WorkbenchFile = {
  id: 'welcome',
  name: 'Welcome',
  path: 'Welcome',
  language: 'text',
  content: '',
  dirty: false,
  source: 'sample',
};

const RECENT_KEY = 'tytus.forge.vscodeBase.recent';
const LAYOUT_KEY = 'tytus.forge.vscodeBase.layout';

type Props = { host: HostClient };

type RecentEntry = { name: string; path: string; at: number };
type LayoutPrefs = { primaryVisible: boolean; primaryWidth: number; secondaryVisible: boolean; secondaryWidth: number; markdownPreviewVisible: boolean };
type PaletteItem = { label: string; detail: string; run: () => void; disabled?: boolean };
type SearchResult = { file: WorkbenchFile; lineNumber: number; line: string };
type BottomPanelTab = 'problems' | 'output' | 'terminal';

export function WorkbenchShell({ host }: Props) {
  const initialLayout = useMemo(() => readLayoutPrefs(), []);
  const [activity, setActivity] = useState<ActivityView>('explorer');
  const [primaryVisible, setPrimaryVisible] = useState(initialLayout.primaryVisible);
  const [primaryWidth, setPrimaryWidth] = useState(initialLayout.primaryWidth);
  const [secondaryTab, setSecondaryTab] = useState<SecondaryTab>('chat');
  const [secondaryVisible, setSecondaryVisible] = useState(initialLayout.secondaryVisible);
  const [secondaryWidth, setSecondaryWidth] = useState(initialLayout.secondaryWidth);
  const [bottomPanelVisible, setBottomPanelVisible] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('problems');
  const [markdownPreviewVisible, setMarkdownPreviewVisible] = useState(initialLayout.markdownPreviewVisible);
  const [welcomeClosed, setWelcomeClosed] = useState(false);
  const [folder, setFolder] = useState<WorkbenchFolder | null>(null);
  const [files, setFiles] = useState<WorkbenchFile[]>([]);
  const [openEditorIds, setOpenEditorIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<CursorPosition>({ lineNumber: 1, column: 1 });
  const [chatInput, setChatInput] = useState('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [outputs, setOutputs] = useState<OutputArtifact[]>([]);
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const [status, setStatus] = useState('Ready');
  const [recent, setRecent] = useState<RecentEntry[]>(() => readRecent());

  const openEditors = openEditorIds.map((id) => files.find((file) => file.id === id)).filter(Boolean) as WorkbenchFile[];
  const activeFile = activeFileId ? files.find((file) => file.id === activeFileId) ?? null : null;
  const showWelcome = !activeFile && !welcomeClosed;
  const dirtyFiles = useMemo(() => files.filter((file) => file.dirty), [files]);
  const visibleFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, query]);


  const beginSecondaryResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = secondaryWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const next = startWidth + (startX - moveEvent.clientX);
      setSecondaryWidth(Math.max(380, Math.min(760, next)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [secondaryWidth]);

  const beginPrimaryResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = primaryWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const next = startWidth + (moveEvent.clientX - startX);
      setPrimaryWidth(Math.max(240, Math.min(460, next)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [primaryWidth]);

  const remember = useCallback((entry: RecentEntry) => {
    const next = [entry, ...recent.filter((item) => item.path !== entry.path)].slice(0, 6);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }, [recent]);

  const openWorkbenchFile = useCallback((file: WorkbenchFile, lineNumber?: number) => {
    setOpenEditorIds((ids) => ids.includes(file.id) ? ids : [...ids, file.id]);
    setActiveFileId(file.id);
    setWelcomeClosed(false);
    setRevealLine(lineNumber ?? null);
    setCursor({ lineNumber: lineNumber ?? 1, column: 1 });
  }, []);

  const handleOpenFile = useCallback(async () => {
    if (!confirmDiscardDirty(dirtyFiles, 'open new files')) return;
    try {
      const picked = await openFiles();
      if (picked.length === 0) return;
      setFiles((current) => mergeFiles(current, picked));
      picked.forEach((file) => remember({ name: file.name, path: file.path, at: Date.now() }));
      openWorkbenchFile(picked[0]);
      setStatus(`Opened ${picked.length} local file${picked.length === 1 ? '' : 's'}`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setStatus(`Open file failed: ${(err as Error).message}`);
    }
  }, [dirtyFiles, openWorkbenchFile, remember]);

  const handleOpenFolder = useCallback(async () => {
    if (!confirmDiscardDirty(dirtyFiles, 'open another folder')) return;
    try {
      const picked = await openFolder();
      setFolder(picked);
      setFiles(picked.files);
      setOpenEditorIds([]);
      setActiveFileId(null);
      setWelcomeClosed(false);
      remember({ name: picked.name, path: picked.name, at: Date.now() });
      setStatus(`${picked.handle ? 'Opened local folder' : 'Opened browser fallback folder'} ${picked.name} (${picked.files.length} text files indexed)`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setStatus(`Open folder failed: ${(err as Error).message}`);
    }
  }, [dirtyFiles, remember]);

  const updateActiveFile = useCallback((content: string) => {
    if (!activeFileId) return;
    setFiles((current) => current.map((file) => file.id === activeFileId ? { ...file, content, dirty: content !== file.content || file.dirty } : file));
  }, [activeFileId]);

  const saveActiveFile = useCallback(async () => {
    if (!activeFile) return;
    try {
      const saved = await saveWorkbenchFile(activeFile);
      setFiles((current) => current.map((file) => file.id === saved.id ? saved : file));
      setStatus(`Saved ${saved.name}`);
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
    }
  }, [activeFile]);

  const saveFileById = useCallback(async (id: string) => {
    const file = files.find((candidate) => candidate.id === id);
    if (!file) return null;
    const saved = await saveWorkbenchFile(file);
    setFiles((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
    return saved;
  }, [files]);

  const saveAllDirty = useCallback(async () => {
    const targets = files.filter((file) => file.dirty);
    if (targets.length === 0) {
      setStatus('No dirty files to save');
      return;
    }
    try {
      const saved = await Promise.all(targets.map((file) => saveWorkbenchFile(file)));
      const savedMap = new Map(saved.map((file) => [file.id, file]));
      setFiles((current) => current.map((file) => savedMap.get(file.id) ?? file));
      setStatus(`Saved ${saved.length} dirty file${saved.length === 1 ? '' : 's'}`);
    } catch (err) {
      setStatus(`Save all failed: ${(err as Error).message}`);
    }
  }, [files]);

  const closeEditor = useCallback((id: string) => {
    const file = files.find((candidate) => candidate.id === id);
    if (file?.dirty) {
      const discard = window.confirm(`${file.name} has unsaved changes. Close without saving?`);
      if (!discard) {
        setStatus(`Close canceled — ${file.name} has unsaved changes`);
        return;
      }
    }
    setOpenEditorIds((ids) => {
      const next = ids.filter((editorId) => editorId !== id);
      if (activeFileId === id) setActiveFileId(next.at(-1) ?? null);
      return next;
    });
  }, [activeFileId, files]);

  const closeAllEditors = useCallback(() => {
    if (!confirmDiscardDirty(dirtyFiles, 'close all editors')) return;
    setOpenEditorIds([]);
    setActiveFileId(null);
    setRevealLine(null);
    setWelcomeClosed(false);
    setStatus('Closed all editors');
  }, [dirtyFiles]);

  const newUntitled = useCallback(() => {
    const count = files.filter((file) => file.name.startsWith('Untitled')).length + 1;
    const file: WorkbenchFile = {
      id: `untitled-${Date.now()}`,
      name: `Untitled-${count}`,
      path: `Untitled-${count}.md`,
      language: 'markdown',
      content: '# Untitled\n',
      dirty: true,
      source: 'generated',
    };
    setFiles((current) => [...current, file]);
    openWorkbenchFile(file);
  }, [files, openWorkbenchFile]);

  const runLocalSynthesis = useCallback(() => {
    const source = activeFile ?? files[0];
    if (!source) {
      setStatus('No open file to synthesize');
      return;
    }
    const lines = source.content.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6);
    const artifact: OutputArtifact = {
      id: `output-${Date.now()}`,
      title: `Local draft from ${source.name}`,
      kind: 'local-draft',
      body: ['# Local synthesis', '', ...lines.map((line) => `- ${line.replace(/^#+\s*/, '')}`), '', '> Deterministic local draft. Real agents wire in next sprint.'].join('\n'),
      createdAt: Date.now(),
    };
    setOutputs((current) => [artifact, ...current]);
    setBottomPanelVisible(true);
    setBottomPanelTab('output');
    setSecondaryTab('outputs');
    setSecondaryVisible(true);
    setStatus('Local synthesis created');
  }, [activeFile, files]);

  const reopenRecent = useCallback((entry: RecentEntry) => {
    const existing = files.find((file) => file.path === entry.path || file.name === entry.name);
    if (existing) {
      openWorkbenchFile(existing);
      setStatus(`Opened recent ${existing.name}`);
      return;
    }
    setStatus('Browser security requires permission again — use Open File or Open Folder to reopen local content.');
  }, [files, openWorkbenchFile]);

  const askAgent = useCallback(() => {
    const prompt = chatInput.trim();
    if (!prompt) return;
    const source = activeFile ?? files[0];
    const answer = source
      ? `Local draft only. Open source: ${source.path}. Prompt received: ${prompt}. Pod/AIL agent execution is intentionally not wired in this base sprint.`
      : `Local draft only. Open a file or folder first. Prompt received: ${prompt}.`;
    setChatMessages((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: 'user', body: prompt },
      { id: `a-${Date.now()}`, role: 'assistant', body: answer },
    ]);
    setChatInput('');
  }, [activeFile, chatInput, files]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); void handleOpenFile(); }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void saveActiveFile(); }
      if (event.key.toLowerCase() === 'w') { event.preventDefault(); if (activeFileId) closeEditor(activeFileId); }
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); setPrimaryVisible((value) => !value); }
      if (event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setActivity('search'); setPrimaryVisible(true); }
      if (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p') { event.preventDefault(); setCommandPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeFileId, closeEditor, handleOpenFile, saveActiveFile]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyFiles.length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyFiles.length]);

  useEffect(() => {
    const prefs: LayoutPrefs = { primaryVisible, primaryWidth, secondaryVisible, secondaryWidth, markdownPreviewVisible };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(prefs));
  }, [markdownPreviewVisible, primaryVisible, primaryWidth, secondaryVisible, secondaryWidth]);

  return (
    <div
      className={`forge-workbench ${primaryVisible ? '' : 'no-primary'} ${secondaryVisible ? '' : 'no-secondary'} ${bottomPanelVisible ? 'has-bottom-panel' : ''}`}
      data-app="forge-vscode-base"
      style={{ '--forge-primary-width': `${primaryWidth}px`, '--forge-secondary-width': `${secondaryWidth}px` } as CSSProperties}
    >
      <ActivityBar active={activity} setActive={(view) => { setActivity(view); setPrimaryVisible(true); }} />
      {primaryVisible && (
        <div className="forge-primary-region">
          <PrimarySidebar
            activity={activity}
            folder={folder}
            files={activity === 'search' ? files : visibleFiles}
            openEditors={openEditors}
            activeFileId={activeFileId}
            query={query}
            setQuery={setQuery}
            openFile={handleOpenFile}
            openFolder={handleOpenFolder}
            openWorkbenchFile={openWorkbenchFile}
            newFile={newUntitled}
            recent={recent}
            reopenRecent={reopenRecent}
            setStatus={setStatus}
            hasFsAccess={hasFileSystemAccessApi()}
          />
          <div className="forge-primary-resizer" onPointerDown={beginPrimaryResize} title="Resize Explorer" />
        </div>
      )}
      <main className="forge-editor-area">
        <button className="forge-command-center" onClick={() => setCommandPaletteOpen(true)}>Workspace</button>
        <section className="forge-editor-stack">
          <EditorTabs
            openEditors={openEditors}
            activeFileId={activeFileId}
            showWelcome={showWelcome}
            setActiveFileId={setActiveFileId}
            closeEditor={closeEditor}
            saveFile={(id) => { void saveFileById(id); }}
            closeWelcome={() => setWelcomeClosed(true)}
            secondaryVisible={secondaryVisible}
            toggleSecondary={() => setSecondaryVisible((value) => !value)}
            canPreview={activeFile?.language === 'markdown'}
            previewVisible={markdownPreviewVisible}
            togglePreview={() => setMarkdownPreviewVisible((value) => !value)}
          />
          <BreadcrumbBar file={activeFile} folder={folder} showWelcome={showWelcome} />
          <div className="forge-editor-content">
            {activeFile ? (
              <div className={activeFile.language === 'markdown' && markdownPreviewVisible ? 'forge-editor-split' : 'forge-editor-single'}>
                <div className="forge-editor-pane">
                  <Suspense fallback={<div className="forge-empty-pane">Loading editor…</div>}>
                    <WorkbenchMonacoEditor
                      key={activeFile.id}
                      file={activeFile}
                      revealLine={revealLine}
                      onChange={updateActiveFile}
                      onCursorChange={setCursor}
                      onSave={() => { void saveActiveFile(); }}
                    />
                  </Suspense>
                </div>
                {activeFile.language === 'markdown' && markdownPreviewVisible && <MarkdownPreviewPane content={activeFile.content} />}
              </div>
            ) : showWelcome ? (
              <WelcomePage openFile={handleOpenFile} openFolder={handleOpenFolder} newFile={newUntitled} recent={recent} reopenRecent={reopenRecent} setStatus={setStatus} />
            ) : (
              <div className="forge-no-editor">
                <FileSearch size={34} />
                <p>No editor open</p>
                <button className="forge-button-subtle" onClick={() => setWelcomeClosed(false)}>Show Welcome</button>
              </div>
            )}
          </div>
          {bottomPanelVisible && (
            <BottomPanel
              tab={bottomPanelTab}
              setTab={setBottomPanelTab}
              outputs={outputs}
              clearOutputs={() => setOutputs([])}
              runLocalSynthesis={runLocalSynthesis}
              onClose={() => setBottomPanelVisible(false)}
            />
          )}
        </section>
      </main>
      {secondaryVisible && (
        <SecondarySidebar
          tab={secondaryTab}
          setTab={setSecondaryTab}
          chatInput={chatInput}
          setChatInput={setChatInput}
          chatMessages={chatMessages}
          askAgent={askAgent}
          outputs={outputs}
          runLocalSynthesis={runLocalSynthesis}
          clearOutputs={() => setOutputs([])}
          host={host}
          activeFile={activeFile}
          onResizeStart={beginSecondaryResize}
          onClose={() => setSecondaryVisible(false)}
        />
      )}
      {commandPaletteOpen && (
        <CommandPalette
          query={commandQuery}
          setQuery={setCommandQuery}
          files={files}
          activeFile={activeFile}
          commands={[
            { label: 'File: New File', detail: 'Create an untitled Markdown file', run: newUntitled },
            { label: 'File: Open File...', detail: 'Open one or more local files', run: () => { void handleOpenFile(); } },
            { label: 'File: Open Folder...', detail: 'Open a local folder with browser permission', run: () => { void handleOpenFolder(); } },
            ...recent.map((item) => ({ label: `File: Open Recent — ${item.name}`, detail: item.path, run: () => reopenRecent(item) })),
            { label: 'File: Save All', detail: `${dirtyFiles.length} dirty file${dirtyFiles.length === 1 ? '' : 's'}`, run: () => { void saveAllDirty(); }, disabled: dirtyFiles.length === 0 },
            { label: 'File: Close All Editors', detail: `${openEditors.length} open editor${openEditors.length === 1 ? '' : 's'}`, run: closeAllEditors, disabled: openEditors.length === 0 },
            { label: 'Search: Find in Files', detail: 'Open the VS Code-style search side bar', run: () => { setActivity('search'); setPrimaryVisible(true); } },
            { label: 'Help: Show Welcome', detail: 'Open the workbench welcome page', run: () => { setActiveFileId(null); setWelcomeClosed(false); } },
            { label: 'View: Toggle Primary Side Bar', detail: primaryVisible ? 'Hide Explorer side bar' : 'Show Explorer side bar', run: () => setPrimaryVisible((value) => !value) },
            { label: 'View: Toggle Chat Panel', detail: secondaryVisible ? 'Hide right AI side bar' : 'Show right AI side bar', run: () => setSecondaryVisible((value) => !value) },
            { label: 'View: Toggle Bottom Panel', detail: bottomPanelVisible ? 'Hide Problems/Output/Terminal panel' : 'Show Problems/Output/Terminal panel', run: () => setBottomPanelVisible((value) => !value) },
            { label: 'View: Toggle Markdown Preview', detail: activeFile?.language === 'markdown' ? 'Show or hide Markdown preview split' : 'Available for Markdown files', run: () => setMarkdownPreviewVisible((value) => !value), disabled: activeFile?.language !== 'markdown' },
            { label: 'Forge: Create Local Draft', detail: 'Deterministic local synthesis from the active file', run: runLocalSynthesis },
          ]}
          openWorkbenchFile={openWorkbenchFile}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      <StatusBar status={status} file={activeFile ?? welcomeFile} cursor={cursor} fileCount={files.length} dirtyCount={dirtyFiles.length} />
    </div>
  );
}

function ActivityBar({ active, setActive }: { active: ActivityView; setActive: (view: ActivityView) => void }) {
  return (
    <aside className="forge-activity-bar" aria-label="Activity Bar">
      <ActivityButton icon={<File size={25} />} label="Explorer" active={active === 'explorer'} onClick={() => setActive('explorer')} />
      <ActivityButton icon={<Search size={25} />} label="Search" active={active === 'search'} onClick={() => setActive('search')} />
      <ActivityButton icon={<GitBranch size={25} />} label="Source Control" active={active === 'source-control'} onClick={() => setActive('source-control')} />
      <ActivityButton icon={<Bug size={25} />} label="Run and Debug" active={active === 'run'} onClick={() => setActive('run')} />
      <ActivityButton icon={<Blocks size={25} />} label="Extensions" active={active === 'extensions'} onClick={() => setActive('extensions')} />
      <div className="forge-activity-spacer" />
      <ActivityButton icon={<UserCircle size={23} />} label="Accounts" active={false} onClick={() => undefined} />
      <ActivityButton icon={<Settings size={23} />} label="Manage" active={false} onClick={() => undefined} />
    </aside>
  );
}

function ActivityButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={`forge-activity-button ${active ? 'active' : ''}`} title={label} aria-label={label} onClick={onClick}>{icon}</button>;
}

function PrimarySidebar(props: {
  activity: ActivityView;
  folder: WorkbenchFolder | null;
  files: WorkbenchFile[];
  openEditors: WorkbenchFile[];
  activeFileId: string | null;
  query: string;
  setQuery: (value: string) => void;
  openFile: () => void;
  openFolder: () => void;
  openWorkbenchFile: (file: WorkbenchFile, lineNumber?: number) => void;
  newFile: () => void;
  recent: RecentEntry[];
  reopenRecent: (entry: RecentEntry) => void;
  setStatus: (status: string) => void;
  hasFsAccess: boolean;
}) {
  if (props.activity === 'search') return <SearchPane files={props.files} query={props.query} setQuery={props.setQuery} openWorkbenchFile={props.openWorkbenchFile} activeFileId={props.activeFileId} />;
  if (props.activity === 'source-control') return <PlaceholderPane title="SOURCE CONTROL" body="No source control provider registered. Git belongs here, not as a fake demo." />;
  if (props.activity === 'run') return <PlaceholderPane title="RUN AND DEBUG" body="Run configurations, terminals, and recipe execution will plug into this surface later." />;
  if (props.activity === 'extensions') return <ExtensionsPane />;
  return <ExplorerPane {...props} />;
}

function ExplorerPane(props: Omit<Parameters<typeof PrimarySidebar>[0], 'activity'>) {
  const noFolder = !props.folder;
  const tree = useMemo(() => buildFileTree(props.files, props.folder?.name), [props.files, props.folder?.name]);
  return (
    <aside className="forge-sidebar">
      <div className="forge-sidebar-title">EXPLORER</div>
      <div className="forge-sidebar-scroll">
        {noFolder ? (
          <>
            <p style={{ fontWeight: 600, margin: '10px 0' }}>NO FOLDER OPENED</p>
            <p className="forge-muted">You have not yet opened a folder.</p>
            <button className="forge-button-blue" onClick={props.openFolder}>Open Folder</button>
            <button className="forge-button-blue" onClick={props.openFile}>Open File</button>
            <button className="forge-button-blue" onClick={() => props.recent[0] ? props.reopenRecent(props.recent[0]) : props.setStatus('No recent local workspace yet.')}>Open Recent</button>
            <p className="forge-muted">You can open a remote repository or pull request without cloning.</p>
            <button className="forge-button-subtle full" onClick={() => props.setStatus('Open Remote Repository is parked until the base editor shell is approved.')}>Open Remote Repository</button>
            <p className="forge-muted">To connect to a machine that has Remote Tunnel Access enabled, install the tunnel extension later.</p>
            <button className="forge-button-subtle full" onClick={() => props.setStatus('Connect to Tunnel is parked for the agent/pod integration sprint.')}>Connect to Tunnel...</button>
            <p className="forge-muted">{props.hasFsAccess ? 'Local files use browser-native File System Access API.' : 'Browser fallback may show a file chooser label.'}</p>
          </>
        ) : (
          <>
            <div className="forge-sidebar-actions">
              <button className="forge-button-subtle" onClick={props.openFile}><FilePlus2 size={14} />Open File</button>
              <button className="forge-button-subtle" onClick={props.openFolder}><FolderOpen size={14} />Open Folder</button>
            </div>
            <input className="forge-input" value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="Search files" />
            <div className="forge-section-title"><ChevronDown size={12} /> Open Editors</div>
            {props.openEditors.length === 0 ? <p className="forge-muted">No open editors</p> : props.openEditors.map((file) => (
              <FileRow key={file.id} file={file} active={file.id === props.activeFileId} onOpen={() => props.openWorkbenchFile(file)} />
            ))}
            <div className="forge-section-title"><ChevronDown size={12} /> {props.folder?.name ?? 'Workspace'}</div>
            {tree.length === 0 ? <p className="forge-muted">No readable text files found.</p> : renderTreeNodes(tree, props.activeFileId, props.openWorkbenchFile)}
          </>
        )}
        <div className="forge-section-title">Recent</div>
        {props.recent.length === 0 ? <p className="forge-muted">No recent folders yet.</p> : props.recent.map((item) => <button key={`${item.path}-${item.at}`} className="forge-tree-row" onClick={() => props.reopenRecent(item)}><Folder size={14} /><span className="forge-row-name">{item.name}</span></button>)}
      </div>
    </aside>
  );
}

function FileRow({ file, active, onOpen, basePath, depth = 0, label }: { file: WorkbenchFile; active: boolean; onOpen: () => void; basePath?: string; depth?: number; label?: string }) {
  const displayPath = basePath && file.path.startsWith(`${basePath}/`) ? file.path.slice(basePath.length + 1) : file.path;
  const displayDepth = depth || Math.max(0, displayPath.split('/').length - 1);
  return (
    <button className={`forge-file-row ${active ? 'active' : ''}`} style={{ '--forge-depth': displayDepth } as CSSProperties} onClick={onOpen} title={file.path}>
      <FileCode2 size={14} />
      <span className="forge-row-name">{label ?? displayPath}</span>
      {file.dirty && <span className="forge-row-meta">●</span>}
    </button>
  );
}

type TreeNode = { name: string; path: string; children: TreeNode[]; file?: WorkbenchFile };

function buildFileTree(files: WorkbenchFile[], basePath?: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  const ensureDir = (path: string, name: string, parent: TreeNode[] = roots): TreeNode => {
    const existing = dirs.get(path);
    if (existing) return existing;
    const node: TreeNode = { name, path, children: [] };
    dirs.set(path, node);
    parent.push(node);
    return node;
  };
  files.forEach((file) => {
    const relative = basePath && file.path.startsWith(`${basePath}/`) ? file.path.slice(basePath.length + 1) : file.path;
    const parts = relative.split('/').filter(Boolean);
    let parent = roots;
    let cursor = '';
    parts.slice(0, -1).forEach((part) => {
      cursor = cursor ? `${cursor}/${part}` : part;
      const dir = ensureDir(cursor, part, parent);
      parent = dir.children;
    });
    parent.push({ name: parts.at(-1) ?? file.name, path: relative, file, children: [] });
  });
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => nodes
    .sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name))
    .map((node) => ({ ...node, children: sortNodes(node.children) }));
  return sortNodes(roots);
}

function renderTreeNodes(nodes: TreeNode[], activeFileId: string | null, openWorkbenchFile: (file: WorkbenchFile) => void, depth = 0): ReactNode {
  return nodes.map((node) => {
    if (node.file) {
      return <FileRow key={node.file.id} file={node.file} active={node.file.id === activeFileId} onOpen={() => openWorkbenchFile(node.file as WorkbenchFile)} depth={depth} label={node.name} />;
    }
    return (
      <div key={node.path}>
        <div className="forge-folder-row" style={{ '--forge-depth': depth } as CSSProperties}>
          <ChevronDown size={12} />
          <FolderOpen size={14} />
          <span className="forge-row-name">{node.name}</span>
        </div>
        {renderTreeNodes(node.children, activeFileId, openWorkbenchFile, depth + 1)}
      </div>
    );
  });
}

function BreadcrumbBar({ file, folder, showWelcome }: { file: WorkbenchFile | null; folder: WorkbenchFolder | null; showWelcome: boolean }) {
  const parts = showWelcome ? ['Welcome'] : (file?.path.split('/').filter(Boolean) ?? []);
  const normalized = folder && parts[0] === folder.name ? parts.slice(1) : parts;
  return (
    <div className="forge-breadcrumb">
      {normalized.length === 0 ? <span>Workspace</span> : normalized.map((part, index) => (
        <span key={`${part}-${index}`} className="forge-breadcrumb-part">
          {index > 0 && <span className="forge-breadcrumb-sep">›</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

function EditorTabs(props: {
  openEditors: WorkbenchFile[];
  activeFileId: string | null;
  showWelcome: boolean;
  setActiveFileId: (id: string | null) => void;
  closeEditor: (id: string) => void;
  saveFile: (id: string) => void;
  closeWelcome: () => void;
  secondaryVisible: boolean;
  toggleSecondary: () => void;
  canPreview: boolean;
  previewVisible: boolean;
  togglePreview: () => void;
}) {
  return (
    <div className="forge-tabs">
      {props.showWelcome && (
        <button className="forge-tab active">
          <FileSearch size={15} />
          <span className="forge-tab-name">Welcome</span>
          <span className="forge-tab-close" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); props.closeWelcome(); }}><X size={13} /></span>
        </button>
      )}
      {props.openEditors.map((file) => (
        <button key={file.id} className={`forge-tab ${file.id === props.activeFileId ? 'active' : ''}`} onClick={() => props.setActiveFileId(file.id)} title={file.path}>
          <FileCode2 size={15} />
          <span className="forge-tab-name">{file.dirty && <span className="forge-dirty-dot">●</span>}{file.name}</span>
          {file.dirty && <span className="forge-tab-save" role="button" tabIndex={0} title="Save" onClick={(event) => { event.stopPropagation(); props.saveFile(file.id); }}>Save</span>}
          <span className="forge-tab-close" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); props.closeEditor(file.id); }}><X size={13} /></span>
        </button>
      ))}
      <div style={{ flex: 1 }} />
      {props.canPreview && <button className={`forge-editor-action ${props.previewVisible ? 'active' : ''}`} title="Toggle Markdown Preview" onClick={props.togglePreview}><Eye size={16} /></button>}
      <button className={`forge-editor-action ${props.secondaryVisible ? 'active' : ''}`} title="Toggle Chat" onClick={props.toggleSecondary}><PanelRight size={16} /></button>
    </div>
  );
}

function WelcomePage({ openFile, openFolder, newFile, recent, reopenRecent, setStatus }: { openFile: () => void; openFolder: () => void; newFile: () => void; recent: RecentEntry[]; reopenRecent: (entry: RecentEntry) => void; setStatus: (status: string) => void }) {
  return (
    <div className="forge-welcome">
      <div className="forge-welcome-grid">
        <section>
          <h1>Tytus Forge</h1>
          <div className="forge-welcome-subtitle">Forge anything into work</div>
          <h2>Start</h2>
          <button className="forge-start-link" onClick={newFile}><FilePlus2 size={18} />New File...</button>
          <button className="forge-start-link" onClick={openFile}><File size={18} />Open File...</button>
          <button className="forge-start-link" onClick={openFolder}><FolderOpen size={18} />Open Folder...</button>
          <button className="forge-start-link" onClick={() => setStatus('Open Repository is a parked extension surface for now.')}><GitBranch size={18} />Open Repository...</button>
          <button className="forge-start-link" onClick={() => setStatus('Open Tunnel is a parked extension surface for now.')}><Play size={18} />Open Tunnel...</button>
          <h2>Recent</h2>
          {recent.length === 0 ? <p className="forge-muted">No recent folders, open a folder to start.</p> : recent.map((item) => <button key={`${item.path}-${item.at}`} className="forge-start-link" onClick={() => reopenRecent(item)}>{item.name}<span className="forge-muted">~</span></button>)}
        </section>
        <section>
          <h2>Walkthroughs</h2>
          <div className="forge-walkthrough-card"><strong>Get Started with Tytus Forge</strong><span className="forge-muted">Open local files, edit with Monaco, then wire Tytus agents and Cortex next.</span></div>
          <div className="forge-walkthrough-card"><strong>Browse & Edit Local Workspaces</strong><span className="forge-muted">Uses browser-native File System Access API on supported Chromium builds.</span></div>
          <div className="forge-walkthrough-card"><strong>Learn the Fundamentals</strong><span className="forge-muted">Explorer, tabs, editor, status bar, chat surface.</span></div>
        </section>
      </div>
      <label className="forge-welcome-checkbox"><input type="checkbox" defaultChecked /> Show welcome page on startup</label>
    </div>
  );
}

function SearchPane({ files, query, setQuery, openWorkbenchFile, activeFileId }: { files: WorkbenchFile[]; query: string; setQuery: (value: string) => void; openWorkbenchFile: (file: WorkbenchFile, lineNumber?: number) => void; activeFileId: string | null }) {
  const results = useMemo(() => buildSearchResults(files, query), [files, query]);
  const grouped = useMemo(() => {
    const byFile = new Map<string, SearchResult[]>();
    results.forEach((result) => byFile.set(result.file.id, [...(byFile.get(result.file.id) ?? []), result]));
    return Array.from(byFile.values()).slice(0, 50);
  }, [results]);
  return (
    <aside className="forge-sidebar">
      <div className="forge-sidebar-title">SEARCH</div>
      <div className="forge-sidebar-scroll">
        <input className="forge-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and text" autoFocus />
        <div className="forge-section-title"><FileSearch size={12} /> Results</div>
        {!query.trim() ? <p className="forge-muted">Type to search filenames and text in the opened workspace.</p> : grouped.length === 0 ? <p className="forge-muted">No matches.</p> : grouped.map((group) => {
          const file = group[0].file;
          return (
            <div key={file.id} className="forge-search-group">
              <FileRow file={file} active={file.id === activeFileId} onOpen={() => openWorkbenchFile(file)} />
              {group.slice(0, 5).map((result) => (
                <button key={`${file.id}-${result.lineNumber}-${result.line}`} className="forge-search-hit" onClick={() => openWorkbenchFile(file, result.lineNumber)} title={result.line}>
                  <span className="forge-search-line">{result.lineNumber}</span>
                  <span>{result.line}</span>
                </button>
              ))}
              {group.length > 5 && <div className="forge-search-more">+{group.length - 5} more matches</div>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function buildSearchResults(files: WorkbenchFile[], query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  files.forEach((file) => {
    if (file.path.toLowerCase().includes(needle)) {
      results.push({ file, lineNumber: 1, line: file.path });
    }
    file.content.split('\n').some((line, index) => {
      if (!line.toLowerCase().includes(needle)) return false;
      results.push({ file, lineNumber: index + 1, line: line.trim() || '(blank line)' });
      return results.length >= 200;
    });
  });
  return results.slice(0, 200);
}

function CommandPalette(props: {
  query: string;
  setQuery: (query: string) => void;
  files: WorkbenchFile[];
  activeFile: WorkbenchFile | null;
  commands: PaletteItem[];
  openWorkbenchFile: (file: WorkbenchFile, lineNumber?: number) => void;
  onClose: () => void;
}) {
  const needle = props.query.trim().toLowerCase();
  const fileCommands: PaletteItem[] = props.files.slice(0, 80).map((file) => ({
    label: file.path,
    detail: `Open ${labelForLanguage(file.language)} file`,
    run: () => props.openWorkbenchFile(file),
  }));
  const items: PaletteItem[] = [...props.commands, ...fileCommands].filter((item) => !needle || item.label.toLowerCase().includes(needle) || item.detail.toLowerCase().includes(needle)).slice(0, 12);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="forge-command-overlay" role="dialog" aria-label="Command Palette">
      <div className="forge-command-palette">
        <input
          className="forge-command-input"
          autoFocus
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          placeholder="Type a command or file name..."
          onKeyDown={(event) => {
            if (event.key === 'Enter' && items[0] && !items[0].disabled) {
              items[0].run();
              props.onClose();
            }
          }}
        />
        <div className="forge-command-list">
          {items.map((item) => (
            <button
              key={`${item.label}-${item.detail}`}
              disabled={item.disabled}
              className="forge-command-item"
              onClick={() => {
                item.run();
                props.onClose();
              }}
            >
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


function MarkdownPreviewPane({ content }: { content: string }) {
  const html = useMemo(() => markdownToHtml(content), [content]);
  return (
    <aside className="forge-markdown-preview">
      <div className="forge-preview-title"><Eye size={13} /> Preview</div>
      <div className="forge-preview-body" dangerouslySetInnerHTML={{ __html: html }} />
    </aside>
  );
}

function BottomPanel(props: {
  tab: BottomPanelTab;
  setTab: (tab: BottomPanelTab) => void;
  outputs: OutputArtifact[];
  clearOutputs: () => void;
  runLocalSynthesis: () => void;
  onClose: () => void;
}) {
  return (
    <section className="forge-bottom-panel" aria-label="Panel">
      <div className="forge-bottom-tabs">
        <button className={props.tab === 'problems' ? 'active' : ''} onClick={() => props.setTab('problems')}>PROBLEMS</button>
        <button className={props.tab === 'output' ? 'active' : ''} onClick={() => props.setTab('output')}>OUTPUT</button>
        <button className={props.tab === 'terminal' ? 'active' : ''} onClick={() => props.setTab('terminal')}>TERMINAL</button>
        <span />
        <button title="Close Panel" onClick={props.onClose}><X size={14} /></button>
      </div>
      <div className="forge-bottom-body">
        {props.tab === 'problems' && <p className="forge-muted">No problems detected in open files. Diagnostics wire in after the base shell is approved.</p>}
        {props.tab === 'terminal' && (
          <div>
            <p className="forge-muted">Terminal is parked. Native command execution belongs to the pod/daemon integration sprint.</p>
            <pre className="forge-terminal-placeholder">$ tytus forge --local-first</pre>
          </div>
        )}
        {props.tab === 'output' && (
          <OutputsPane outputs={props.outputs} clearOutputs={props.clearOutputs} runLocalSynthesis={props.runLocalSynthesis} compact />
        )}
      </div>
    </section>
  );
}

function SecondarySidebar(props: {
  tab: SecondaryTab;
  setTab: (tab: SecondaryTab) => void;
  chatInput: string;
  setChatInput: (value: string) => void;
  chatMessages: ChatMessage[];
  askAgent: () => void;
  outputs: OutputArtifact[];
  runLocalSynthesis: () => void;
  clearOutputs: () => void;
  host: HostClient;
  activeFile: WorkbenchFile | null;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
}) {
  return (
    <aside className="forge-secondary">
      <div className="forge-secondary-resizer" onPointerDown={props.onResizeStart} title="Resize Chat" />
      <div className="forge-secondary-tabs">
        <div className="forge-secondary-tab-group">
          <button className={`forge-secondary-tab ${props.tab === 'chat' ? 'active' : ''}`} onClick={() => props.setTab('chat')}>CHAT</button>
          <button className={`forge-secondary-tab ${props.tab === 'outputs' ? 'active' : ''}`} onClick={() => props.setTab('outputs')}>OUTPUTS</button>
        </div>
        <div className="forge-secondary-actions">
          <button title="New Chat"><Plus size={15} /></button>
          <button title="More Actions"><MoreHorizontal size={16} /></button>
          <button title="Close Chat" onClick={props.onClose}><X size={15} /></button>
        </div>
      </div>
      {props.tab === 'chat' ? <ChatPane {...props} /> : <OutputsPane outputs={props.outputs} clearOutputs={props.clearOutputs} runLocalSynthesis={props.runLocalSynthesis} />}
    </aside>
  );
}

function ChatPane(props: { chatInput: string; setChatInput: (value: string) => void; chatMessages: ChatMessage[]; askAgent: () => void; activeFile: WorkbenchFile | null }) {
  return (
    <div className="forge-chat-wrap">
      <div className="forge-chat-transcript">
        {props.chatMessages.length === 0 ? (
          <div className="forge-chat-empty">
            <div>
              <MessageSquareText size={48} />
              <h3>Build with Agent</h3>
              <p>Ask about open files, request a plan, or draft an artifact.</p>
              <p className="forge-chat-empty-link">Local deterministic mode until pods/AIL are wired.</p>
            </div>
          </div>
        ) : props.chatMessages.map((msg) => (
          <div key={msg.id} className={`forge-chat-message ${msg.role}`}>
            <strong>{msg.role === 'user' ? 'You' : 'Forge'}</strong>
            <br />
            {msg.body}
          </div>
        ))}
      </div>
      <div className="forge-chat-composer">
        <div className="forge-chat-tip">
          <span>Context</span>
          <strong>{props.activeFile ? props.activeFile.name : 'No active file'}</strong>
          <em>pod/AIL wiring pending</em>
        </div>
        <div className="forge-chat-box">
          <div className="forge-chat-attachments">
            <button title="Add context"><Plus size={15} /></button>
            <span className="forge-chat-chip"><Paperclip size={13} /> {props.activeFile?.name ?? 'Open editors'}</span>
          </div>
          <textarea
            className="forge-chat-textarea"
            value={props.chatInput}
            onChange={(event) => props.setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                props.askAgent();
              }
            }}
            placeholder="Ask Forge about the open file or describe what to build..."
            rows={3}
          />
          <div className="forge-chat-toolbar">
            <button className="forge-chat-mode">Auto <ChevronDown size={12} /></button>
            <button className="forge-chat-mode">Plan</button>
            <span />
            <button className="forge-chat-send" onClick={props.askAgent} title="Send"><Send size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputsPane({ outputs, clearOutputs, runLocalSynthesis, compact = false }: { outputs: OutputArtifact[]; clearOutputs: () => void; runLocalSynthesis: () => void; compact?: boolean }) {
  return (
    <div className={`forge-panel-list ${compact ? 'compact' : ''}`}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className="forge-button-subtle" onClick={runLocalSynthesis}><Bot size={14} />Local draft</button>
        <button className="forge-button-subtle" onClick={clearOutputs}>Clear</button>
      </div>
      {outputs.length === 0 ? <p className="forge-muted">No outputs yet. Agent/pod execution wires in after the VS Code base is approved.</p> : outputs.map((output) => <div key={output.id} className="forge-output-card"><strong>{output.title}</strong><br />{output.body}</div>)}
    </div>
  );
}

function ExtensionsPane() {
  const items = [
    { name: 'Agents', detail: 'chat, planning, repo edits' },
    { name: 'Pods', detail: 'allocated pod tools + local gateway' },
    { name: 'local AIL', detail: 'local/private model routing' },
    { name: 'Swarm', detail: 'parallel specialist workers' },
    { name: 'Remotion', detail: 'video render recipes' },
    { name: 'Blender', detail: '3D scene generation' },
    { name: 'Media tools', detail: 'image/video/audio source cards' },
    { name: 'Artifact recipes', detail: 'briefing, quiz, plan, report' },
  ];
  return (
    <aside className="forge-sidebar">
      <div className="forge-sidebar-title">EXTENSIONS</div>
      <div className="forge-sidebar-scroll">
        <div className="forge-extension-card">
          <strong>TYTUS EXTENSIONS</strong>
          <p className="forge-muted">Parked intentionally. Base editor shell first; extensions wire in after UAT.</p>
        </div>
        {items.map((item) => (
          <div key={item.name} className="forge-extension-row">
            <Blocks size={16} />
            <div>
              <strong>{item.name}</strong>
              <span>{item.detail}</span>
            </div>
            <em>coming soon</em>
          </div>
        ))}
      </div>
    </aside>
  );
}

function PlaceholderPane({ title, body }: { title: string; body: string }) {
  return (
    <aside className="forge-sidebar">
      <div className="forge-sidebar-title">{title}</div>
      <div className="forge-empty-pane">{body}</div>
    </aside>
  );
}

function StatusBar({ status, file, cursor, fileCount, dirtyCount }: { status: string; file: WorkbenchFile; cursor: CursorPosition; fileCount: number; dirtyCount: number }) {
  return (
    <footer className="forge-statusbar">
      <span>$(branch) main</span>
      <span>{fileCount} files</span>
      {dirtyCount > 0 && <span>{dirtyCount} unsaved</span>}
      <span className="forge-status-spacer" />
      <span>{status}</span>
      <span>Ln {cursor.lineNumber}, Col {cursor.column}</span>
      <span>Spaces: 2</span>
      <span>UTF-8</span>
      <span>LF</span>
      <span>{labelForLanguage(file.language)}</span>
    </footer>
  );
}

function confirmDiscardDirty(dirtyFiles: WorkbenchFile[], action: string): boolean {
  if (dirtyFiles.length === 0) return true;
  return window.confirm(`${dirtyFiles.length} file${dirtyFiles.length === 1 ? '' : 's'} have unsaved changes. Continue to ${action}?`);
}

function mergeFiles(current: WorkbenchFile[], incoming: WorkbenchFile[]): WorkbenchFile[] {
  const map = new Map(current.map((file) => [file.id, file]));
  incoming.forEach((file) => map.set(file.id, file));
  return Array.from(map.values());
}

function readRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function readLayoutPrefs(): LayoutPrefs {
  const fallback: LayoutPrefs = {
    primaryVisible: true,
    primaryWidth: 300,
    secondaryVisible: true,
    secondaryWidth: 520,
    markdownPreviewVisible: true,
  };
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      primaryVisible: typeof parsed.primaryVisible === 'boolean' ? parsed.primaryVisible : fallback.primaryVisible,
      primaryWidth: typeof parsed.primaryWidth === 'number' ? Math.max(240, Math.min(460, parsed.primaryWidth)) : fallback.primaryWidth,
      secondaryVisible: typeof parsed.secondaryVisible === 'boolean' ? parsed.secondaryVisible : fallback.secondaryVisible,
      secondaryWidth: typeof parsed.secondaryWidth === 'number' ? Math.max(380, Math.min(760, parsed.secondaryWidth)) : fallback.secondaryWidth,
      markdownPreviewVisible: typeof parsed.markdownPreviewVisible === 'boolean' ? parsed.markdownPreviewVisible : fallback.markdownPreviewVisible,
    };
  } catch {
    return fallback;
  }
}
