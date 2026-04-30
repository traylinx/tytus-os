// ============================================================
// Pod Inspector — Fleet Overview + per-pod tabs (Phase 3b chunk 2)
// ============================================================
//
// Top-level layout:
//
//   ┌─ tab strip ────────────────────────────────────┐
//   │ ◀ Fleet │ Pod 02 ◉ × │ Pod 04 × │              │
//   ├────────────────────────────────────────────────┤
//   │  Fleet view OR PodTab body                     │
//   └────────────────────────────────────────────────┘
//
// Fleet view: sortable table of agents + included pods, lazy
// /api/pod/ready probes, search, sort.
//
// PodTab body: status header (dot + agent + units + key fingerprint),
// URL grid (api/public/ui with copy + reveal), env (user_key reveal),
// actions (Restart streamed via run-streamed, Open via /api/pod/open).
// Doctor and the destructive actions (Uninstall / Revoke) ship in a
// later chunk — per-pod doctor is also a known daemon gap (manifest
// §3.7) and revoke needs a typed-name confirmation.
//
// Sort modes (manifest §3.2):
//   - "Needs attention" (default): offline > degraded > running > healthy
//   - "Pod ID": ascending
//
// Status pill colors mirror manifest §11.5; v1 only renders ready /
// not-ready / probe-failed / included since /api/pod/ready is the
// only signal the daemon currently exposes.

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Sparkles,
  Search,
  Loader2,
  ExternalLink,
  RefreshCw,
  Rocket,
  AlertTriangle,
  X,
  Power,
  Copy,
  Eye,
  EyeOff,
  Check,
  Stethoscope,
  Square,
  Trash2,
  Skull,
  KeyRound,
  Star,
  ScrollText,
  Variable,
} from "lucide-react";
import LogPane from "@/components/LogPane";
import PodEnvPane from "@/components/PodEnvPane";
import AilGatewayCard from "@/components/AilGatewayCard";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import { useCurrentWindowArgs } from "@/hooks/useCurrentWindow";
import { useJobStream } from "@/hooks/useJobStream";
import { usePinnedPods, PIN_CAP } from "@/hooks/usePinnedPods";
import { useNotifications } from "@/hooks/useOSStore";
import { navigate } from "@/lib/router";
import {
  maskSecret,
  maskTokenUrl,
  revealSecret,
  revealTokenUrl,
} from "@/lib/secrets";
import type {
  Agent,
  AgentStatus,
  IncludedPod,
  PodReadiness,
} from "@/types/daemon";
import type { DaemonClient } from "@/lib/daemon";
import type { WindowArgs } from "@/types";

type SortMode = "attention" | "pod_id";

interface FleetRow {
  kind: "agent" | "included";
  pod_id: string;
  agent_type: string;
  units: number;
  agent?: Agent;
  included?: IncludedPod;
}

type ReadyState = {
  status: "probing" | "ready" | "not_ready" | "probe_failed" | "included";
  reason?: string;
  overall?: PodReadiness["overall"];
  openEnabled?: boolean;
  stages?: PodReadiness["stages"];
};

const firstReadinessIssue = (readiness: PodReadiness) =>
  readiness.stages.find((stage) =>
    ["failed", "starting", "unknown"].includes(stage.status),
  ) ??
  readiness.stages.find((stage) => stage.status === "degraded") ??
  null;

const readinessToReadyState = (readiness: PodReadiness): ReadyState => {
  const issue = firstReadinessIssue(readiness);
  if (readiness.open_enabled) {
    return {
      status: "ready",
      reason:
        readiness.overall === "degraded"
          ? (issue?.detail ?? "Ready with degraded optional checks")
          : undefined,
      overall: readiness.overall,
      openEnabled: true,
      stages: readiness.stages,
    };
  }
  if (readiness.overall === "failed") {
    return {
      status: "not_ready",
      reason: issue?.detail ?? issue?.label ?? "Readiness failed",
      overall: readiness.overall,
      openEnabled: false,
      stages: readiness.stages,
    };
  }
  return {
    status: "not_ready",
    reason: issue?.detail ?? issue?.label ?? "Starting",
    overall: readiness.overall,
    openEnabled: false,
    stages: readiness.stages,
  };
};

/**
 * Bridge from the server-derived AgentStatus enum (≥ 0.7.0 daemons)
 * to the local ReadyState shape this component already renders. Lets
 * us drop /api/pod/ready polling without rewriting FleetView /
 * TabStrip / PodTab — they keep consuming readyByPod as before.
 */
const agentStatusToReadyState = (s: AgentStatus): ReadyState => {
  switch (s) {
    case "ready":
      return { status: "ready" };
    case "starting":
      return { status: "not_ready", reason: "Starting" };
    case "unhealthy":
      return { status: "not_ready", reason: "Unhealthy" };
    case "stopped":
      return { status: "probe_failed", reason: "Container down" };
    case "unknown":
    default:
      return { status: "probing" };
  }
};

const STATUS_RANK: Record<ReadyState["status"], number> = {
  probe_failed: 4,
  not_ready: 3,
  probing: 2,
  ready: 1,
  included: 0,
};

const STATUS_VISUAL: Record<
  ReadyState["status"],
  { color: string; label: string }
> = {
  probing: { color: "var(--text-secondary)", label: "Probing…" },
  ready: { color: "var(--accent-success)", label: "Running" },
  not_ready: { color: "var(--accent-warning)", label: "Not ready" },
  probe_failed: { color: "var(--accent-error)", label: "Offline" },
  included: { color: "var(--text-secondary)", label: "Included" },
};

// ============================================================
// Top-level component — owns tab state + ready probe map
// ============================================================

const PodInspector: FC = () => {
  const { dispatch } = useOS();
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const windowArgs = useCurrentWindowArgs();
  const routeAction = windowArgs?.podAction;

  // Tab state — 'fleet' is always the leftmost tab; per-pod tabs are
  // appended in click order. Closing a non-fleet tab focuses fleet.
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>("fleet");

  // Fleet-wide ready probe map. PodTab also reads this; bumping
  // readyNonce re-fires probes for every open row.
  const [readyByPod, setReadyByPod] = useState<Map<string, ReadyState>>(
    () => new Map(),
  );
  const [readyNonce, setReadyNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [errToast, setErrToast] = useState<string | null>(null);
  const pins = usePinnedPods();

  const onTogglePin = useCallback(
    (podId: string) => {
      const wasPinned = pins.has(podId);
      const didPin = pins.toggle(podId);
      if (!wasPinned && !didPin) {
        setErrToast(`Pin limit reached (${PIN_CAP}). Unpin one first.`);
      }
    },
    [pins],
  );

  const rows: FleetRow[] = useMemo(() => {
    const out: FleetRow[] = [];
    if (!daemon.state) return out;
    for (const a of daemon.state.agents) {
      out.push({
        kind: "agent",
        pod_id: a.pod_id,
        agent_type: a.agent_type,
        units: a.units,
        agent: a,
      });
    }
    // Included (AIL gateway) pods are NOT added to the fleet table —
    // they get their own dedicated AilGatewayCard above the table so
    // the URLs / copy-env / snippets / Open-in are first-class instead
    // of buried in a "—" row.
    return out;
  }, [daemon.state]);

  // Per-pod readiness. Prefer the structured route because it carries
  // `open_enabled` + exact stage diagnostics. Legacy /api/pod/ready is only
  // a fallback for older daemons.
  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setReadyByPod((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        if (r.kind === "included") {
          next.set(r.pod_id, { status: "included" });
        } else if (r.agent?.status !== undefined) {
          // Immediate optimistic state while structured readiness loads.
          next.set(r.pod_id, agentStatusToReadyState(r.agent.status));
        } else if (!next.has(r.pod_id)) {
          next.set(r.pod_id, { status: "probing" });
        }
      }
      return next;
    });

    const promises = rows
      .filter((r) => r.kind === "agent")
      .map(async (r) => {
        const readiness = await client.getPodReadiness(r.pod_id);
        if (cancelled) return;
        if (readiness.ok) {
          setReadyByPod((prev) => {
            const next = new Map(prev);
            next.set(r.pod_id, readinessToReadyState(readiness.value));
            return next;
          });
          return;
        }

        if (r.agent?.status !== undefined) return;

        const probe = await client.getPodReady(r.pod_id);
        if (cancelled) return;
        setReadyByPod((prev) => {
          const next = new Map(prev);
          if (!probe.ok) {
            next.set(r.pod_id, {
              status: "probe_failed",
              reason: probe.error.message,
            });
          } else if (probe.value.ready) {
            next.set(r.pod_id, { status: "ready" });
          } else {
            next.set(r.pod_id, {
              status: "not_ready",
              reason: probe.value.reason || "Not ready",
            });
          }
          return next;
        });
      });
    Promise.allSettled(promises);

    return () => {
      cancelled = true;
    };
  }, [client, rows, readyNonce]);

  // Auto-prune closed tabs when the underlying pod disappears (e.g.
  // user revoked from another surface). Don't keep stale references.
  // Deliberate setState-in-effect: we're synchronizing local UI state
  // with the result of an external poll.
  useEffect(() => {
    if (!daemon.state) return;
    const liveIds = new Set(daemon.state.agents.map((a) => a.pod_id));
    /* eslint-disable react-hooks/set-state-in-effect */
    setOpenTabs((prev) => prev.filter((p) => liveIds.has(p)));
    setActiveTab((prev) =>
      prev !== "fleet" && !liveIds.has(prev) ? "fleet" : prev,
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [daemon.state]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    daemon.refresh();
    setReadyNonce((n) => n + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, [daemon]);

  const onAllocate = useCallback(() => {
    dispatch({ type: "OPEN_WINDOW", appId: "settings" });
    navigate({
      kind: "settings",
      section: "agents",
      params: new URLSearchParams(),
    });
  }, [dispatch]);

  const openPodTab = useCallback((podId: string) => {
    setOpenTabs((prev) => (prev.includes(podId) ? prev : [...prev, podId]));
    setActiveTab(podId);
  }, []);

  const consumedRouteRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!routeAction?.podId) return;
    const key = `${windowArgs?.routeNonce ?? "no-nonce"}:${routeAction.podId}:${routeAction.action}`;
    if (consumedRouteRef.current.has(key)) return;
    consumedRouteRef.current.add(key);
    openPodTab(routeAction.podId);
  }, [openPodTab, routeAction, windowArgs?.routeNonce]);

  const closePodTab = useCallback((podId: string) => {
    setOpenTabs((prev) => prev.filter((p) => p !== podId));
    setActiveTab((prev) => (prev === podId ? "fleet" : prev));
  }, []);

  // Find the agent for the active per-pod tab.
  const activeAgent =
    activeTab !== "fleet"
      ? daemon.state?.agents.find((a) => a.pod_id === activeTab)
      : undefined;

  return (
    <div
      className="flex flex-col h-full relative"
      style={{ background: "var(--bg-window)" }}
    >
      <TabStrip
        tabs={openTabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
        onClose={closePodTab}
        agentsByPod={
          daemon.state
            ? new Map(daemon.state.agents.map((a) => [a.pod_id, a]))
            : new Map()
        }
        readyByPod={readyByPod}
        pinnedPods={pins.pinned}
      />

      {activeTab === "fleet" && (
        <div className="flex-1 flex flex-col min-h-0">
          {daemon.state?.included.map((inc) => (
            <AilGatewayCard
              key={`ail-${inc.pod_id}`}
              included={inc}
              client={client}
              onErr={setErrToast}
              onOpenApiTester={() =>
                dispatch({
                  type: "OPEN_OR_FOCUS_WINDOW",
                  appId: "apitester",
                  args: { apiTester: { collection: "ail" } },
                })
              }
              onOpenTerminalDocs={() =>
                dispatch({
                  type: "OPEN_OR_FOCUS_WINDOW",
                  appId: "terminal",
                  title: "Terminal — AIL docs",
                  args: { terminal: { command: "tytus", args: ["llm-docs"] } },
                })
              }
              onOpenTerminalChat={() =>
                dispatch({
                  type: "OPEN_OR_FOCUS_WINDOW",
                  appId: "terminal",
                  title: "Terminal — AIL chat",
                  args: { terminal: { command: "tytus", args: ["chat"] } },
                })
              }
            />
          ))}
          <FleetView
            rows={rows}
            readyByPod={readyByPod}
            state={daemon.state}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onAllocate={onAllocate}
            onOpenTab={openPodTab}
            onErr={setErrToast}
            client={client}
            isPinned={pins.has}
            onTogglePin={onTogglePin}
          />
        </div>
      )}

      {activeTab !== "fleet" && activeAgent && (
        <PodTab
          agent={activeAgent}
          ready={readyByPod.get(activeAgent.pod_id)}
          client={client}
          onError={setErrToast}
          isPinned={pins.has(activeAgent.pod_id)}
          onTogglePin={() => onTogglePin(activeAgent.pod_id)}
          routeAction={
            routeAction?.podId === activeAgent.pod_id ? routeAction : undefined
          }
          routeNonce={windowArgs?.routeNonce}
        />
      )}

      {activeTab !== "fleet" && !activeAgent && (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
          Pod {activeTab} is no longer allocated.
        </div>
      )}

      {errToast && (
        <FleetErrorToast
          message={errToast}
          onDismiss={() => setErrToast(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// Tab strip
// ============================================================

interface TabStripProps {
  tabs: string[];
  activeTab: string;
  onSelect: (tab: string) => void;
  onClose: (podId: string) => void;
  agentsByPod: Map<string, Agent>;
  readyByPod: Map<string, ReadyState>;
  pinnedPods: string[];
}

const TabStrip: FC<TabStripProps> = ({
  tabs,
  activeTab,
  onSelect,
  onClose,
  agentsByPod,
  readyByPod,
  pinnedPods,
}) => (
  <div
    className="flex items-stretch flex-shrink-0 overflow-x-auto"
    style={{
      background: "var(--bg-titlebar, rgba(255,255,255,0.02))",
      borderBottom: "1px solid var(--border-subtle)",
    }}
  >
    <button
      onClick={() => onSelect("fleet")}
      className="flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors flex-shrink-0"
      style={{
        background: activeTab === "fleet" ? "var(--bg-window)" : "transparent",
        color:
          activeTab === "fleet"
            ? "var(--accent-primary)"
            : "var(--text-secondary)",
        borderRight: "1px solid var(--border-subtle)",
        borderTop:
          activeTab === "fleet"
            ? "2px solid var(--accent-primary)"
            : "2px solid transparent",
      }}
    >
      <Box size={12} />
      Fleet
    </button>
    {tabs.map((podId) => {
      const agent = agentsByPod.get(podId);
      const ready = readyByPod.get(podId);
      const visual = ready ? STATUS_VISUAL[ready.status] : null;
      const active = activeTab === podId;
      const isPinned = pinnedPods.includes(podId);
      return (
        <div
          key={podId}
          className="flex items-stretch flex-shrink-0"
          style={{
            background: active ? "var(--bg-window)" : "transparent",
            borderRight: "1px solid var(--border-subtle)",
            borderTop: active
              ? "2px solid var(--accent-primary)"
              : "2px solid transparent",
          }}
        >
          <button
            onClick={() => onSelect(podId)}
            className="flex items-center gap-2 pl-4 pr-2 py-2 text-xs font-medium transition-colors"
            style={{
              color: active ? "var(--accent-primary)" : "var(--text-secondary)",
            }}
          >
            {isPinned && (
              <Star
                size={10}
                className="flex-shrink-0"
                style={{
                  color: "var(--accent-warning)",
                  fill: "var(--accent-warning)",
                }}
              />
            )}
            {visual && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: visual.color }}
              />
            )}
            Pod {podId}
            {agent && (
              <span
                className="text-[10px] opacity-70"
                style={{ color: "var(--text-secondary)" }}
              >
                · {agent.agent_type}
              </span>
            )}
          </button>
          <button
            onClick={() => onClose(podId)}
            aria-label={`Close pod ${podId} tab`}
            className="px-2 transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={11} />
          </button>
        </div>
      );
    })}
  </div>
);

// ============================================================
// Fleet view — table + search + sort + empty state
// ============================================================

interface FleetViewProps {
  rows: FleetRow[];
  readyByPod: Map<string, ReadyState>;
  state: import("@/types/daemon").StateSnapshot | null;
  refreshing: boolean;
  onRefresh: () => void;
  onAllocate: () => void;
  onOpenTab: (podId: string) => void;
  onErr: (msg: string) => void;
  client: DaemonClient;
  isPinned: (podId: string) => boolean;
  onTogglePin: (podId: string) => void;
}

const FleetView: FC<FleetViewProps> = ({
  rows,
  readyByPod,
  state,
  refreshing,
  onRefresh,
  onAllocate,
  onOpenTab,
  onErr,
  client,
  isPinned,
  onTogglePin,
}) => {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("attention");
  const [openingPod, setOpeningPod] = useState<string | null>(null);
  const [confirmRestartAll, setConfirmRestartAll] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    done: number;
    failed: number;
  } | null>(null);

  // Sequential — manifest §11.7 explicitly calls out NOT-parallel:
  // the daemon doesn't promise concurrency safety on per-pod actions,
  // and serialising keeps log output sane.
  const runRestartAll = useCallback(async () => {
    setConfirmRestartAll(false);
    const targets = rows.filter((r) => r.kind === "agent").map((r) => r.pod_id);
    if (targets.length === 0) return;
    setBatchProgress({ total: targets.length, done: 0, failed: 0 });
    let failed = 0;
    for (const podId of targets) {
      const r = await client.postPodRestart(podId);
      if (!r.ok) {
        failed += 1;
        onErr(`Pod ${podId} restart: ${r.error.message}`);
      }
      setBatchProgress((prev) =>
        prev ? { ...prev, done: prev.done + 1, failed: failed } : prev,
      );
    }
    // Hold the final summary for a beat so the user sees the completion
    // count before the toast disappears.
    setTimeout(() => setBatchProgress(null), 2400);
  }, [rows, client, onErr]);

  const restartableCount = rows.filter((r) => r.kind === "agent").length;
  const batchInFlight =
    batchProgress !== null && batchProgress.done < batchProgress.total;

  const onOpenAgentUi = useCallback(
    async (podId: string) => {
      setOpeningPod(podId);
      const r = await client.postPodOpen(podId);
      setOpeningPod((p) => (p === podId ? null : p));
      if (!r.ok) onErr(`Couldn't open pod ${podId}: ${r.error.message}`);
    },
    [client, onErr],
  );

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = q
      ? rows.filter(
          (r) =>
            r.pod_id.toLowerCase().includes(q) ||
            r.agent_type.toLowerCase().includes(q),
        )
      : [...rows];

    // Pinned pods always sort above non-pinned, regardless of mode.
    const pinSort = (a: FleetRow, b: FleetRow): number => {
      const pa = isPinned(a.pod_id) ? 0 : 1;
      const pb = isPinned(b.pod_id) ? 0 : 1;
      return pa - pb;
    };

    if (sortMode === "attention") {
      out.sort((a, b) => {
        const p = pinSort(a, b);
        if (p !== 0) return p;
        const sa = readyByPod.get(a.pod_id)?.status ?? "probing";
        const sb = readyByPod.get(b.pod_id)?.status ?? "probing";
        const r = STATUS_RANK[sb] - STATUS_RANK[sa];
        if (r !== 0) return r;
        return a.pod_id.localeCompare(b.pod_id);
      });
    } else {
      out.sort((a, b) => {
        const p = pinSort(a, b);
        if (p !== 0) return p;
        return a.pod_id.localeCompare(b.pod_id);
      });
    }

    return out;
  }, [rows, search, sortMode, readyByPod, isPinned]);

  const isEmpty = !state || rows.length === 0;

  return (
    <>
      <div
        className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <Box size={18} className="text-[var(--accent-primary)]" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Fleet Overview
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            {state ? (
              <>
                {state.agents.length} allocated · {state.included.length}{" "}
                included · {state.units_used}/{state.units_limit} units
              </>
            ) : (
              "Loading state…"
            )}
          </div>
        </div>
        {restartableCount > 1 && (
          <button
            onClick={() => setConfirmRestartAll(true)}
            disabled={batchInFlight}
            title={`Restart ${restartableCount} allocated pods sequentially`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-colors disabled:opacity-60"
            style={{
              background: "var(--bg-hover, rgba(255,255,255,0.04))",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
            }}
          >
            <Power size={11} />
            Restart all
          </button>
        )}
        <button
          onClick={onRefresh}
          aria-label="Refresh"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-colors"
          style={{
            background: "var(--bg-hover, rgba(255,255,255,0.04))",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
          }}
        >
          <RefreshCw
            size={11}
            className={refreshing ? "animate-spin" : undefined}
          />
          Refresh
        </button>
        <button
          onClick={onAllocate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
          style={{ background: "var(--accent-primary)" }}
        >
          + Allocate
        </button>
      </div>

      {!isEmpty && (
        <div
          className="px-5 py-2 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div
            className="flex items-center gap-2 flex-1 px-2.5 py-1 rounded-md"
            style={{ background: "var(--bg-input)" }}
          >
            <Search size={12} className="text-[var(--text-secondary)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pods…"
              className="flex-1 bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]"
            />
          </div>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="text-xs rounded-md px-2 py-1 outline-none"
            style={{
              background: "var(--bg-input)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }}
          >
            <option value="attention">Sort: Needs attention</option>
            <option value="pod_id">Sort: Pod ID</option>
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isEmpty && (
          <div className="h-full flex items-center justify-center p-8">
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
                No pods yet
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-[300px] leading-relaxed">
                Once you allocate a pod, it'll appear here with live status,
                links, and per-pod actions.
              </div>
              <button
                onClick={onAllocate}
                className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
                style={{ background: "var(--accent-primary)" }}
              >
                Allocate your first pod →
              </button>
            </div>
          </div>
        )}

        {!isEmpty && (
          <table className="w-full text-xs">
            <thead
              className="text-[10px] uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <th
                  className="text-center px-2 py-2 font-medium"
                  aria-label="Pin"
                ></th>
                <th className="text-left px-3 py-2 font-medium">Pod</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Agent</th>
                <th className="text-right px-3 py-2 font-medium">Units</th>
                <th className="text-right px-5 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row) => {
                const ready = readyByPod.get(row.pod_id) ?? {
                  status: "probing" as const,
                };
                const visual = STATUS_VISUAL[ready.status];
                const isAgent = row.kind === "agent";
                const canOpen = isAgent && ready.status === "ready";
                return (
                  <tr
                    key={`${row.kind}-${row.pod_id}`}
                    className="transition-colors cursor-pointer"
                    style={{ borderBottom: "1px solid var(--border-subtle)" }}
                    onClick={() => isAgent && onOpenTab(row.pod_id)}
                  >
                    <td
                      className="px-2 py-2.5 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isAgent && (
                        <button
                          onClick={() => onTogglePin(row.pod_id)}
                          aria-label={
                            isPinned(row.pod_id)
                              ? `Unpin pod ${row.pod_id}`
                              : `Pin pod ${row.pod_id}`
                          }
                          className="p-0.5 rounded-sm transition-colors"
                          style={{
                            color: isPinned(row.pod_id)
                              ? "var(--accent-warning)"
                              : "var(--text-disabled, rgba(255,255,255,0.25))",
                          }}
                          title={isPinned(row.pod_id) ? "Unpin" : "Pin to top"}
                        >
                          <Star
                            size={12}
                            style={{
                              fill: isPinned(row.pod_id)
                                ? "var(--accent-warning)"
                                : "none",
                            }}
                          />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-[var(--text-primary)] font-medium">
                        Pod {row.pod_id}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex items-center gap-1.5"
                        title={ready.reason ?? visual.label}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: visual.color }}
                        />
                        <span style={{ color: visual.color }}>
                          {visual.label}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[var(--text-primary)]">
                        {row.kind === "included" ? (
                          <Sparkles
                            size={12}
                            className="text-[var(--text-secondary)]"
                          />
                        ) : (
                          <Box
                            size={12}
                            className="text-[var(--accent-primary)]"
                          />
                        )}
                        {row.agent_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[var(--text-secondary)]">
                      {row.kind === "included" ? "—" : row.units}
                    </td>
                    <td
                      className="px-5 py-2.5 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isAgent && (
                        <button
                          onClick={() => onOpenAgentUi(row.pod_id)}
                          disabled={openingPod === row.pod_id || !canOpen}
                          title={
                            canOpen
                              ? row.agent_type === "hermes"
                                ? "Open Hermes dashboard"
                                : "Open agent UI"
                              : `Pod is not ready yet: ${ready.reason ?? visual.label}`
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-60"
                          style={{
                            background:
                              "var(--bg-hover, rgba(255,255,255,0.04))",
                            border: "1px solid var(--border-default)",
                            color: "var(--text-primary)",
                          }}
                        >
                          {openingPod === row.pod_id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <ExternalLink size={11} />
                          )}
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredSorted.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-6 text-center text-[var(--text-secondary)]"
                  >
                    No pods match "{search}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {confirmRestartAll && (
        <RestartAllConfirmModal
          count={restartableCount}
          onCancel={() => setConfirmRestartAll(false)}
          onConfirm={runRestartAll}
        />
      )}

      {batchProgress && <BatchProgressToast progress={batchProgress} />}
    </>
  );
};

// ============================================================
// PodTab — per-pod view with status / URLs / env / actions
// ============================================================

interface PodTabProps {
  agent: Agent;
  ready: ReadyState | undefined;
  client: DaemonClient;
  onError: (msg: string) => void;
  isPinned: boolean;
  onTogglePin: () => void;
  routeAction?: WindowArgs["podAction"];
  routeNonce?: string;
}

const PodTab: FC<PodTabProps> = ({
  agent,
  ready,
  client,
  onError,
  isPinned,
  onTogglePin,
  routeAction,
  routeNonce,
}) => {
  const daemon = useDaemonStateContext();
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [uiRevealed, setUiRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<{
    id: string;
    action: string;
  } | null>(null);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  // Daemon-restart detection. The job registry is in-memory, so a
  // daemon restart silently invalidates every active job_id — without
  // this hook the user would keep staring at a stuck "subscribing…"
  // pane forever. We track the boot timestamp and drop stale state
  // (activeJob + cancelling flag) the moment it changes.
  const daemonBootedAt = daemon.version?.daemon_started_at ?? null;
  const lastSeenBootRef = useRef<number | null>(null);
  useEffect(() => {
    if (daemonBootedAt === null) return;
    if (lastSeenBootRef.current === null) {
      lastSeenBootRef.current = daemonBootedAt;
      return;
    }
    if (lastSeenBootRef.current !== daemonBootedAt) {
      lastSeenBootRef.current = daemonBootedAt;
      setActiveJob(null);
      setSubmittingAction(null);
      onError(
        "Tray daemon restarted. In-flight pod actions were cleared — re-run if needed.",
      );
    }
  }, [daemonBootedAt, onError]);

  const visual = ready ? STATUS_VISUAL[ready.status] : STATUS_VISUAL.probing;
  const isReady = ready?.status === "ready";

  const copyToClipboard = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
    } catch {
      // noop in non-secure contexts
    }
  }, []);

  // Confirmation modals — only Uninstall and Revoke open one. Restart,
  // Doctor, and Stop forwarder fire immediately (each is reversible by
  // re-running its inverse).
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);

  const onOpenAgent = useCallback(async () => {
    setSubmittingAction("open");
    const r = await client.postPodOpen(agent.pod_id);
    setSubmittingAction(null);
    if (!r.ok) onError(`Couldn't open pod: ${r.error.message}`);
  }, [client, agent.pod_id, onError]);

  const streamUrl = activeJob ? client.jobStreamUrl(activeJob.id) : null;
  const stream = useJobStream({ url: streamUrl });
  const streamDone =
    stream.status === "success" ||
    stream.status === "failed" ||
    stream.status === "lost";

  const isJobBusy = activeJob !== null && !streamDone;

  // Generic per-pod streamed action launcher. The action name maps to
  // the daemon's run-streamed allowlist; we serialize through one
  // activeJob slot so the user always sees a single live log pane.
  const runStreamedAction = useCallback(
    async (action: string, label: string) => {
      if (activeJob !== null && !streamDone) {
        onError(`Pod ${agent.pod_id} already has a running action.`);
        return;
      }
      setSubmittingAction(action);
      const r = await client.postPodRunStreamed(agent.pod_id, action);
      setSubmittingAction(null);
      if (!r.ok) {
        onError(`Couldn't start ${label}: ${r.error.message}`);
        return;
      }
      setActiveJob({ id: r.value.job_id, action });
    },
    [activeJob, client, agent.pod_id, onError, streamDone],
  );

  const onRestart = useCallback(
    () => runStreamedAction("restart", "restart"),
    [runStreamedAction],
  );
  const onStopForwarder = useCallback(
    () => runStreamedAction("stop-forwarder", "forwarder stop"),
    [runStreamedAction],
  );
  // Tail the agent container's stdout/stderr. Bounded snapshot — the
  // CLI's `tytus logs --pod NN --lines 200` exits after printing,
  // so the stream pane terminates with `success`. Re-fire the action
  // for fresh lines (no live `-f` follow yet — daemon gap).
  const onShowLogs = useCallback(
    () => runStreamedAction("logs", "logs"),
    [runStreamedAction],
  );
  const onUninstallConfirmed = useCallback(() => {
    setConfirmUninstall(false);
    runStreamedAction("uninstall", "uninstall");
  }, [runStreamedAction]);
  const onRevokeConfirmed = useCallback(() => {
    setConfirmRevoke(false);
    runStreamedAction("revoke", "revoke");
  }, [runStreamedAction]);

  // Doctor — per-pod diagnostic via run-streamed `doctor` action
  // (closes manifest §3.7 gap). The CLI's `tytus doctor --pod NN`
  // calls Provider /pod/agent/status and prints container_status /
  // healthy / uptime / image / ports one line at a time so each
  // surfaces as a discrete `log` event in the JobStreamPane.
  const onDoctor = useCallback(
    () => runStreamedAction("doctor", "doctor"),
    [runStreamedAction],
  );

  const consumedRouteActionRef = useRef<Set<string>>(new Set());
  // Deliberate setState-in-effect via action callbacks: synchronising
  // Pod Inspector with a tray route. Destructive paths only open confirm.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!routeAction) return;
    const key = `${routeNonce ?? "no-nonce"}:${routeAction.podId}:${routeAction.action}`;
    if (consumedRouteActionRef.current.has(key)) return;
    consumedRouteActionRef.current.add(key);

    if (routeAction.podId !== agent.pod_id) return;
    if (routeAction.action === "overview") return;
    if (routeAction.action === "uninstall") {
      setConfirmUninstall(true);
      return;
    }
    if (routeAction.action === "revoke") {
      setConfirmRevoke(true);
      return;
    }

    if (isJobBusy) {
      onError(`Pod ${agent.pod_id} already has a running action.`);
      return;
    }
    if (routeAction.action === "output") {
      void onShowLogs();
      return;
    }
    if (routeAction.action === "restart") {
      void onRestart();
      return;
    }
    if (routeAction.action === "stop-forwarder") {
      void onStopForwarder();
    }
  }, [
    agent.pod_id,
    isJobBusy,
    onError,
    onRestart,
    onShowLogs,
    onStopForwarder,
    routeAction,
    routeNonce,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Refresh credentials — rotates the pod's user_key without
  // restarting the container. Uses dedicated /api/pod/refresh-creds
  // (run-streamed allowlist doesn't include this verb).
  const onRefreshCreds = useCallback(async () => {
    if (isJobBusy) {
      onError(`Pod ${agent.pod_id} already has a running action.`);
      return;
    }
    setSubmittingAction("refresh-creds");
    const r = await client.postPodRefreshCreds(agent.pod_id);
    setSubmittingAction(null);
    if (!r.ok) {
      onError(`Couldn't refresh creds: ${r.error.message}`);
      return;
    }
    setActiveJob({ id: r.value.job_id, action: "refresh-creds" });
  }, [client, agent.pod_id, isJobBusy, onError]);

  // Cancel — SIGTERMs the daemon child running this job. The SSE
  // stream closes naturally once the child dies; we just fire-and-
  // forget here. State stays in flight (button shows "Cancelling…")
  // until the natural Exit event flips streamDone.
  const [cancelling, setCancelling] = useState(false);
  const onCancelJob = useCallback(async () => {
    if (!activeJob || streamDone) return;
    setCancelling(true);
    const r = await client.postJobCancel(activeJob.id);
    setCancelling(false);
    if (!r.ok) {
      onError(`Couldn't cancel: ${r.error.message}`);
      return;
    }
    if (!r.value.cancelled && r.value.reason) {
      // Daemon said "already finished" or "no live process" — surface
      // it as a non-fatal hint via onError so the user knows the
      // request landed but didn't do anything.
      onError(`Cancel: ${r.value.reason}`);
    }
  }, [activeJob, streamDone, client, onError]);

  // Toast on restart success — phase 8.3 notification wiring. Other
  // streamed actions (doctor / stop-forwarder / uninstall / revoke /
  // refresh-creds) all show their state inside the per-pod log pane,
  // which the user is already looking at; restart is the one that
  // commonly runs while the user has tabbed away to do something else.
  const { addNotification } = useNotifications();
  const toastedJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeJob || stream.status !== "success") return;
    if (toastedJobRef.current === activeJob.id) return;
    toastedJobRef.current = activeJob.id;
    if (activeJob.action === "restart") {
      addNotification({
        appId: "pod-inspector",
        appName: "Pod Inspector",
        appIcon: "Power",
        title: `Pod ${agent.pod_id} restarted`,
        message: `${agent.agent_type} container is back up.`,
        isRead: false,
      });
    }
  }, [
    activeJob,
    stream.status,
    addNotification,
    agent.pod_id,
    agent.agent_type,
  ]);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
      {/* Status header */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Box size={28} className="text-[var(--accent-primary)]" />
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
            style={{
              background: visual.color,
              boxShadow: "0 0 0 2px var(--bg-window, #1E1E1E)",
            }}
            title={ready?.reason ?? visual.label}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
            {isPinned && (
              <Star
                size={14}
                style={{
                  color: "var(--accent-warning)",
                  fill: "var(--accent-warning)",
                }}
              />
            )}
            Pod {agent.pod_id} · {agent.agent_type}
          </div>
          <div className="text-[11px] mt-0.5">
            <span style={{ color: visual.color }}>{visual.label}</span>
            {ready?.reason && (
              <span className="text-[var(--text-secondary)]">
                {" "}
                — {ready.reason}
              </span>
            )}
            <span className="text-[var(--text-secondary)]">
              {" "}
              · {agent.units} unit{agent.units === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <button
          onClick={onTogglePin}
          aria-label={isPinned ? "Unpin pod" : "Pin pod"}
          title={
            isPinned
              ? "Unpin — pod sinks back into the default sort"
              : "Pin — keeps this pod at the top of the Fleet table"
          }
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-colors"
          style={{
            background: isPinned
              ? "rgba(255,193,7,0.12)"
              : "var(--bg-hover, rgba(255,255,255,0.04))",
            border: isPinned
              ? "1px solid rgba(255,193,7,0.30)"
              : "1px solid var(--border-default)",
            color: isPinned ? "#FFE082" : "var(--text-secondary)",
          }}
        >
          <Star
            size={11}
            style={{ fill: isPinned ? "var(--accent-warning)" : "none" }}
          />
          {isPinned ? "Pinned" : "Pin"}
        </button>
      </div>

      {ready?.stages && ready.stages.length > 0 && (
        <div
          className="rounded-lg p-3"
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.03))",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
              Readiness
            </div>
            <span
              className="text-[10px] uppercase tracking-wide"
              style={{
                color: ready.openEnabled
                  ? "var(--accent-success)"
                  : ready.overall === "failed"
                    ? "var(--accent-error)"
                    : "var(--accent-warning)",
              }}
            >
              {ready.openEnabled
                ? "Open enabled"
                : (ready.overall ?? visual.label)}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {ready.stages.map((stage) => (
              <div
                key={stage.id}
                className="flex items-start gap-2 text-[11px] min-w-0"
              >
                <span
                  className="mt-1 h-2 w-2 rounded-full flex-shrink-0"
                  style={{
                    background:
                      stage.status === "ok"
                        ? "var(--accent-success)"
                        : stage.status === "failed"
                          ? "var(--accent-error)"
                          : stage.status === "degraded"
                            ? "var(--accent-warning)"
                            : "var(--text-secondary)",
                  }}
                />
                <div className="min-w-0">
                  <span className="text-[var(--text-primary)]">
                    {stage.label}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {" "}
                    · {stage.status}
                  </span>
                  {stage.detail && (
                    <div
                      className="truncate text-[var(--text-secondary)]"
                      title={stage.detail}
                    >
                      {stage.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* URLs + env */}
      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--bg-card, rgba(255,255,255,0.03))",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          Connection
        </div>
        <div className="grid grid-cols-[80px_1fr_auto] gap-x-2 gap-y-2 text-[11px] items-center">
          <span className="text-[var(--text-secondary)]">API URL</span>
          <code
            className="font-mono text-[var(--text-primary)] truncate"
            style={{
              background: "rgba(255,255,255,0.03)",
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
            }}
            title={agent.api_url}
          >
            {agent.api_url}
          </code>
          <CopyBtn
            label="api"
            isCopied={copied === "api"}
            onClick={() => copyToClipboard("api", agent.api_url)}
          />

          <span className="text-[var(--text-secondary)]">Public</span>
          <code
            className="font-mono text-[var(--text-primary)] truncate"
            style={{
              background: "rgba(255,255,255,0.03)",
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
            }}
            title={agent.public_url}
          >
            {agent.public_url}
          </code>
          <CopyBtn
            label="public"
            isCopied={copied === "public"}
            onClick={() => copyToClipboard("public", agent.public_url)}
          />

          <span className="text-[var(--text-secondary)]">UI URL</span>
          <code
            className="font-mono text-[var(--text-primary)] truncate"
            style={{
              background: "rgba(255,255,255,0.03)",
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {uiRevealed
              ? revealTokenUrl(agent.ui_url, "user_gesture")
              : maskTokenUrl(agent.ui_url)}
          </code>
          <div className="flex items-center gap-1">
            <RevealBtn
              revealed={uiRevealed}
              onToggle={() => setUiRevealed((v) => !v)}
            />
            <CopyBtn
              label="ui"
              isCopied={copied === "ui"}
              onClick={() =>
                copyToClipboard(
                  "ui",
                  revealTokenUrl(agent.ui_url, "user_gesture"),
                )
              }
            />
          </div>

          <span className="text-[var(--text-secondary)]">Key</span>
          <code
            className="font-mono text-[var(--text-primary)] truncate"
            style={{
              background: "rgba(255,255,255,0.03)",
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {keyRevealed
              ? revealSecret(agent.user_key, "user_gesture")
              : maskSecret(agent.user_key)}
          </code>
          <div className="flex items-center gap-1">
            <RevealBtn
              revealed={keyRevealed}
              onToggle={() => setKeyRevealed((v) => !v)}
            />
            <CopyBtn
              label="key"
              isCopied={copied === "key"}
              onClick={() =>
                copyToClipboard(
                  "key",
                  revealSecret(agent.user_key, "user_gesture"),
                )
              }
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div>
        <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          Actions
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            label={
              agent.agent_type === "hermes" ? "Open dashboard" : "Open agent UI"
            }
            icon={<ExternalLink size={12} />}
            running={submittingAction === "open"}
            disabled={!isReady}
            title={
              isReady
                ? agent.agent_type === "hermes"
                  ? "Open Hermes dashboard"
                  : "Open agent UI"
                : `Pod is not ready yet: ${ready?.reason ?? visual.label}`
            }
            onClick={onOpenAgent}
          />
          <ActionButton
            label="Restart"
            icon={<Power size={12} />}
            running={
              submittingAction === "restart" ||
              (activeJob?.action === "restart" && !streamDone)
            }
            disabled={activeJob !== null && !streamDone}
            onClick={onRestart}
          />
          <ActionButton
            label="Doctor"
            icon={<Stethoscope size={12} />}
            title="Per-pod health check: container status, uptime, image, ports"
            running={
              submittingAction === "doctor" ||
              (activeJob?.action === "doctor" && !streamDone)
            }
            disabled={activeJob !== null && !streamDone}
            onClick={onDoctor}
          />
          <ActionButton
            label="Stop forwarder"
            icon={<Square size={12} />}
            running={
              submittingAction === "stop-forwarder" ||
              (activeJob?.action === "stop-forwarder" && !streamDone)
            }
            disabled={activeJob !== null && !streamDone}
            onClick={onStopForwarder}
          />
          <ActionButton
            label="Refresh creds"
            icon={<KeyRound size={12} />}
            title="Rotate the pod's user_key without restarting the container"
            running={
              submittingAction === "refresh-creds" ||
              (activeJob?.action === "refresh-creds" && !streamDone)
            }
            disabled={activeJob !== null && !streamDone}
            onClick={onRefreshCreds}
          />
          <ActionButton
            label="Logs"
            icon={<ScrollText size={12} />}
            title="Tail the last 200 lines of the agent container's stdout/stderr"
            running={
              submittingAction === "logs" ||
              (activeJob?.action === "logs" && !streamDone)
            }
            disabled={activeJob !== null && !streamDone}
            onClick={onShowLogs}
          />
          <ActionButton
            label={envOpen ? "Hide env" : "Env"}
            icon={<Variable size={12} />}
            title="Show the agent container's effective environment with each variable's source"
            onClick={() => setEnvOpen((v) => !v)}
          />
        </div>

        <div
          className="flex flex-wrap gap-2 mt-3 pt-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <div className="text-[10px] text-[var(--text-secondary)] w-full mb-1 uppercase tracking-wider">
            Destructive
          </div>
          <ActionButton
            label="Uninstall…"
            icon={<Trash2 size={12} />}
            destructive
            running={
              submittingAction === "uninstall" ||
              (activeJob?.action === "uninstall" && !streamDone)
            }
            disabled={activeJob !== null && !streamDone}
            onClick={() => setConfirmUninstall(true)}
          />
          <ActionButton
            label="Revoke…"
            icon={<Skull size={12} />}
            destructive
            running={
              submittingAction === "revoke" ||
              (activeJob?.action === "revoke" && !streamDone)
            }
            disabled={activeJob !== null && !streamDone}
            onClick={() => setConfirmRevoke(true)}
          />
        </div>
      </div>

      {/* Env pane (manifest A.exist A3.5) — opens beside / above the
          job stream and survives across actions. Operator-tier users
          can flip "Reveal secrets" to see real values. */}
      {envOpen && daemon.state && (
        <PodEnvPane
          client={client}
          podId={agent.pod_id}
          tier={daemon.state.tier}
          onClose={() => setEnvOpen(false)}
          onError={onError}
        />
      )}

      {/* Live job stream — appears below actions when one runs */}
      {activeJob && (
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: "var(--terminal-bg)",
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
            <div className="text-[var(--text-secondary)]">
              {activeJob.action === "logs"
                ? `Logs (last 200 lines, pod ${agent.pod_id})`
                : activeJob.action === "doctor"
                  ? `Doctor (pod ${agent.pod_id})`
                  : activeJob.action}{" "}
              ·{" "}
              <span
                style={{
                  color:
                    stream.status === "success"
                      ? "#A5D6A7"
                      : stream.status === "failed"
                        ? "#FF8A80"
                        : stream.status === "lost"
                          ? "#FFB74D"
                          : "var(--text-secondary)",
                }}
              >
                {stream.status}
                {stream.exitCode !== null && ` (exit ${stream.exitCode})`}
              </span>
            </div>
            {!streamDone && (
              <button
                onClick={onCancelJob}
                disabled={cancelling}
                className="px-2 py-0.5 rounded-sm text-[10px] transition-colors flex items-center gap-1 disabled:opacity-60"
                style={{
                  background: "rgba(244,67,54,0.10)",
                  color: "var(--accent-error)",
                  border: "1px solid rgba(244,67,54,0.30)",
                }}
                title="Send SIGTERM to the running command"
              >
                <X size={10} />
                {cancelling ? "Cancelling…" : "Cancel"}
              </button>
            )}
            {streamDone && (
              <div className="flex items-center gap-1.5">
                {activeJob.action === "logs" && (
                  <button
                    onClick={onShowLogs}
                    className="px-2 py-0.5 rounded-sm text-[10px] transition-colors flex items-center gap-1"
                    style={{
                      background: "var(--bg-hover, rgba(255,255,255,0.04))",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-default)",
                    }}
                    title="Re-fetch the trailing 200 lines"
                  >
                    <RefreshCw size={10} />
                    Refresh
                  </button>
                )}
                <button
                  onClick={() => setActiveJob(null)}
                  className="px-2 py-0.5 rounded-sm text-[10px] transition-colors"
                  style={{
                    background: "var(--bg-hover, rgba(255,255,255,0.04))",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
          <LogPane
            lines={stream.lines}
            status={stream.status}
            exitCode={stream.exitCode}
            failMessage={stream.failMessage}
            emptyText="Connecting to job stream…"
            maxLines={200}
            maxHeight={300}
            className="rounded-none border-0"
          />
        </div>
      )}

      {confirmUninstall && (
        <UninstallConfirmModal
          podId={agent.pod_id}
          agentType={agent.agent_type}
          onCancel={() => setConfirmUninstall(false)}
          onConfirm={onUninstallConfirmed}
        />
      )}

      {confirmRevoke && (
        <RevokeConfirmModal
          podId={agent.pod_id}
          agentType={agent.agent_type}
          units={agent.units}
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={onRevokeConfirmed}
        />
      )}
    </div>
  );
};

// ============================================================
// Reusable mini-components
// ============================================================

const CopyBtn: FC<{
  label: string;
  isCopied: boolean;
  onClick: () => void;
}> = ({ label, isCopied, onClick }) => (
  <button
    onClick={onClick}
    aria-label={`Copy ${label}`}
    className="p-1 rounded-sm transition-colors"
    style={{
      background: isCopied ? "rgba(76,175,80,0.18)" : "transparent",
      color: isCopied ? "#A5D6A7" : "var(--text-secondary)",
    }}
  >
    {isCopied ? <Check size={12} /> : <Copy size={12} />}
  </button>
);

const RevealBtn: FC<{
  revealed: boolean;
  onToggle: () => void;
}> = ({ revealed, onToggle }) => (
  <button
    onClick={onToggle}
    aria-label={revealed ? "Hide value" : "Show value"}
    className="p-1 rounded-sm transition-colors"
    style={{ background: "transparent", color: "var(--text-secondary)" }}
  >
    {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
  </button>
);

const ActionButton: FC<{
  label: string;
  icon: React.ReactNode;
  running?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  title?: string;
  onClick: () => void;
}> = ({ label, icon, running, disabled, destructive, title, onClick }) => (
  <button
    onClick={onClick}
    disabled={running || disabled}
    title={title}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-60"
    style={{
      background: destructive
        ? "rgba(244,67,54,0.10)"
        : "var(--bg-hover, rgba(255,255,255,0.04))",
      border: destructive
        ? "1px solid rgba(244,67,54,0.30)"
        : "1px solid var(--border-default)",
      color: destructive ? "var(--accent-error)" : "var(--text-primary)",
    }}
  >
    {running ? <Loader2 size={12} className="animate-spin" /> : icon}
    {label}
  </button>
);

// ============================================================
// Confirmation modals — soft (Uninstall) and hard (Revoke)
// ============================================================

const UninstallConfirmModal: FC<{
  podId: string;
  agentType: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ podId, agentType, onCancel, onConfirm }) => (
  <div
    className="fixed inset-0 z-[6000] flex items-center justify-center"
    style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
  >
    <div
      className="w-[440px] rounded-xl flex flex-col overflow-hidden"
      style={{
        background: "var(--bg-window, #1E1E1E)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
      }}
    >
      <div className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: "rgba(255,193,7,0.12)",
            border: "1px solid rgba(255,193,7,0.30)",
          }}
        >
          <Trash2 size={16} style={{ color: "var(--accent-warning)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Uninstall pod {podId}?
          </div>
          <div className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            This removes the {agentType} container but{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              keeps the allocation
            </strong>
            . You can re-install the agent later without spending another unit.
            Workspace data inside the container will be lost.
          </div>
        </div>
      </div>
      <div
        className="px-5 py-3 flex items-center justify-end gap-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
          style={{
            background: "transparent",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors"
          style={{ background: "var(--accent-warning)" }}
        >
          Uninstall
        </button>
      </div>
    </div>
  </div>
);

const RevokeConfirmModal: FC<{
  podId: string;
  agentType: string;
  units: number;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ podId, agentType, units, onCancel, onConfirm }) => {
  // Hard confirm: user must type the exact phrase. Mirrors the lesson
  // from the 2026-04-28 incident where a curl POST /api/logout wiped
  // 2 nemoclaw pods server-side. Revoke is the per-pod equivalent —
  // never let a stray click trigger it.
  const expected = `pod ${podId}`;
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === expected;

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-[480px] rounded-xl flex flex-col overflow-hidden"
        style={{
          background: "var(--bg-window, #1E1E1E)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: "rgba(244,67,54,0.12)",
              border: "1px solid rgba(244,67,54,0.30)",
            }}
          >
            <Skull size={18} style={{ color: "var(--accent-error)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              Revoke pod {podId}?
            </div>
            <div className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
              Revoking the {agentType} pod{" "}
              <strong style={{ color: "var(--accent-error)" }}>
                permanently destroys it
              </strong>{" "}
              and frees its {units} unit{units === 1 ? "" : "s"} back to your
              plan budget. Workspace data on the pod cannot be recovered.
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-3">
              Type{" "}
              <code
                className="font-mono px-1 py-0.5 rounded-sm"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                {expected}
              </code>{" "}
              to confirm:
            </div>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-2 w-full px-3 py-1.5 rounded-md text-xs font-mono outline-none"
              style={{
                background: "var(--bg-input)",
                color: "var(--text-primary)",
                border: matches
                  ? "1px solid rgba(244,67,54,0.50)"
                  : "1px solid var(--border-default)",
              }}
            />
          </div>
        </div>
        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: "transparent",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches}
            className="px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--accent-error)" }}
          >
            Revoke pod {podId} permanently
          </button>
        </div>
      </div>
    </div>
  );
};

const RestartAllConfirmModal: FC<{
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ count, onCancel, onConfirm }) => (
  <div
    className="fixed inset-0 z-[6000] flex items-center justify-center"
    style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
  >
    <div
      className="w-[440px] rounded-xl flex flex-col overflow-hidden"
      style={{
        background: "var(--bg-window, #1E1E1E)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
      }}
    >
      <div className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: "rgba(124,77,255,0.12)",
            border: "1px solid rgba(124,77,255,0.30)",
          }}
        >
          <Power size={16} style={{ color: "var(--accent-primary)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Restart {count} pods?
          </div>
          <div className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            Each pod will be restarted sequentially via{" "}
            <code
              className="font-mono px-1 py-0.5 rounded-sm"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              tytus restart --pod NN
            </code>
            . Active workloads on each pod will be interrupted briefly.
          </div>
        </div>
      </div>
      <div
        className="px-5 py-3 flex items-center justify-end gap-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
          style={{
            background: "transparent",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors"
          style={{ background: "var(--accent-primary)" }}
        >
          Restart {count} pods
        </button>
      </div>
    </div>
  </div>
);

const BatchProgressToast: FC<{
  progress: { total: number; done: number; failed: number };
}> = ({ progress }) => {
  const inFlight = progress.done < progress.total;
  const pct = Math.round((progress.done / progress.total) * 100);
  const success = progress.done - progress.failed;
  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-md text-xs flex flex-col items-stretch gap-2 min-w-[280px]"
      style={{
        background: "rgba(30,30,30,0.95)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        zIndex: 10,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-primary)] font-medium">
          {inFlight
            ? `Restarting pods… ${progress.done}/${progress.total}`
            : `Done · ${success} succeeded${progress.failed > 0 ? ` · ${progress.failed} failed` : ""}`}
        </span>
        {inFlight && (
          <Loader2
            size={12}
            className="animate-spin text-[var(--text-secondary)]"
          />
        )}
      </div>
      <div
        className="h-1 rounded-full overflow-hidden"
        style={{ background: "var(--border-subtle)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: progress.failed > 0 ? "#FFC107" : "#4CAF50",
          }}
        />
      </div>
    </div>
  );
};

const FleetErrorToast: FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => {
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (dismissedRef.current) return;
    const t = setTimeout(() => {
      dismissedRef.current = true;
      onDismiss();
    }, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-md text-xs flex items-center gap-2"
      style={{
        background: "rgba(244,67,54,0.92)",
        color: "#fff",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        zIndex: 10,
      }}
    >
      <AlertTriangle size={12} />
      {message}
    </div>
  );
};

// Named exports for unit tests. Keeps the modals' destructive-guard
// behavior under direct test coverage (the typed-name confirm in
// RevokeConfirmModal is the response to the 2026-04-28 logout-wipe
// incident — it must never silently regress).
export { RevokeConfirmModal, UninstallConfirmModal };

export default PodInspector;
