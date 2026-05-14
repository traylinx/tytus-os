// ============================================================
// Help app — user-manual browser + daemon diagnostics
// ============================================================
//
// Primary surface: a docs browser over the bundled user manual
// (../docs/user-manual/*.md). The registry at lib/docs/registry.ts
// uses Vite import.meta.glob to bundle every markdown file at build
// time — drop a new .md into the docs folder and it shows up here.
//
// Secondary surface: the existing daemon diagnostics (Doctor, Health
// test, Channels catalog, Logs, About). These live below the user
// manual in the sidebar — still accessible, no longer the default.
//
// Owned capabilities (manifest §5):
//   A3.1b — Daemon doctor (POST /api/doctor + SSE)
//   A3.2  — Health test  (POST /api/test   + SSE)
//   A3.3  — Daemon log tail (GET /api/logs?name=daemon|startup&offset=N)
//   About — version + daemon PID + uptime + keychain health
//
// Routing: WindowArgs.help.tab accepts either a diagnostic id
// ('doctor', 'test', 'logs', 'about', 'channels-catalog') or a docs
// slug prefixed with `docs:` (e.g. `docs:keyboard-shortcuts`). Hash
// deep-links: #/help/{tab}.

import {
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Stethoscope,
  Activity,
  ScrollText,
  Info,
  Play,
  Loader2,
  Pause,
  AlertTriangle,
  ExternalLink,
  Search,
  MessageCircle,
  // Icons resolved dynamically by the docs registry — keep this
  // import alive so tree-shaking can't drop them.
  Rocket,
  AppWindow,
  Monitor,
  LayoutPanelTop,
  LayoutGrid,
  Keyboard,
  Folder,
  Settings as SettingsIcon,
  Wrench,
  ClipboardList,
  FileText,
  Network,
  UsersRound,
  FolderSync,
  Workflow,
} from 'lucide-react';
import LogPane from '@/components/LogPane';
import { useDaemonClient } from '@/hooks/useDaemonClient';
import { useDaemonStateContext } from '@/hooks/useDaemonStateContext';
import { useCurrentWindowArgs } from '@/hooks/useCurrentWindow';
import { useJobStream } from '@/hooks/useJobStream';
import type { LogChunk } from '@/types/daemon';
import { markdownToHtml } from '@/lib/markdown';
import {
  BUNDLED_DOCS_VINTAGE_HASH,
  DOCS,
  findDoc,
  readingTimeMin,
  resolveCitation,
  type DocEntry,
} from '@/lib/docs/registry';
import {
  answerCortexDocs,
  getCortexDocsSources,
  type CortexDocCitation,
} from '@/lib/docs/cortexClient';

type DiagnosticTabId = 'doctor' | 'test' | 'logs' | 'about' | 'channels-catalog';
type TabId = DiagnosticTabId | 'live-docs' | `docs:${string}`;

const DIAGNOSTIC_TABS: { id: DiagnosticTabId; label: string; icon: ReactNode }[] = [
  { id: 'doctor', label: 'Doctor', icon: <Stethoscope size={16} /> },
  { id: 'test', label: 'Health test', icon: <Activity size={16} /> },
  { id: 'channels-catalog', label: 'Channels catalog', icon: <ScrollText size={16} /> },
  { id: 'logs', label: 'Logs', icon: <ScrollText size={16} /> },
  { id: 'about', label: 'About', icon: <Info size={16} /> },
];

// Map a registry icon name string to its lucide-react component.
// Kept as a stable map so the registry can stay typed-string-only.
const DOC_ICON: Record<string, ReactNode> = {
  Rocket: <Rocket size={16} />,
  AppWindow: <AppWindow size={16} />,
  Monitor: <Monitor size={16} />,
  LayoutPanelTop: <LayoutPanelTop size={16} />,
  LayoutGrid: <LayoutGrid size={16} />,
  Keyboard: <Keyboard size={16} />,
  Folder: <Folder size={16} />,
  Settings: <SettingsIcon size={16} />,
  Wrench: <Wrench size={16} />,
  ClipboardList: <ClipboardList size={16} />,
  Info: <Info size={16} />,
  FileText: <FileText size={16} />,
  Network: <Network size={16} />,
  UsersRound: <UsersRound size={16} />,
  FolderSync: <FolderSync size={16} />,
  Workflow: <Workflow size={16} />,
};

const isDocTab = (id: TabId): id is `docs:${string}` => id.startsWith('docs:');

const slugFromTab = (id: TabId): string | null =>
  isDocTab(id) ? id.slice('docs:'.length) : null;

// Default tab: the first user-manual entry (getting-started under the
// recommended order). Falls back to 'doctor' if the registry is empty
// (impossible in practice, but keeps the type happy).
const DEFAULT_TAB: TabId = DOCS.length > 0 ? `docs:${DOCS[0].slug}` : 'doctor';

const Help: FC = () => {
  const [active, setActive] = useState<TabId>(DEFAULT_TAB);
  const [search, setSearch] = useState('');
  const args = useCurrentWindowArgs();
  const helpArgs = args?.help;

  useEffect(() => {
    if (!helpArgs?.tab) return;
    // Deliberate setState-in-effect: synchronising this app's selected
    // tab from a shell route delivered through WindowArgs.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setActive(helpArgs.tab);
  }, [helpArgs?.tab, args?.routeNonce]);

  const filteredDocs = useMemo<DocEntry[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return DOCS;
    return DOCS.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.body.toLowerCase().includes(q) ||
        d.slug.includes(q),
    );
  }, [search]);

  return (
    <div className="flex h-full" style={{ background: 'var(--bg-window)' }}>
      <div
        className="w-56 shrink-0 flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-titlebar)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        <div className="px-3 pt-3 pb-2">
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md"
            style={{
              background: 'var(--bg-input, rgba(255,255,255,0.04))',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Search size={13} className="text-[var(--text-secondary)] shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the manual…"
              className="rounded-input bg-transparent text-xs flex-1 outline-none text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pb-2">
          <SidebarGroup label="Live Cortex">
            <SidebarButton
              active={active === 'live-docs'}
              onClick={() => setActive('live-docs')}
              icon={<MessageCircle size={16} />}
              label="Ask Tytus Docs"
            />
          </SidebarGroup>

          <SidebarGroup label="User Manual">
            {filteredDocs.length === 0 ? (
              <div className="px-4 py-2 text-[11px] text-[var(--text-secondary)]">
                No matches.
              </div>
            ) : (
              filteredDocs.map((doc) => (
                <SidebarButton
                  key={doc.slug}
                  active={active === `docs:${doc.slug}`}
                  onClick={() => setActive(`docs:${doc.slug}`)}
                  icon={DOC_ICON[doc.icon] ?? DOC_ICON.FileText}
                  label={doc.title}
                />
              ))
            )}
          </SidebarGroup>

          <SidebarGroup label="Diagnostics">
            {DIAGNOSTIC_TABS.map((t) => (
              <SidebarButton
                key={t.id}
                active={active === t.id}
                onClick={() => setActive(t.id)}
                icon={t.icon}
                label={t.label}
              />
            ))}
          </SidebarGroup>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {active === 'live-docs' && <LiveDocsPanel onOpenDoc={(slug) => setActive(`docs:${slug}`)} />}
        {isDocTab(active) && <DocPanel slug={slugFromTab(active)!} />}
        {active === 'doctor' && (
          <RunPanel
            kind="doctor"
            autoRun={helpArgs?.tab === 'doctor' && helpArgs.autoRun}
            routeNonce={args?.routeNonce}
          />
        )}
        {active === 'test' && (
          <RunPanel
            kind="test"
            autoRun={helpArgs?.tab === 'test' && helpArgs.autoRun}
            routeNonce={args?.routeNonce}
          />
        )}
        {active === 'channels-catalog' && (
          <ChannelsCatalogPanel
            autoRun={
              helpArgs?.tab === 'channels-catalog' && helpArgs.autoRun
            }
            routeNonce={args?.routeNonce}
          />
        )}
        {active === 'logs' && <LogsPanel />}
        {active === 'about' && <AboutPanel />}
      </div>
    </div>
  );
};

// ============================================================
// Sidebar primitives
// ============================================================

const SidebarGroup: FC<{ label: string; children: ReactNode }> = ({
  label,
  children,
}) => (
  <div className="mt-2">
    <div
      className="px-4 py-2 text-[10px] uppercase tracking-wider font-semibold"
      style={{ color: 'var(--text-secondary)' }}
    >
      {label}
    </div>
    {children}
  </div>
);

const SidebarButton: FC<{
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 w-full px-4 py-2 text-sm transition-colors text-left"
    style={{
      background: active ? 'var(--bg-selected)' : 'transparent',
      color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
      borderLeft: active
        ? '3px solid var(--accent-primary)'
        : '3px solid transparent',
    }}
  >
    <span className="shrink-0">{icon}</span>
    <span className="truncate">{label}</span>
  </button>
);

// ============================================================
// DocPanel — bundled user-manual viewer
// ============================================================

const DocPanel: FC<{ slug: string }> = ({ slug }) => {
  const doc = findDoc(slug);
  const html = useMemo(() => (doc ? markdownToHtml(doc.body) : ''), [doc]);

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] p-6 text-center">
        <div>
          <div className="text-sm">Document not found</div>
          <div className="text-[11px] mt-1">
            <code className="font-mono">{slug}</code> is not a known doc slug.
          </div>
        </div>
      </div>
    );
  }

  const minutes = readingTimeMin(doc);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-[820px] mx-auto px-8 py-6">
        <div
          className="text-[10px] uppercase tracking-wider mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          {doc.section === 'troubleshooting' ? 'Troubleshooting' : 'User Manual'}
          {' · '}
          {minutes} min read
          {' · '}
          <code className="font-mono">{doc.slug}.md</code>
        </div>
        <article
          // markdownToHtml escapes raw HTML; the rest is internal,
          // bundled markdown content shipped from this repo's docs/
          // folder. No user input flows here.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
};

// ============================================================
// LiveDocsPanel — shared Cortex docs bridge
// ============================================================

const LiveDocsPanel: FC<{ onOpenDoc: (slug: string) => void }> = ({ onOpenDoc }) => {
  const client = useDaemonClient();
  const [query, setQuery] = useState('How do I install and use TytusOS?');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<CortexDocCitation[]>([]);
  const [corpusHash, setCorpusHash] = useState<string | null>(null);
  const [sourcesLabel, setSourcesLabel] = useState('checking live docs…');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    void getCortexDocsSources(client, ctrl.signal).then((res) => {
      if (!res.ok) {
        setSourcesLabel('live docs offline · bundled manual ready');
        return;
      }
      setCorpusHash(res.value.corpus_hash ?? null);
      const sources = res.value.sources?.length
        ? res.value.sources.join(', ')
        : 'Cortex docs';
      setSourcesLabel(`${sources} · ${res.value.api_version ?? 'docs bridge'}`);
    });
    return () => ctrl.abort();
  }, [client]);

  const ask = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    const res = await answerCortexDocs(client, {
      query: q,
      k: 6,
      min_score: 0.45,
      app: 'tytus-os',
      source: ['docs-hub', 'traylinx-public-references', 'traylinx-user-manuals'],
    });
    setLoading(false);
    if (!res.ok) {
      setAnswer('');
      setCitations([]);
      setError(`${res.error.message}. Using bundled docs fallback.`);
      return;
    }
    setAnswer(res.value.answer || 'Cortex returned citations but no prose answer yet.');
    setCitations(res.value.citations?.length ? res.value.citations : res.value.results ?? []);
    setCorpusHash(res.value.corpus_hash ?? corpusHash);
  }, [client, corpusHash, query]);

  const drift = Boolean(corpusHash && corpusHash !== BUNDLED_DOCS_VINTAGE_HASH);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-[880px] mx-auto px-8 py-6 space-y-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
            <MessageCircle size={13} />
            Shared Cortex documentation
          </div>
          <h1 className="text-2xl font-semibold mt-2 text-[var(--text-primary)]">
            Ask Tytus Docs
          </h1>
          <p className="text-sm mt-1 text-[var(--text-secondary)]">
            Live answers use the same Traylinx Cortex documentation database as the web chatbot.
            Bundled docs stay available offline.
          </p>
        </div>

        <div
          className="rounded-lg p-3 text-xs"
          style={{
            border: '1px solid var(--border-subtle)',
            background: drift ? 'rgba(245,158,11,0.10)' : 'var(--bg-card)',
            color: drift ? '#facc15' : 'var(--text-secondary)',
          }}
        >
          {sourcesLabel}
          {drift && ' · bundled docs differ from live Cortex; external citations preferred'}
        </div>

        <div
          className="rounded-xl p-3"
          style={{
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-card)',
          }}
        >
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            className="w-full resize-none bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            placeholder="Ask about installs, private pods, shared folders, OpenClaw, Hermes, JULI3TA…"
          />
          <div className="flex justify-between items-center pt-3">
            <span className="text-[11px] text-[var(--text-secondary)]">
              Routed through local Tytus bridge. No Cortex credentials in the browser.
            </span>
            <button
              onClick={() => void ask()}
              disabled={loading || !query.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50"
              style={{
                background: 'var(--accent-primary)',
                color: 'var(--accent-on-primary, #080808)',
              }}
            >
              {loading ? 'Asking…' : 'Ask'}
            </button>
          </div>
        </div>

        {error && (
          <div
            className="rounded-lg p-3 text-sm"
            style={{
              border: '1px solid rgba(245,158,11,0.35)',
              background: 'rgba(245,158,11,0.10)',
              color: '#facc15',
            }}
          >
            {error}
          </div>
        )}

        {answer && (
          <div
            className="rounded-xl p-4 whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]"
            style={{
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-card)',
            }}
          >
            {answer}
          </div>
        )}

        {citations.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
              Citations
            </div>
            {citations.map((c, idx) => {
              const resolved = resolveCitation(c.doc_id, c.anchor, corpusHash);
              const canOpenBundled = resolved.kind === 'bundled';
              return (
                <div
                  key={`${c.doc_id}-${idx}`}
                  className="rounded-lg p-3"
                  style={{
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-titlebar)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm text-[var(--text-primary)]">
                        {c.title}
                      </div>
                      <div className="text-xs mt-1 text-[var(--text-secondary)] line-clamp-2">
                        {c.snippet}
                      </div>
                    </div>
                    {canOpenBundled ? (
                      <button
                        className="shrink-0 px-2 py-1 rounded text-xs"
                        style={{
                          border: '1px solid var(--accent-primary)',
                          color: 'var(--accent-primary)',
                        }}
                        onClick={() => onOpenDoc(resolved.doc.slug)}
                      >
                        Open bundled
                      </button>
                    ) : c.url ? (
                      <a
                        className="shrink-0 px-2 py-1 rounded text-xs"
                        style={{
                          border: '1px solid var(--accent-primary)',
                          color: 'var(--accent-primary)',
                        }}
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open source
                      </a>
                    ) : null}
                  </div>
                  <div className="text-[10px] mt-2 text-[var(--text-secondary)]">
                    {c.source ?? 'cortex'} · {c.doc_id}
                    {canOpenBundled && !c.anchor && ' · section opens at top'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// RunPanel — shared by Doctor + Health test
// ============================================================

interface RunPanelProps {
  kind: 'doctor' | 'test';
  autoRun?: boolean;
  routeNonce?: string;
}

const RunPanel: FC<RunPanelProps> = ({ kind, autoRun, routeNonce }) => {
  const client = useDaemonClient();
  const [job, setJob] = useState<{ id: string; startedAt: number } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{
    finishedAt: number;
    exitCode: number | null;
  } | null>(null);

  const streamUrl = job ? client.jobStreamUrl(job.id) : null;
  const stream = useJobStream({ url: streamUrl });
  const done =
    stream.status === 'success' ||
    stream.status === 'failed' ||
    stream.status === 'lost';

  // Capture finishedAt + exitCode once when the stream resolves.
  const lastRunCapturedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job || !done) return;
    if (lastRunCapturedRef.current === job.id) return;
    lastRunCapturedRef.current = job.id;
    setLastRun({ finishedAt: Date.now(), exitCode: stream.exitCode });
  }, [job, done, stream.exitCode]);

  const onRun = useCallback(async () => {
    if (submitting || (job !== null && !done)) return;
    setSubmitting(true);
    setSubmitErr(null);
    const r = kind === 'doctor' ? await client.postDoctor() : await client.postTest();
    setSubmitting(false);
    if (!r.ok) {
      setSubmitErr(r.error.message);
      return;
    }
    setJob({ id: r.value.job_id, startedAt: Date.now() });
  }, [client, done, job, kind, submitting]);

  const consumedAutoRunRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoRun) return;
    const key = `${kind}:${routeNonce ?? 'no-nonce'}`;
    if (consumedAutoRunRef.current.has(key)) return;
    consumedAutoRunRef.current.add(key);
    void onRun();
  }, [autoRun, kind, onRun, routeNonce]);

  const title = kind === 'doctor' ? 'Doctor' : 'Health test';
  const description =
    kind === 'doctor'
      ? 'Runs `tytus doctor` for a comprehensive diagnostic: auth state, tunnel reachability, gateway probe, MCP wiring, and pod credentials.'
      : 'Runs `tytus test` — a minimal end-to-end check: auth → tunnel → gateway chat completion.';

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 py-4 flex items-start justify-between gap-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
            {description}
          </p>
          {lastRun && (
            <div className="text-[11px] mt-2">
              <span className="text-[var(--text-secondary)]">Last run: </span>
              <RelativeTime ts={lastRun.finishedAt} /> ·{' '}
              <span
                style={{
                  color: lastRun.exitCode === 0 ? 'var(--accent-success)' : 'var(--terminal-error)',
                }}
              >
                exit {lastRun.exitCode ?? '?'}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onRun}
          disabled={submitting || (job !== null && !done)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: 'var(--accent-primary)' }}
        >
          {submitting || (job !== null && !done) ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Run
        </button>
      </div>

      {submitErr && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: 'rgba(244,67,54,0.10)',
            border: '1px solid rgba(244,67,54,0.30)',
            color: 'var(--accent-error)',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't start {title.toLowerCase()}: {submitErr}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {!job && !submitErr && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{
                background: 'rgba(124,77,255,0.10)',
                border: '1px solid rgba(124,77,255,0.25)',
              }}
            >
              {kind === 'doctor' ? (
                <Stethoscope size={22} className="text-[var(--accent-primary)]" />
              ) : (
                <Activity size={22} className="text-[var(--accent-primary)]" />
              )}
            </div>
            <div className="text-sm">No {title.toLowerCase()} run yet.</div>
            <div className="text-[11px] mt-1 max-w-[320px]">
              Click <strong>Run</strong> to stream the output here. Each
              run is captured on the daemon side and tagged with an exit
              code.
            </div>
          </div>
        )}

        {job && (
          <div
            className="rounded-md overflow-hidden"
            style={{
              background: 'var(--terminal-bg)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              className="px-3 py-2 flex items-center justify-between text-[11px]"
              style={{
                background: 'rgba(255,255,255,0.02)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span className="text-[var(--text-secondary)]">
                {title} · job{' '}
                <span className="font-mono">{job.id.slice(0, 8)}</span> ·{' '}
                <span
                  style={{
                    color:
                      stream.status === 'success'
                        ? 'var(--accent-success)'
                        : stream.status === 'failed'
                          ? 'var(--terminal-error)'
                          : stream.status === 'lost'
                            ? 'var(--terminal-warning)'
                            : 'var(--text-secondary)',
                  }}
                >
                  {stream.status}
                  {stream.exitCode !== null && ` (exit ${stream.exitCode})`}
                </span>
              </span>
              {done && (
                <button
                  onClick={() => setJob(null)}
                  className="px-2 py-0.5 rounded-sm text-[10px] transition-colors"
                  style={{
                    background: 'var(--bg-hover, rgba(255,255,255,0.04))',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <LogPane
              lines={stream.lines}
              status={stream.status}
              exitCode={stream.exitCode}
              failMessage={stream.failMessage}
              emptyText="Connecting to job stream…"
              maxLines={500}
              maxHeight="calc(100vh - 320px)"
              className="rounded-none border-0"
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// ChannelsCatalogPanel — POST /api/channels/catalog
// ============================================================

interface ChannelsCatalogPanelProps {
  autoRun?: boolean;
  routeNonce?: string;
}

const ChannelsCatalogPanel: FC<ChannelsCatalogPanelProps> = ({
  autoRun,
  routeNonce,
}) => {
  const client = useDaemonClient();
  const [submitting, setSubmitting] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  const onRun = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setErr(null);
    setExitCode(null);
    setStdout('');
    setStderr('');
    setFinishedAt(null);
    const r = await client.postChannelsCatalog();
    setSubmitting(false);
    setFinishedAt(Date.now());
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    setExitCode(r.value.exit_code);
    setStdout(r.value.stdout);
    setStderr(r.value.stderr);
  }, [client, submitting]);

  const consumedAutoRunRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoRun) return;
    const key = `channels-catalog:${routeNonce ?? 'no-nonce'}`;
    if (consumedAutoRunRef.current.has(key)) return;
    consumedAutoRunRef.current.add(key);
    void onRun();
  }, [autoRun, onRun, routeNonce]);

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 py-4 flex items-start justify-between gap-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Channels catalog
          </h2>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
            Runs <code className="font-mono">tytus channels catalog</code> via
            the tray daemon and renders stdout/stderr inline.
          </p>
          {finishedAt && (
            <div className="text-[11px] mt-2">
              <span className="text-[var(--text-secondary)]">Last run: </span>
              <RelativeTime ts={finishedAt} /> ·{' '}
              <span
                style={{
                  color: exitCode === 0 ? 'var(--accent-success)' : 'var(--terminal-error)',
                }}
              >
                exit {exitCode ?? '?'}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onRun}
          disabled={submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: 'var(--accent-primary)' }}
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Run
        </button>
      </div>

      {err && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: 'rgba(244,67,54,0.10)',
            border: '1px solid rgba(244,67,54,0.30)',
            color: 'var(--accent-error)',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't run channels catalog: {err}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <pre
          className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap p-3 rounded-md"
          style={{
            background: 'var(--terminal-bg)',
            color: 'var(--terminal-text)',
            margin: 0,
            minHeight: 180,
            border: '1px solid var(--border-subtle)',
          }}
        >
          {stdout || (
            <span className="text-[var(--text-secondary)]">
              {submitting ? 'Running channels catalog…' : 'No catalog run yet.'}
            </span>
          )}
        </pre>

        {stderr && (
          <pre
            className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap p-3 rounded-md mt-3"
            style={{
              background: 'rgba(244,67,54,0.08)',
              color: 'var(--accent-error)',
              margin: 0,
              border: '1px solid rgba(244,67,54,0.25)',
            }}
          >
            {stderr}
          </pre>
        )}
      </div>
    </div>
  );
};

// ============================================================
// LogsPanel — daemon + startup log tail
// ============================================================

type LogName = 'daemon' | 'startup';
const LOG_POLL_MS = 2000;
const LOG_KEEP_BYTES = 64 * 1024; // last 64 KiB rendered

const LogsPanel: FC = () => {
  const client = useDaemonClient();
  const [name, setName] = useState<LogName>('daemon');
  const [paused, setPaused] = useState(false);
  const [content, setContent] = useState('');
  const [offset, setOffset] = useState(0);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

  // Reset on log switch.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setContent('');
    setOffset(0);
    setMissing(false);
    setErr(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [name]);

  // Poll loop.
  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const r = await client.getLogs(name, offset);
      if (cancelled) return;
      if (!r.ok) {
        setErr(r.error.message);
        timer = setTimeout(poll, LOG_POLL_MS);
        return;
      }
      setErr(null);
      const chunk: LogChunk = r.value;
      if (chunk.missing) {
        setMissing(true);
      } else {
        setMissing(false);
        if (chunk.chunk.length > 0) {
          setContent((prev) => {
            const merged = prev + chunk.chunk;
            // Cap retained text so very long sessions don't memory-leak.
            return merged.length > LOG_KEEP_BYTES * 2
              ? merged.slice(-LOG_KEEP_BYTES)
              : merged;
          });
        }
        setOffset(chunk.offset + chunk.chunk.length);
      }
      timer = setTimeout(poll, LOG_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, name, offset, paused]);

  // Auto-scroll only when the user is already pinned to the bottom.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [content]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    stickToBottomRef.current = atBottom;
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 py-4 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Logs
        </h2>
        <select
          value={name}
          onChange={(e) => setName(e.target.value as LogName)}
          className="text-xs rounded-md px-2 py-1 outline-none"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        >
          <option value="daemon">daemon</option>
          <option value="startup">startup</option>
        </select>
        <span className="flex-1" />
        <button
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{
            background: paused
              ? 'rgba(255,193,7,0.12)'
              : 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: paused
              ? '1px solid rgba(255,193,7,0.30)'
              : '1px solid var(--border-default)',
            color: paused ? 'var(--accent-warning)' : 'var(--text-primary)',
          }}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {missing && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: 'rgba(255,193,7,0.10)',
            border: '1px solid rgba(255,193,7,0.30)',
            color: 'var(--accent-warning)',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Log file <code className="font-mono">{name}</code> doesn't exist
            on this daemon. Start the daemon at least once to create it.
          </span>
        </div>
      )}

      {err && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: 'rgba(244,67,54,0.10)',
            border: '1px solid rgba(244,67,54,0.30)',
            color: 'var(--accent-error)',
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      <pre
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto custom-scrollbar font-mono text-[11px] leading-relaxed whitespace-pre-wrap p-4 m-0"
        style={{
          background: 'var(--terminal-bg)',
          color: 'var(--text-secondary)',
          margin: 16,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {content || (
          <span className="text-[var(--text-secondary)]">
            {paused ? 'Paused.' : 'Waiting for log output…'}
          </span>
        )}
      </pre>
    </div>
  );
};

// ============================================================
// AboutPanel
// ============================================================

const AboutPanel: FC = () => {
  const daemon = useDaemonStateContext();
  const state = daemon.state;
  const uptime = state ? formatUptime(state.uptime_secs) : '—';

  return (
    <div className="p-6 overflow-y-auto custom-scrollbar h-full">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        About
      </h2>

      <div className="flex flex-col items-center mt-4 mb-6 py-6 rounded-lg"
        style={{
          background: 'var(--bg-card, rgba(255,255,255,0.03))',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
          style={{
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-primary-active))',
          }}
        >
          <span className="text-2xl font-bold text-white">T</span>
        </div>
        <div className="text-base font-semibold text-[var(--text-primary)]">
          Tytus OS
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
          Web shell for your private AI pod
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <Row label="Daemon PID" value={state?.daemon_pid?.toString() ?? '—'} />
        <Row label="Daemon uptime" value={uptime} />
        <Row label="Tunnel" value={state?.tunnel_active ? 'active' : 'down'} />
        <Row
          label="Keychain"
          value={state?.keychain_healthy ? 'healthy' : 'unhealthy'}
        />
        <Row
          label="Last refresh error"
          value={state?.last_refresh_error ?? 'none'}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <a
          href="https://github.com/traylinx/tytus-cli"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          <ExternalLink size={11} /> tytus-cli on GitHub
        </a>
        <a
          href="https://github.com/traylinx/tytus-os"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{
            background: 'var(--bg-hover, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          <ExternalLink size={11} /> tytus-os on GitHub
        </a>
      </div>
    </div>
  );
};

const Row: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className="flex items-center justify-between py-1.5 px-3 rounded-md"
    style={{
      background: 'var(--bg-card, rgba(255,255,255,0.03))',
      border: '1px solid var(--border-subtle)',
    }}
  >
    <span className="text-[var(--text-secondary)]">{label}</span>
    <span className="font-mono text-[var(--text-primary)] truncate ml-3">
      {value}
    </span>
  </div>
);

// ============================================================
// Helpers
// ============================================================

const formatUptime = (secs: number): string => {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
};

const RelativeTime: FC<{ ts: number }> = ({ ts }) => {
  // Re-render every 10s so "5s ago" → "15s ago". `now` is held in
  // state so the renderer stays pure — react-hooks/purity rejects
  // calling Date.now() inline.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  return <span>{formatRel(now - ts)}</span>;
};

const formatRel = (deltaMs: number): string => {
  const s = Math.floor(deltaMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
};

export default Help;
