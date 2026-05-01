// ============================================================
// Files — Pod inbox + Downloads + Shared (Phase 5, manifest §7)
// ============================================================
//
// Layout (manifest §7.2):
//
//   ┌─ sidebar ────────┬─ tab strip ──────────────────────────┐
//   │ Pods             │ ▶ Inbox  ▶ Downloads  ▶ Shared       │
//   │ ● Pod 02 ◉       ├──────────────────────────────────────┤
//   │ ○ Pod 04         │  Inbox + Downloads are pod-scoped    │
//   │                  │  Shared is account-scoped — sidebar  │
//   │                  │  is greyed out while Shared active   │
//   └──────────────────┴──────────────────────────────────────┘
//
// Sidebar lists state.agents only. Included pods (AIL pods) don't
// have an inbox dir — manifest §7.2 confirms scope is per-agent.
//
// Inbox uses POST /api/pod/{id}/run-streamed action=ls-inbox →
// useJobStream subscribes to the SSE log; lines render verbatim
// in a monospace pane. Auto-fires on tab mount + on pod switch.
//
// Downloads CTA → POST /api/files/open-downloads?pod=NN; daemon
// opens ~/Tytus/Downloads/pod-NN/ in Finder.
//
// Shared (manifest §7.5) — account-scoped: lists all bindings
// from /api/shared-folders/list, lets the user bind a new Mac
// folder via system picker + bucket name, sync-now via
// refresh pod credentials via run-streamed action=refresh-all.
//
// Hash deep-link: #/pod/02/files focuses pod 02 on mount via a
// once-only ref.

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Folder,
  FileText,
  RefreshCw,
  Loader2,
  ExternalLink,
  Inbox,
  Download,
  Upload,
  Copy as CopyIcon,
  MoveRight,
  AlertTriangle,
  Box,
  Rocket,
  FolderSync,
  FolderOpen,
  HardDriveDownload,
  Home,
  ChevronRight,
  ArrowUp,
  Search,
  Plus,
  Link as LinkIcon,
  Check,
  X,
  Pencil,
  Trash2,
} from "lucide-react";
import { useOS, useNotifications } from "@/hooks/useOSStore";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import { useJobStream } from "@/hooks/useJobStream";
import { useCurrentWindowArgs } from "@/hooks/useCurrentWindow";
import { navigate } from "@/lib/router";
import {
  buildFileOpenWithMenu,
  inboxLineToFilename,
  isMissingInboxDiagnostic,
} from "@/apps/fileManagerOpenWith";
import type {
  Agent,
  Binding,
  FileListEntry,
  SharingDefaults,
} from "@/types/daemon";
import type { DaemonClient } from "@/lib/daemon";

type TabId = "browse" | "inbox" | "downloads" | "shared";

const FileManager: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const windowArgs = useCurrentWindowArgs();
  const filesArgs = windowArgs?.files;
  const { addNotification } = useNotifications();

  const agents = useMemo(() => daemon.state?.agents ?? [], [daemon.state]);

  // Selected pod — defaults to first allocated agent. Cleared if
  // the agent disappears (e.g. revoked from another surface).
  const [selectedPodId, setSelectedPodId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("browse");

  // Tray route consumer — fires once per nonce/full route when the shell
  // dispatches `#/pod/NN/files`.
  const consumedHashRef = useRef<Set<string>>(new Set());
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!filesArgs?.podId) return;
    const key = `${windowArgs?.routeNonce ?? "no-nonce"}:${filesArgs.podId}:${filesArgs.tab ?? "inbox"}`;
    if (consumedHashRef.current.has(key)) return;
    consumedHashRef.current.add(key);
    if (
      agents.length > 0 &&
      !agents.some((a) => a.pod_id === filesArgs.podId)
    ) {
      addNotification({
        appId: "filemanager",
        appName: "Files",
        appIcon: "Folder",
        title: `Pod ${filesArgs.podId} not found`,
        message: "This tray route no longer matches an allocated pod.",
        isRead: false,
      });
      return;
    }
    setSelectedPodId(filesArgs.podId);
    setActiveTab(filesArgs.tab ?? "browse");
  }, [addNotification, agents, filesArgs, windowArgs?.routeNonce]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-pick first agent when none selected, and prune selection
  // when the chosen pod disappears from state.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (agents.length === 0) {
      if (selectedPodId !== null) setSelectedPodId(null);
      return;
    }
    const stillThere = agents.some((a) => a.pod_id === selectedPodId);
    if (!stillThere) {
      setSelectedPodId(agents[0].pod_id);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [agents, selectedPodId]);

  const selectedAgent = agents.find((a) => a.pod_id === selectedPodId) ?? null;

  const onAllocate = useCallback(() => {
    dispatch({ type: "OPEN_WINDOW", appId: "settings" });
    navigate({
      kind: "settings",
      section: "agents",
      params: new URLSearchParams(),
    });
  }, [dispatch]);

  // Empty state — no agents at all. We still allow Shared to be
  // useful eventually, but the bind flow needs at least one pod
  // to provision against, so hold the existing CTA.
  if (agents.length === 0) {
    return (
      <div
        className="flex flex-col h-full"
        style={{ background: "var(--bg-window)" }}
      >
        <Header podId={null} agentType={null} activeTab={activeTab} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div
            className="w-[420px] rounded-2xl p-8 flex flex-col items-center text-center"
            style={{
              background: "rgba(30,30,30,0.65)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{
                background: "linear-gradient(135deg, #7C4DFF, #4A148C)",
              }}
            >
              <Rocket size={28} className="text-white" />
            </div>
            <div className="text-base font-semibold text-[var(--text-primary)]">
              No pods.
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-[300px] leading-relaxed">
              Allocate a pod first — then its inbox, Downloads folder, and
              shared folders will appear here.
            </div>
            <button
              onClick={onAllocate}
              className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{ background: "var(--accent-primary)" }}
            >
              Allocate a pod →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Sidebar greys out (still visible) when Shared is active —
  // the user understands shared folders are global, not pod-scoped.
  const sidebarDisabled = activeTab === "shared" || activeTab === "browse";

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "var(--bg-window)" }}
    >
      <Header
        podId={selectedAgent?.pod_id ?? null}
        agentType={selectedAgent?.agent_type ?? null}
        activeTab={activeTab}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          agents={agents}
          selectedPodId={selectedPodId}
          onSelect={setSelectedPodId}
          disabled={sidebarDisabled}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <TabStrip activeTab={activeTab} onSelect={setActiveTab} />
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === "browse" ? (
              <FileBrowser agents={agents} client={client} />
            ) : activeTab === "shared" ? (
              <SharedTab agents={agents} client={client} />
            ) : !selectedAgent ? (
              <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
                Select a pod from the left.
              </div>
            ) : activeTab === "inbox" ? (
              <InboxTab agent={selectedAgent} client={client} />
            ) : (
              <DownloadsTab agent={selectedAgent} client={client} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Header — small status bar above the split layout
// ============================================================

const Header: FC<{
  podId: string | null;
  agentType: string | null;
  activeTab: TabId;
}> = ({ podId, agentType, activeTab }) => {
  const isShared = activeTab === "shared";
  const isBrowse = activeTab === "browse";
  return (
    <div
      className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      {isShared ? (
        <FolderSync size={18} className="text-[var(--accent-primary)]" />
      ) : isBrowse ? (
        <Home size={18} className="text-[var(--accent-primary)]" />
      ) : (
        <Folder size={18} className="text-[var(--accent-primary)]" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {isBrowse
            ? "Files — Browser"
            : isShared
              ? "Files — Shared folders"
              : `Files${podId ? ` — Pod ${podId}` : ""}`}
        </div>
        <div className="text-[11px] text-[var(--text-secondary)] truncate">
          {isBrowse
            ? "Browse Tytus Home, shared folders, and pod workspaces"
            : isShared
              ? "Bindings are account-scoped, synced across all your pods"
              : podId
                ? `Inbox + Downloads · ${agentType ?? "agent"}`
                : "Per-pod inbox and local Downloads folder"}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Sidebar — pod picker (agents only)
// ============================================================

const Sidebar: FC<{
  agents: Agent[];
  selectedPodId: string | null;
  onSelect: (podId: string) => void;
  disabled?: boolean;
}> = ({ agents, selectedPodId, onSelect, disabled = false }) => (
  <div
    className="w-48 shrink-0 flex flex-col"
    style={{
      background: "var(--bg-titlebar)",
      borderRight: "1px solid var(--border-subtle)",
      opacity: disabled ? 0.45 : 1,
      pointerEvents: disabled ? "none" : "auto",
    }}
    aria-disabled={disabled || undefined}
  >
    <div
      className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold"
      style={{ color: "var(--text-secondary)" }}
    >
      Pods
    </div>
    {agents.map((a) => {
      const active = a.pod_id === selectedPodId && !disabled;
      return (
        <button
          key={a.pod_id}
          onClick={() => onSelect(a.pod_id)}
          disabled={disabled}
          className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors text-left"
          style={{
            background: active ? "var(--bg-selected)" : "transparent",
            color: active ? "var(--accent-primary)" : "var(--text-primary)",
            borderLeft: active
              ? "3px solid var(--accent-primary)"
              : "3px solid transparent",
          }}
        >
          <Box
            size={14}
            className={
              active
                ? "text-[var(--accent-primary)]"
                : "text-[var(--text-secondary)]"
            }
          />
          <span className="flex-1 truncate">Pod {a.pod_id}</span>
          <span
            className="text-[10px]"
            style={{
              color: active ? "var(--accent-primary)" : "var(--text-secondary)",
              opacity: 0.7,
            }}
          >
            {a.agent_type}
          </span>
        </button>
      );
    })}
    {disabled && (
      <div
        className="px-4 py-3 text-[10px] leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        Shared folders are account-scoped — pod selection doesn't apply here.
      </div>
    )}
  </div>
);

// ============================================================
// Tab strip — always visible, three tabs
// ============================================================

const TabStrip: FC<{
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
}> = ({ activeTab, onSelect }) => {
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "browse", label: "Browse", icon: <Home size={12} /> },
    { id: "inbox", label: "Inbox", icon: <Inbox size={12} /> },
    { id: "downloads", label: "Downloads", icon: <Download size={12} /> },
    { id: "shared", label: "Shared", icon: <FolderSync size={12} /> },
  ];
  return (
    <div
      className="flex items-stretch flex-shrink-0"
      style={{
        background: "var(--bg-titlebar, rgba(255,255,255,0.02))",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {tabs.map((t) => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors"
            style={{
              background: active ? "var(--bg-window)" : "transparent",
              color: active ? "var(--accent-primary)" : "var(--text-secondary)",
              borderRight: "1px solid var(--border-subtle)",
              borderTop: active
                ? "2px solid var(--accent-primary)"
                : "2px solid transparent",
            }}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
};

type BrowserSource = {
  id: string;
  label: string;
  detail: string;
  source: string;
  path?: string;
  pod?: string;
  binding?: number;
  readonly?: boolean;
};

const formatBytes = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const parentPath = (path: string): string => {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (!clean) return "";
  const parts = clean.split("/");
  parts.pop();
  return parts.join("/");
};

const joinPath = (base: string, child: string): string => {
  const clean = base.replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/${child}` : child;
};

const MAX_BROWSER_TRANSFER_BYTES = 100 * 1024 * 1024;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const copyName = (name: string): string => {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return `${name} copy`;
  return `${name.slice(0, idx)} copy${name.slice(idx)}`;
};

const FileBrowser: FC<{ agents: Agent[]; client: DaemonClient }> = ({
  agents,
  client,
}) => {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [sourceId, setSourceId] = useState("tytus-home");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileListEntry[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [rootLabel, setRootLabel] = useState("Tytus Home");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.getSharedFolders().then((r) => {
      if (cancelled) return;
      if (r.ok) setBindings(r.value.bindings);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const sources = useMemo<BrowserSource[]>(() => {
    const base: BrowserSource[] = [
      {
        id: "tytus-home",
        label: "Tytus Home",
        detail: "~/Tytus",
        source: "tytus-home",
      },
      {
        id: "home-inbox",
        label: "Inbox",
        detail: "~/Tytus/Inbox",
        source: "tytus-home",
        path: "Inbox",
      },
      {
        id: "home-outbox",
        label: "Outbox",
        detail: "~/Tytus/Outbox",
        source: "tytus-home",
        path: "Outbox",
      },
      {
        id: "home-downloads",
        label: "Downloads",
        detail: "~/Tytus/Downloads",
        source: "tytus-home",
        path: "Downloads",
      },
      {
        id: "home-projects",
        label: "Projects",
        detail: "~/Tytus/Projects",
        source: "tytus-home",
        path: "Projects",
      },
    ];
    for (const [i, binding] of bindings.entries()) {
      base.push({
        id: `shared-${i}`,
        label: `Shared · ${binding.bucket}`,
        detail: binding.local_path,
        source: "shared",
        binding: i,
      });
    }
    for (const agent of agents) {
      base.push({
        id: `pod-${agent.pod_id}`,
        label: `Pod ${agent.pod_id} workspace`,
        detail: "/app/workspace",
        source: "pod-workspace",
        pod: agent.pod_id,
        readonly: true,
      });
    }
    return base;
  }, [agents, bindings]);

  const activeSource = sources.find((s) => s.id === sourceId) ?? sources[0];

  const mutationPayload = useCallback(
    (targetPath: string) => ({
      source: activeSource?.source ?? "tytus-home",
      binding: activeSource?.binding,
      path: joinPath(activeSource?.path ?? "", targetPath),
    }),
    [activeSource],
  );

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  useEffect(() => {
    if (!activeSource) return;
    let cancelled = false;
    const effectivePath = joinPath(activeSource.path ?? "", path);
    const load = async () => {
      setLoading(true);
      setErr(null);
      const r = await client.getFilesList({
        source: activeSource.source,
        path: effectivePath,
        pod: activeSource.pod,
        binding: activeSource.binding,
      });
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setErr(r.error.message);
        setEntries([]);
        return;
      }
      setRootLabel(r.value.root_label);
      setRootPath(r.value.root_path);
      const prefix = activeSource.path ?? "";
      const visible = prefix
        ? r.value.entries.map((entry) => ({
            ...entry,
            path: entry.path.startsWith(`${prefix}/`)
              ? entry.path.slice(prefix.length + 1)
              : entry.path,
          }))
        : r.value.entries;
      setEntries(visible);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeSource, client, path, refreshNonce]);

  const selectSource = (id: string) => {
    setSourceId(id);
    setPath("");
    setQuery("");
  };

  const createFolder = async () => {
    if (!activeSource || activeSource.readonly) return;
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    setMutationBusy(true);
    setErr(null);
    const r = await client.postFilesMkdir({
      ...mutationPayload(path),
      name: name.trim(),
    });
    setMutationBusy(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    refresh();
  };

  const renameEntry = async (entry: FileListEntry) => {
    if (!activeSource || activeSource.readonly) return;
    const nextName = window.prompt("Rename to", entry.name);
    if (!nextName?.trim() || nextName.trim() === entry.name) return;
    setMutationBusy(true);
    setErr(null);
    const r = await client.postFilesRename({
      ...mutationPayload(entry.path),
      new_name: nextName.trim(),
    });
    setMutationBusy(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    refresh();
  };

  const deleteEntry = async (entry: FileListEntry) => {
    if (!activeSource || activeSource.readonly) return;
    const ok = window.confirm(
      `Delete ${entry.kind === "dir" ? "folder" : "file"} "${entry.name}"?\n\nFolders must be empty. This cannot be undone.`,
    );
    if (!ok) return;
    setMutationBusy(true);
    setErr(null);
    const r = await client.postFilesDelete(mutationPayload(entry.path));
    setMutationBusy(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    refresh();
  };

  const downloadEntry = (entry: FileListEntry) => {
    if (entry.kind !== "file") return;
    const a = document.createElement("a");
    a.href = client.filesDownloadUrl(mutationPayload(entry.path));
    a.download = entry.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const copyOrMoveEntry = async (entry: FileListEntry, op: "copy" | "move") => {
    if (!activeSource || activeSource.readonly || entry.kind !== "file") return;
    const destination_path = window.prompt(
      `${op === "copy" ? "Copy" : "Move"} into folder path (relative to ${rootLabel})`,
      path,
    );
    if (destination_path === null) return;
    const defaultName = op === "copy" ? copyName(entry.name) : entry.name;
    const new_name = window.prompt(
      `${op === "copy" ? "Copy" : "Move"} as`,
      defaultName,
    );
    if (!new_name?.trim()) return;
    setMutationBusy(true);
    setErr(null);
    const payload = {
      ...mutationPayload(entry.path),
      destination_path: joinPath(activeSource.path ?? "", destination_path.trim()),
      new_name: new_name.trim(),
    };
    const r =
      op === "copy"
        ? await client.postFilesCopy(payload)
        : await client.postFilesMove(payload);
    setMutationBusy(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    refresh();
  };

  const uploadFiles = async (fileList: FileList | null) => {
    if (!activeSource || activeSource.readonly || !fileList?.length) return;
    setUploading(true);
    setErr(null);
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_BROWSER_TRANSFER_BYTES) {
          setErr(`${file.name} exceeds the 100 MiB transfer cap.`);
          break;
        }
        const content_base64 = arrayBufferToBase64(await file.arrayBuffer());
        const r = await client.postFilesUpload({
          ...mutationPayload(path),
          name: file.name,
          content_base64,
        });
        if (!r.ok) {
          setErr(`${file.name}: ${r.error.message}`);
          break;
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      setUploading(false);
      setDragActive(false);
      refresh();
    }
  };

  const filtered = entries.filter((entry) =>
    entry.name.toLowerCase().includes(query.toLowerCase()),
  );

  const crumbs = path ? path.split("/").filter(Boolean) : [];

  return (
    <div className="flex flex-1 min-h-0">
      <div
        className="w-60 shrink-0 overflow-y-auto custom-scrollbar"
        style={{
          background: "var(--bg-sidebar, rgba(255,255,255,0.02))",
          borderRight: "1px solid var(--border-subtle)",
        }}
      >
        <div className="px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
          Sources
        </div>
        {sources.map((source) => {
          const active = source.id === sourceId;
          return (
            <button
              key={source.id}
              onClick={() => selectSource(source.id)}
              className="w-full px-4 py-2.5 flex items-center gap-2 text-left transition-colors"
              style={{
                background: active ? "rgba(124,77,255,0.16)" : "transparent",
                color: active ? "var(--accent-primary)" : "var(--text-primary)",
              }}
            >
              {source.source === "pod-workspace" ? (
                <Box size={15} />
              ) : source.source === "shared" ? (
                <FolderSync size={15} />
              ) : (
                <Folder size={15} />
              )}
              <span className="min-w-0">
                <span className="block text-xs font-medium truncate">
                  {source.label}
                </span>
                <span className="block text-[10px] text-[var(--text-secondary)] truncate">
                  {source.detail}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div
          className="px-4 py-2.5 flex items-center gap-3 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            onClick={() => setPath(parentPath(path))}
            disabled={!path}
            className="p-1.5 rounded-md disabled:opacity-40"
            style={{
              background: "var(--bg-hover, rgba(255,255,255,0.04))",
              color: "var(--text-primary)",
            }}
            title="Up"
          >
            <ArrowUp size={14} />
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="p-1.5 rounded-md disabled:opacity-40"
            style={{
              background: "var(--bg-hover, rgba(255,255,255,0.04))",
              color: "var(--text-primary)",
            }}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {!activeSource?.readonly && (
            <button
              onClick={createFolder}
              disabled={mutationBusy || uploading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs disabled:opacity-50"
              style={{
                background: "var(--accent-primary)",
                color: "white",
              }}
            >
              {mutationBusy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} />
              )}
              New folder
            </button>
          )}
          {!activeSource?.readonly && (
            <>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void uploadFiles(e.currentTarget.files)}
              />
              <button
                onClick={() => uploadInputRef.current?.click()}
                disabled={mutationBusy || uploading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs disabled:opacity-50"
                style={{
                  background: "var(--bg-hover, rgba(255,255,255,0.04))",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                }}
              >
                {uploading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Upload size={13} />
                )}
                Upload
              </button>
            </>
          )}
          <div className="flex-1 min-w-0 flex items-center gap-1 text-xs text-[var(--text-secondary)] truncate">
            <span className="font-semibold text-[var(--text-primary)]">
              {rootLabel}
            </span>
            {crumbs.map((crumb, i) => (
              <span
                key={`${i}-${crumb}`}
                className="flex items-center gap-1 min-w-0"
              >
                <ChevronRight size={12} />
                <button
                  className="hover:text-[var(--text-primary)] truncate"
                  onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
                >
                  {crumb}
                </button>
              </span>
            ))}
          </div>
          <div
            className="w-56 flex items-center gap-2 px-2 py-1.5 rounded-md"
            style={{
              background: "rgba(0,0,0,0.20)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <Search size={13} className="text-[var(--text-secondary)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent outline-none text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            />
          </div>
        </div>

        {err && (
          <div
            className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
            style={{
              background: "rgba(244,67,54,0.10)",
              border: "1px solid rgba(244,67,54,0.30)",
              color: "#FFCDD2",
            }}
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {err}
          </div>
        )}

        <div
          className="relative flex-1 overflow-y-auto custom-scrollbar p-3"
          onDragEnter={(e) => {
            if (activeSource?.readonly) return;
            e.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(e) => {
            if (activeSource?.readonly) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragActive(false);
          }}
          onDrop={(e) => {
            if (activeSource?.readonly) return;
            e.preventDefault();
            void uploadFiles(e.dataTransfer.files);
          }}
        >
          {dragActive && !activeSource?.readonly && (
            <div
              className="absolute inset-3 z-10 rounded-lg flex flex-col items-center justify-center pointer-events-none"
              style={{
                background: "rgba(124,77,255,0.16)",
                border: "1px dashed var(--accent-primary)",
                color: "var(--text-primary)",
                backdropFilter: "blur(3px)",
              }}
            >
              <Upload size={26} className="mb-2 text-[var(--accent-primary)]" />
              <div className="text-sm font-semibold">Drop files to upload</div>
              <div className="text-[11px] text-[var(--text-secondary)] mt-1">
                100 MiB max per file · current folder
              </div>
            </div>
          )}
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--text-secondary)] gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading folder…
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
              <FolderOpen
                size={28}
                className="mb-2 text-[var(--accent-primary)]"
              />
              <div className="text-sm">Folder is empty.</div>
              <div className="text-[11px] mt-1 max-w-[360px]">
                {activeSource?.readonly
                  ? "This pod workspace is read-only from Files for now. Use Terminal for writes."
                  : "Use Upload or New folder to add content here."}
              </div>
            </div>
          ) : (
            <div className="rounded-lg overflow-hidden border border-[var(--border-subtle)]">
              <div
                className="grid grid-cols-[1fr_96px_130px_188px] gap-3 px-3 py-2 text-[11px] uppercase tracking-wider text-[var(--text-secondary)]"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <span>Name</span>
                <span>Size</span>
                <span>Modified</span>
                <span>Actions</span>
              </div>
              {filtered.map((entry) => (
                <div
                  key={`${entry.kind}:${entry.path}`}
                  onDoubleClick={() => {
                    if (entry.kind === "dir")
                      setPath(joinPath(path, entry.name));
                  }}
                  className="w-full grid grid-cols-[1fr_96px_130px_188px] gap-3 px-3 py-2 text-left text-xs border-t border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                >
                  <span className="flex items-center gap-2 min-w-0 text-[var(--text-primary)]">
                    {entry.kind === "dir" ? (
                      <Folder size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
                    <span className="truncate">{entry.name}</span>
                    {entry.readonly && (
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        read-only
                      </span>
                    )}
                  </span>
                  <span className="text-[var(--text-secondary)] font-mono">
                    {entry.kind === "dir" ? "—" : formatBytes(entry.size)}
                  </span>
                  <span className="text-[var(--text-secondary)] truncate">
                    {entry.modified_at
                      ? new Date(entry.modified_at * 1000).toLocaleDateString()
                      : "—"}
                  </span>
                  <span className="flex items-center gap-1">
                    {activeSource?.readonly ? (
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        —
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => downloadEntry(entry)}
                          disabled={mutationBusy || uploading || entry.kind !== "file"}
                          className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          title="Download"
                        >
                          <Download size={12} />
                        </button>
                        <button
                          onClick={() => void copyOrMoveEntry(entry, "copy")}
                          disabled={mutationBusy || uploading || entry.kind !== "file"}
                          className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          title="Copy"
                        >
                          <CopyIcon size={12} />
                        </button>
                        <button
                          onClick={() => void copyOrMoveEntry(entry, "move")}
                          disabled={mutationBusy || uploading || entry.kind !== "file"}
                          className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          title="Move"
                        >
                          <MoveRight size={12} />
                        </button>
                        <button
                          onClick={() => void renameEntry(entry)}
                          disabled={mutationBusy || uploading}
                          className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          title="Rename"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => void deleteEntry(entry)}
                          disabled={mutationBusy || uploading}
                          className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="px-4 py-2 text-[11px] text-[var(--text-secondary)] flex items-center justify-between border-t"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <span>
            {filtered.length} item{filtered.length === 1 ? "" : "s"} ·{" "}
            {rootPath}
            {path ? `/${path}` : ""}
          </span>
          <span>
            {activeSource?.readonly
              ? "Read-only pod source"
              : "Safe root-anchored source"}
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// InboxTab — auto-fires ls-inbox on mount + on pod switch
// ============================================================

/**
 * Phase 7 cont — open-with hooks for Image / Document / Archive.
 *
 * Inbox rows arrive as raw `ls` output ("photo.png 245K Apr 28 14:22" or
 * just "photo.png"); we take the first whitespace-separated token as
 * the file name. Returns null when the extension has no association in
 * FILE_ASSOCIATIONS (then no menu opens), or when the matched app is
 * not Image / Document / Archive (TextEditor, CodeEditor, … each have
 * their own pre-existing default-open path elsewhere).
 */
const InboxTab: FC<{ agent: Agent; client: DaemonClient }> = ({
  agent,
  client,
}) => {
  const { dispatch } = useOS();
  const [job, setJob] = useState<{ id: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const onFileContext = useCallback(
    (e: React.MouseEvent, line: string) => {
      const filename = inboxLineToFilename(line);
      if (!filename) return;
      const items = buildFileOpenWithMenu(filename);
      if (!items) return;
      e.preventDefault();
      e.stopPropagation();
      dispatch({
        type: "SHOW_CONTEXT_MENU",
        x: e.clientX,
        y: e.clientY,
        menuType: "file",
        items,
        contextData: { file: filename, podId: agent.pod_id },
      });
    },
    [dispatch, agent.pod_id],
  );

  const onRefresh = useCallback(async () => {
    setSubmitting(true);
    setSubmitErr(null);
    setJob(null);
    const r = await client.postPodRunStreamed(agent.pod_id, "ls-inbox");
    setSubmitting(false);
    if (!r.ok) {
      setSubmitErr(r.error.message);
      return;
    }
    setJob({ id: r.value.job_id });
  }, [client, agent.pod_id]);

  // Auto-fire on tab mount + when pod changes. Reset job state so
  // a stale stream from the previous pod doesn't leak through.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setSubmitting(true);
      setSubmitErr(null);
      setJob(null);
      const r = await client.postPodRunStreamed(agent.pod_id, "ls-inbox");
      if (cancelled) return;
      setSubmitting(false);
      if (!r.ok) {
        setSubmitErr(r.error.message);
        return;
      }
      setJob({ id: r.value.job_id });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client, agent.pod_id]);

  const streamUrl = job ? client.jobStreamUrl(job.id) : null;
  const stream = useJobStream({ url: streamUrl });
  const done =
    stream.status === "success" ||
    stream.status === "failed" ||
    stream.status === "lost";
  const inFlight = submitting || (job !== null && !done);

  // After exit, if we never received usable file rows, treat as empty inbox.
  // Older pods can print raw stderr like "No such file or directory" when
  // /app/workspace/inbox has not been created yet. That is a friendly empty
  // state, not a red failure banner.
  const rawLines = stream.lines.filter((l) => l.trim().length > 0);
  const missingInbox = done && rawLines.some(isMissingInboxDiagnostic);
  const lines = missingInbox ? [] : rawLines;
  const isEmptyResult =
    done && stream.status !== "lost" && (lines.length === 0 || missingInbox);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Folder size={14} className="text-[var(--accent-primary)]" />
            inbox/
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
            <code className="font-mono">/app/workspace/inbox/</code> on pod{" "}
            {agent.pod_id}
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={inFlight}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] transition-colors disabled:opacity-60"
          style={{
            background: "var(--bg-hover, rgba(255,255,255,0.04))",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
          }}
        >
          {inFlight ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          Refresh inbox
        </button>
      </div>

      {submitErr && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: "rgba(244,67,54,0.10)",
            border: "1px solid rgba(244,67,54,0.30)",
            color: "#FFCDD2",
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't list inbox: {submitErr}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {!job && submitting && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
            <Loader2
              size={20}
              className="animate-spin mb-2 text-[var(--accent-primary)]"
            />
            <div className="text-xs">Listing inbox…</div>
          </div>
        )}

        {isEmptyResult && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{
                background: "rgba(124,77,255,0.10)",
                border: "1px solid rgba(124,77,255,0.25)",
              }}
            >
              <Inbox size={22} className="text-[var(--accent-primary)]" />
            </div>
            <div className="text-sm">
              {missingInbox ? "Inbox is not created yet." : "Inbox is empty."}
            </div>
            <div className="text-[11px] mt-1 max-w-[380px] leading-relaxed">
              {missingInbox
                ? "This pod has not received any inbox files yet. Tytus will create the folder automatically on the first drop/upload, and new pods create it during bootstrap."
                : "Files dropped to /app/workspace/inbox/ on this pod appear here."}
            </div>
          </div>
        )}

        {job && lines.length > 0 && (
          <div
            className="rounded-md overflow-hidden"
            style={{
              background: "#0A0A0A",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              className="px-3 py-2 flex items-center justify-between text-[11px]"
              style={{
                background: "rgba(255,255,255,0.02)",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span className="text-[var(--text-secondary)]">
                ls-inbox · {lines.length} entr
                {lines.length === 1 ? "y" : "ies"} ·{" "}
                <span
                  style={{
                    color:
                      stream.status === "success"
                        ? "#A5D6A7"
                        : stream.status === "failed"
                          ? "#FF8A80"
                          : stream.status === "lost"
                            ? "#FFB74D"
                            : "#9E9E9E",
                  }}
                >
                  {stream.status}
                  {stream.exitCode !== null && ` (exit ${stream.exitCode})`}
                </span>
              </span>
            </div>
            <ul
              className="font-mono text-[12px] leading-relaxed p-3 m-0"
              style={{
                color: "#E0E0E0",
                maxHeight: "100%",
                overflowY: "auto",
                listStyle: "none",
              }}
            >
              {lines.map((line, i) => (
                <li
                  key={`${i}-${line}`}
                  className="flex items-center gap-2 py-0.5 cursor-default"
                  onContextMenu={(e) => onFileContext(e, line)}
                  title="Right-click for Open with…"
                >
                  <FileText
                    size={12}
                    className="text-[var(--text-secondary)] shrink-0"
                  />
                  <span className="truncate">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stream.status === "failed" && job && !missingInbox && (
          <div
            className="mt-3 p-3 rounded-md text-xs flex items-start gap-2"
            style={{
              background: "rgba(244,67,54,0.10)",
              border: "1px solid rgba(244,67,54,0.30)",
              color: "#FFCDD2",
            }}
          >
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              ls-inbox exited non-zero
              {stream.exitCode !== null && ` (code ${stream.exitCode})`}. The
              inbox directory may not exist on this pod yet.
            </span>
          </div>
        )}

        {stream.status === "lost" && job && (
          <div
            className="mt-3 p-3 rounded-md text-xs flex items-start gap-2"
            style={{
              background: "rgba(255,193,7,0.10)",
              border: "1px solid rgba(255,193,7,0.30)",
              color: "#FFE082",
            }}
          >
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              Lost connection to job stream. Click Refresh inbox to retry.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// DownloadsTab — single CTA opens local Downloads folder
// ============================================================

const DownloadsTab: FC<{ agent: Agent; client: DaemonClient }> = ({
  agent,
  client,
}) => {
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openedTick, setOpenedTick] = useState(0);

  // Path display mirrors daemon convention: ~/Tytus/Downloads/pod-NN/
  const localPath = useMemo(
    () => `~/Tytus/Downloads/pod-${agent.pod_id}/`,
    [agent.pod_id],
  );

  const onOpen = useCallback(async () => {
    setOpening(true);
    setErr(null);
    const r = await client.postFilesOpenDownloads(agent.pod_id);
    setOpening(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    setOpenedTick((t) => t + 1);
  }, [client, agent.pod_id]);

  // Ephemeral "opened" toast — clear after 3s of the latest tick.
  const [openedVisible, setOpenedVisible] = useState(false);
  useEffect(() => {
    if (openedTick === 0) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOpenedVisible(true);
    const t = setTimeout(() => setOpenedVisible(false), 3000);
    return () => clearTimeout(t);
  }, [openedTick]);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-6">
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: "rgba(124,77,255,0.10)",
            border: "1px solid rgba(124,77,255,0.25)",
          }}
        >
          <Download size={22} className="text-[var(--accent-primary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Downloads for pod {agent.pod_id}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
            Files pulled from this pod land in Tytus Home, scoped per pod.
            Legacy files in ~/Downloads/tytus stay untouched.
          </div>
          <div
            className="mt-3 inline-block font-mono text-[11px] px-2.5 py-1.5 rounded-sm"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            {localPath}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={onOpen}
          disabled={opening}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: "var(--accent-primary)" }}
        >
          {opening ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ExternalLink size={14} />
          )}
          Open Downloads folder for pod {agent.pod_id}
        </button>
        {openedVisible && (
          <span className="text-[11px]" style={{ color: "#A5D6A7" }}>
            Opened in Finder.
          </span>
        )}
      </div>

      {err && (
        <div
          className="mt-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: "rgba(244,67,54,0.10)",
            border: "1px solid rgba(244,67,54,0.30)",
            color: "#FFCDD2",
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't open Downloads folder: {err}</span>
        </div>
      )}
    </div>
  );
};

// ============================================================
// SharedTab — account-scoped bindings (manifest §7.5)
// ============================================================

// Bucket name: 3–63 chars, lowercase alnum + dot + hyphen, starts/ends
// alnum. Mirrors S3/Garage spec which is what the daemon enforces.
const BUCKET_RE = /^[a-z0-9]([a-z0-9.-]{1,61}[a-z0-9])?$/;

const validateBucket = (s: string): string | null => {
  if (s.length < 3) return "Bucket name must be at least 3 characters.";
  if (s.length > 63) return "Bucket name must be 63 characters or fewer.";
  if (!BUCKET_RE.test(s)) {
    return "Use lowercase letters, digits, dot, hyphen. Must start and end with a letter or digit.";
  }
  return null;
};

const SharedTab: FC<{ agents: Agent[]; client: DaemonClient }> = ({
  agents,
  client,
}) => {
  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const [sharingDefaults, setSharingDefaults] =
    useState<SharingDefaults | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listing, setListing] = useState(false);

  const [bindModalOpen, setBindModalOpen] = useState(false);

  // Sync-now job (single-flight with bind-stream — only one
  // shared-folders job at a time per the task spec).
  const [syncJob, setSyncJob] = useState<{ id: string } | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const syncStreamUrl = syncJob ? client.jobStreamUrl(syncJob.id) : null;
  const syncStream = useJobStream({ url: syncStreamUrl });
  const syncDone =
    syncStream.status === "success" ||
    syncStream.status === "failed" ||
    syncStream.status === "lost";
  const syncInFlight = syncSubmitting || (syncJob !== null && !syncDone);
  const sharingPaused = sharingDefaults?.sharing_globally_enabled === false;
  const sharingBlocked = syncInFlight || sharingPaused;

  // Per-binding "open" inline error (e.g. orphaned local path).
  const [openErrByPath, setOpenErrByPath] = useState<Record<string, string>>(
    {},
  );
  const [openCacheErr, setOpenCacheErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setListing(true);
    setListErr(null);
    const [r, defaults] = await Promise.all([
      client.getSharedFolders(),
      client.getSharingDefaults(),
    ]);
    setListing(false);
    if (!r.ok) {
      setListErr(r.error.message);
      return;
    }
    setBindings(r.value.bindings);
    if (defaults.ok) {
      setSharingDefaults(defaults.value);
    } else {
      setListErr(defaults.error.message);
    }
  }, [client]);

  // Auto-fire on tab mount.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setListing(true);
      setListErr(null);
      const [r, defaults] = await Promise.all([
        client.getSharedFolders(),
        client.getSharingDefaults(),
      ]);
      if (cancelled) return;
      setListing(false);
      if (!r.ok) {
        setListErr(r.error.message);
        return;
      }
      setBindings(r.value.bindings);
      if (defaults.ok) {
        setSharingDefaults(defaults.value);
      } else {
        setListErr(defaults.error.message);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // When sync-now finishes successfully, refresh the bindings.
  // The setState-in-effect lint warning is suppressed: refresh()
  // calls setState internally, but we're reacting to a one-shot
  // stream-state transition, not derived render state.
  const lastHandledSyncStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!syncJob) return;
    if (lastHandledSyncStatusRef.current === syncStream.status) return;
    if (syncDone) {
      lastHandledSyncStatusRef.current = syncStream.status;
      if (syncStream.status === "success") {
        /* eslint-disable-next-line react-hooks/set-state-in-effect */
        void refresh();
      }
    }
  }, [syncJob, syncStream.status, syncDone, refresh]);

  const onSyncNow = useCallback(async () => {
    if (sharingBlocked) return;
    setSyncSubmitting(true);
    setSyncErr(null);
    setSyncJob(null);
    lastHandledSyncStatusRef.current = null;
    const r = await client.postSharedFoldersRunStreamed("refresh-all");
    setSyncSubmitting(false);
    if (!r.ok) {
      setSyncErr(r.error.message);
      return;
    }
    setSyncJob({ id: r.value.job_id });
  }, [client, sharingBlocked]);

  const onOpenCache = useCallback(async () => {
    setOpenCacheErr(null);
    const r = await client.postSharedFoldersOpenCache();
    if (!r.ok) {
      setOpenCacheErr(r.error.message);
    }
  }, [client]);

  const onOpenBinding = useCallback(
    async (b: Binding) => {
      setOpenErrByPath((prev) => {
        const next = { ...prev };
        delete next[b.local_path];
        return next;
      });
      const r = await client.postSharedFoldersOpen(b.local_path);
      if (!r.ok) {
        const msg =
          r.error.code === "not_found" || r.error.status === 404
            ? "Local folder is missing — it may have been moved or deleted."
            : r.error.message;
        setOpenErrByPath((prev) => ({ ...prev, [b.local_path]: msg }));
      }
    },
    [client],
  );

  const onBindSuccess = useCallback(async () => {
    setBindModalOpen(false);
    await refresh();
  }, [refresh]);

  // Format pod display: prefer wannolot-NN → "NN", else show as-is.
  const formatPods = (pods: string[]): string => {
    if (pods.length === 0) return "(none)";
    return pods
      .map((p) => {
        const m = /^wannolot-(\d+)$/.exec(p);
        return m ? m[1] : p;
      })
      .join(", ");
  };

  const empty = bindings !== null && bindings.length === 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header row */}
      <div
        className="px-5 py-3 flex items-center gap-2 flex-shrink-0 flex-wrap"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <FolderSync size={14} className="text-[var(--accent-primary)]" />
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Shared folders
          </div>
          {bindings && (
            <span
              className="text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
              · {bindings.length} binding{bindings.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <button
          onClick={() => setBindModalOpen(true)}
          disabled={sharingBlocked}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: "var(--accent-primary)" }}
        >
          <Plus size={12} />
          Bind new folder
        </button>
        <button
          onClick={onSyncNow}
          disabled={sharingBlocked}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] transition-colors disabled:opacity-60"
          style={{
            background: "var(--bg-hover, rgba(255,255,255,0.04))",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
          }}
        >
          {syncInFlight ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <FolderSync size={11} />
          )}
          Refresh pod sign-in
        </button>
        <button
          onClick={onOpenCache}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] transition-colors"
          style={{
            background: "var(--bg-hover, rgba(255,255,255,0.04))",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
          }}
        >
          <HardDriveDownload size={11} />
          Open cache
        </button>
        <button
          onClick={refresh}
          disabled={listing}
          aria-label="Refresh bindings"
          title="Refresh bindings"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] transition-colors disabled:opacity-60"
          style={{
            background: "var(--bg-hover, rgba(255,255,255,0.04))",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
          }}
        >
          {listing ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
        </button>
      </div>

      {listErr && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: "rgba(244,67,54,0.10)",
            border: "1px solid rgba(244,67,54,0.30)",
            color: "#FFCDD2",
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't list shared folders: {listErr}</span>
        </div>
      )}

      {openCacheErr && (
        <div
          className="m-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: "rgba(244,67,54,0.10)",
            border: "1px solid rgba(244,67,54,0.30)",
            color: "#FFCDD2",
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't open cache folder: {openCacheErr}</span>
        </div>
      )}

      {sharingPaused && (
        <div
          className="mx-4 mt-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: "rgba(255,193,7,0.10)",
            border: "1px solid rgba(255,193,7,0.30)",
            color: "#FFE082",
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Sharing is paused in Settings → Sharing. Existing bindings are
            read-only; bind and refresh actions are disabled.
          </span>
        </div>
      )}

      {/* Sync-now inline progress */}
      {syncErr && (
        <div
          className="mx-4 mt-4 p-3 rounded-md text-xs flex items-start gap-2"
          style={{
            background: "rgba(244,67,54,0.10)",
            border: "1px solid rgba(244,67,54,0.30)",
            color: "#FFCDD2",
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn't start sync: {syncErr}</span>
        </div>
      )}
      {syncJob && (
        <SyncStreamPane
          status={syncStream.status}
          lines={syncStream.lines}
          exitCode={syncStream.exitCode}
        />
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {bindings === null && listing && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
            <Loader2
              size={20}
              className="animate-spin mb-2 text-[var(--accent-primary)]"
            />
            <div className="text-xs">Loading bindings…</div>
          </div>
        )}

        {empty && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)]">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{
                background: "rgba(124,77,255,0.10)",
                border: "1px solid rgba(124,77,255,0.25)",
              }}
            >
              <FolderSync size={22} className="text-[var(--accent-primary)]" />
            </div>
            <div className="text-sm">No shared folders yet.</div>
            <div className="text-[11px] mt-1 max-w-[360px] leading-relaxed">
              Bind a Mac folder to share it with your pods.
            </div>
            <button
              onClick={() => setBindModalOpen(true)}
              disabled={sharingBlocked}
              className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-60"
              style={{ background: "var(--accent-primary)" }}
            >
              <Plus size={12} />
              Bind new folder
            </button>
          </div>
        )}

        {bindings && bindings.length > 0 && (
          <div className="flex flex-col gap-3">
            {bindings.map((b) => (
              <BindingCard
                key={`${b.bucket}-${b.local_path}`}
                binding={b}
                onOpen={() => onOpenBinding(b)}
                openErr={openErrByPath[b.local_path] ?? null}
                podsLabel={formatPods(b.pods_provisioned)}
              />
            ))}
          </div>
        )}
      </div>

      {bindModalOpen && (
        <BindFolderModal
          agents={agents}
          client={client}
          onCancel={() => setBindModalOpen(false)}
          onSuccess={onBindSuccess}
          defaults={sharingDefaults}
          syncBlocked={sharingBlocked}
          pauseReason={
            sharingPaused
              ? "Sharing is paused in Settings → Sharing."
              : undefined
          }
        />
      )}
    </div>
  );
};

// ============================================================
// SyncStreamPane — small inline progress for credential refresh
// ============================================================

const SyncStreamPane: FC<{
  status: string;
  lines: string[];
  exitCode: number | null;
}> = ({ status, lines, exitCode }) => {
  const visibleLines = lines.filter((l) => l.length > 0);
  const last =
    visibleLines.length > 0 ? visibleLines[visibleLines.length - 1] : null;

  let color = "#9E9E9E";
  if (status === "success") color = "#A5D6A7";
  else if (status === "failed") color = "#FF8A80";
  else if (status === "lost") color = "#FFB74D";

  return (
    <div
      className="mx-4 mt-4 rounded-md overflow-hidden"
      style={{
        background: "#0A0A0A",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-2 text-[11px]"
        style={{
          background: "rgba(255,255,255,0.02)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        {status === "streaming" || status === "subscribing" ? (
          <Loader2
            size={11}
            className="animate-spin text-[var(--accent-primary)]"
          />
        ) : status === "success" ? (
          <Check size={11} style={{ color }} />
        ) : (
          <AlertTriangle size={11} style={{ color }} />
        )}
        <span className="text-[var(--text-secondary)]">
          refresh pod sign-in ·{" "}
          <span style={{ color }}>
            {status}
            {exitCode !== null && ` (exit ${exitCode})`}
          </span>
        </span>
      </div>
      {last !== null && (
        <div
          className="font-mono text-[11px] px-3 py-2 truncate"
          style={{ color: "#E0E0E0" }}
        >
          {last}
        </div>
      )}
    </div>
  );
};

// ============================================================
// BindingCard — one card per binding
// ============================================================

const BindingCard: FC<{
  binding: Binding;
  onOpen: () => void;
  openErr: string | null;
  podsLabel: string;
}> = ({ binding, onOpen, openErr, podsLabel }) => (
  <div
    className="rounded-lg p-4 flex flex-col gap-2"
    style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid var(--border-subtle)",
    }}
  >
    <div className="flex items-start gap-3">
      <div
        className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
        style={{
          background: "rgba(124,77,255,0.10)",
          border: "1px solid rgba(124,77,255,0.25)",
        }}
      >
        <LinkIcon size={16} className="text-[var(--accent-primary)]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {binding.bucket}
        </div>
        <div
          className="font-mono text-[11px] mt-0.5 truncate"
          style={{ color: "var(--text-secondary)" }}
          title={binding.local_path}
        >
          {binding.local_path}
        </div>
      </div>
      <button
        onClick={onOpen}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors"
        style={{
          background: "var(--bg-hover, rgba(255,255,255,0.04))",
          border: "1px solid var(--border-default)",
          color: "var(--text-primary)",
        }}
      >
        <FolderOpen size={11} />
        Open
      </button>
    </div>
    <div
      className="flex items-center gap-3 text-[11px] flex-wrap"
      style={{ color: "var(--text-secondary)" }}
    >
      <span className="inline-flex items-center gap-1">
        <FolderSync size={11} />
        {binding.auto_sync
          ? `auto-sync · every ${binding.interval_sec}s`
          : "manual sync"}
      </span>
      <span>·</span>
      <span>Synced to pods: {podsLabel}</span>
    </div>
    {openErr && (
      <div
        className="mt-1 px-3 py-2 rounded-md text-[11px] flex items-start gap-2"
        style={{
          background: "rgba(244,67,54,0.10)",
          border: "1px solid rgba(244,67,54,0.30)",
          color: "#FFCDD2",
        }}
      >
        <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
        <span>{openErr}</span>
      </div>
    )}
  </div>
);

// ============================================================
// BindFolderModal — pick path + bucket + pods + auto-sync
// ============================================================

interface BindFolderModalProps {
  agents: Agent[];
  client: DaemonClient;
  onCancel: () => void;
  onSuccess: () => void;
  defaults: SharingDefaults | null;
  syncBlocked: boolean;
  pauseReason?: string;
}

const BindFolderModal: FC<BindFolderModalProps> = ({
  agents,
  client,
  onCancel,
  onSuccess,
  defaults,
  syncBlocked,
  pauseReason,
}) => {
  const [localPath, setLocalPath] = useState<string | null>(
    defaults?.default_local_root ?? null,
  );
  const [picking, setPicking] = useState(false);
  const [pickErr, setPickErr] = useState<string | null>(null);

  const [bucket, setBucket] = useState(defaults?.default_bucket ?? "shared");
  const [bucketTouched, setBucketTouched] = useState(false);

  // Selected pod ids from agents (pod_id strings, e.g. "02").
  // Empty Set => all (server treats absent as all).
  const [selectedPods, setSelectedPods] = useState<Set<string>>(new Set());
  const [autoSync, setAutoSync] = useState(
    defaults?.default_auto_sync ?? true,
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [job, setJob] = useState<{ id: string } | null>(null);

  const streamUrl = job ? client.jobStreamUrl(job.id) : null;
  const stream = useJobStream({ url: streamUrl });
  const done =
    stream.status === "success" ||
    stream.status === "failed" ||
    stream.status === "lost";
  const inFlight = submitting || (job !== null && !done);

  // Close modal on stream success.
  const lastHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    if (lastHandledRef.current === stream.status) return;
    if (done) {
      lastHandledRef.current = stream.status;
      if (stream.status === "success") {
        onSuccess();
      } else {
        // Failure / lost → keep modal open with explanation but
        // also surface a friendlier message.
        const code = stream.exitCode;
        /* eslint-disable-next-line react-hooks/set-state-in-effect */
        setSubmitErr(
          stream.status === "failed"
            ? `Bind job failed${code !== null ? ` (exit ${code})` : ""}.`
            : "Lost connection to bind job.",
        );
      }
    }
  }, [job, stream.status, stream.exitCode, done, onSuccess]);

  const bucketErr = bucketTouched ? validateBucket(bucket) : null;
  const canSubmit =
    localPath !== null &&
    bucket.length > 0 &&
    validateBucket(bucket) === null &&
    !inFlight &&
    !syncBlocked;

  const onPick = useCallback(async () => {
    setPicking(true);
    setPickErr(null);
    const r = await client.postSharedFoldersPickFolder();
    setPicking(false);
    if (!r.ok) {
      setPickErr(r.error.message);
      return;
    }
    if ("cancelled" in r.value) {
      // User dismissed — leave existing path untouched.
      return;
    }
    setLocalPath(r.value.path);
  }, [client]);

  const onTogglePod = useCallback((podId: string) => {
    setSelectedPods((prev) => {
      const next = new Set(prev);
      if (next.has(podId)) next.delete(podId);
      else next.add(podId);
      return next;
    });
  }, []);

  const onSubmit = useCallback(async () => {
    if (!localPath) return;
    setBucketTouched(true);
    if (validateBucket(bucket) !== null) return;
    setSubmitting(true);
    setSubmitErr(null);
    setJob(null);
    lastHandledRef.current = null;
    const payload: {
      local_path: string;
      bucket: string;
      pods?: string[];
      auto_sync?: boolean;
    } = {
      local_path: localPath,
      bucket,
      auto_sync: autoSync,
    };
    if (selectedPods.size > 0) {
      payload.pods = Array.from(selectedPods);
    }
    const r = await client.postSharedFoldersBind(payload);
    setSubmitting(false);
    if (!r.ok) {
      setSubmitErr(r.error.message);
      return;
    }
    setJob({ id: r.value.job_id });
  }, [client, localPath, bucket, selectedPods, autoSync]);

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-[520px] max-h-[90vh] rounded-xl flex flex-col overflow-hidden"
        style={{
          background: "var(--bg-window, #1E1E1E)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        <div
          className="px-5 py-3 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Bind shared folder
          </div>
          <button
            onClick={onCancel}
            disabled={inFlight}
            aria-label="Close"
            className="p-1 rounded-sm transition-colors disabled:opacity-60"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
          {/* Local folder */}
          <div className="flex flex-col gap-1.5">
            <label
              className="text-[11px] font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Local folder
            </label>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 min-w-0 px-3 py-2 rounded-md text-xs font-mono truncate"
                style={{
                  background: "var(--bg-input, rgba(255,255,255,0.04))",
                  color: localPath
                    ? "var(--text-primary)"
                    : "var(--text-disabled)",
                  border: "1px solid var(--border-default)",
                }}
                title={localPath ?? undefined}
              >
                {localPath ?? "No folder picked"}
              </div>
              <button
                onClick={onPick}
                disabled={picking || inFlight}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors disabled:opacity-60"
                style={{
                  background: "var(--bg-hover, rgba(255,255,255,0.04))",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              >
                {picking ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <FolderOpen size={12} />
                )}
                Choose folder…
              </button>
            </div>
            {pickErr && (
              <div className="text-[11px]" style={{ color: "#FF8A80" }}>
                Couldn't open picker: {pickErr}
              </div>
            )}
          </div>

          {/* Bucket name */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="tytus-bucket-name"
              className="text-[11px] font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Bucket name
            </label>
            <input
              id="tytus-bucket-name"
              type="text"
              value={bucket}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setBucket(e.target.value)}
              onBlur={() => setBucketTouched(true)}
              disabled={inFlight}
              className="w-full px-3 py-2 rounded-md text-xs font-mono outline-none disabled:opacity-60"
              style={{
                background: "var(--bg-input, rgba(255,255,255,0.04))",
                color: "var(--text-primary)",
                border: bucketErr
                  ? "1px solid rgba(244,67,54,0.55)"
                  : "1px solid var(--border-default)",
              }}
            />
            {bucketErr ? (
              <div className="text-[11px]" style={{ color: "#FF8A80" }}>
                {bucketErr}
              </div>
            ) : (
              <div
                className="text-[10px]"
                style={{ color: "var(--text-disabled)" }}
              >
                3–63 chars, lowercase letters, digits, dot, hyphen.
              </div>
            )}
          </div>

          {/* Pods */}
          <div className="flex flex-col gap-1.5">
            <label
              className="text-[11px] font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Pods to provision
            </label>
            <div className="flex flex-col gap-1.5">
              {agents.length === 0 ? (
                <div
                  className="text-[11px]"
                  style={{ color: "var(--text-disabled)" }}
                >
                  No allocated pods.
                </div>
              ) : (
                agents.map((a) => {
                  const checked = selectedPods.has(a.pod_id);
                  return (
                    <label
                      key={a.pod_id}
                      className="flex items-center gap-2 text-xs cursor-pointer"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onTogglePod(a.pod_id)}
                        disabled={inFlight}
                      />
                      <span>
                        Pod {a.pod_id}{" "}
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          ({a.agent_type})
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <div
              className="text-[10px]"
              style={{ color: "var(--text-disabled)" }}
            >
              Leave all unchecked to provision every allocated pod.
            </div>
          </div>

          {/* Auto-sync */}
          <div className="flex flex-col gap-1.5">
            <label
              className="flex items-center gap-2 text-xs cursor-pointer"
              style={{ color: "var(--text-primary)" }}
            >
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                disabled={inFlight}
              />
              <span>Auto-sync</span>
            </label>
            <div
              className="text-[10px]"
              style={{ color: "var(--text-disabled)" }}
            >
              Daemon-owned launchd agent will sync at a fixed interval.
            </div>
          </div>

          {syncBlocked && !job && (
            <div
              className="px-3 py-2 rounded-md text-[11px] flex items-start gap-2"
              style={{
                background: "rgba(255,193,7,0.10)",
                border: "1px solid rgba(255,193,7,0.30)",
                color: "#FFE082",
              }}
            >
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span>
                {pauseReason ??
                  "Another shared-folders job is in flight. Wait for it to finish before binding."}
              </span>
            </div>
          )}

          {submitErr && (
            <div
              className="px-3 py-2 rounded-md text-[11px] flex items-start gap-2"
              style={{
                background: "rgba(244,67,54,0.10)",
                border: "1px solid rgba(244,67,54,0.30)",
                color: "#FFCDD2",
              }}
            >
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{submitErr}</span>
            </div>
          )}

          {job && (
            <div
              className="rounded-md overflow-hidden"
              style={{
                background: "#0A0A0A",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                className="px-3 py-2 flex items-center gap-2 text-[11px]"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                {!done ? (
                  <Loader2
                    size={11}
                    className="animate-spin text-[var(--accent-primary)]"
                  />
                ) : stream.status === "success" ? (
                  <Check size={11} style={{ color: "#A5D6A7" }} />
                ) : (
                  <AlertTriangle size={11} style={{ color: "#FF8A80" }} />
                )}
                <span className="text-[var(--text-secondary)]">
                  bind ·{" "}
                  <span
                    style={{
                      color:
                        stream.status === "success"
                          ? "#A5D6A7"
                          : stream.status === "failed"
                            ? "#FF8A80"
                            : stream.status === "lost"
                              ? "#FFB74D"
                              : "#9E9E9E",
                    }}
                  >
                    {stream.status}
                    {stream.exitCode !== null && ` (exit ${stream.exitCode})`}
                  </span>
                </span>
              </div>
              <ul
                className="font-mono text-[11px] leading-relaxed p-3 m-0 max-h-[180px] overflow-y-auto"
                style={{ color: "#E0E0E0", listStyle: "none" }}
              >
                {stream.lines
                  .filter((l) => l.length > 0)
                  .map((line, i) => (
                    <li key={`${i}-${line}`} className="truncate">
                      {line}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2 flex-shrink-0"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <button
            onClick={onCancel}
            disabled={inFlight}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-60"
            style={{
              background: "transparent",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "var(--accent-primary)" }}
          >
            {inFlight && <Loader2 size={12} className="animate-spin" />}
            Bind folder
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileManager;
