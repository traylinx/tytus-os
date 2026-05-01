// ============================================================
// System Settings — Full system preferences panel
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Palette,
  Bell,
  User,
  Globe2,
  Eye,
  Info,
  Search,
  Check,
  Server,
  LogOut,
  Power,
  Loader2,
  CreditCard,
  Box,
  Sparkles,
  ExternalLink,
  AlertTriangle,
  X,
  Copy,
  EyeOff,
  RefreshCw,
  FolderSync,
  HardDriveDownload,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import LogPane from "@/components/LogPane";
import { useOS } from "@/hooks/useOSStore";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import { useDaemonStateContext } from "@/hooks/useDaemonStateContext";
import { useHashRoute } from "@/hooks/useHashRoute";
import { useJobStream, type JobStatus } from "@/hooks/useJobStream";
import { useDemoApps } from "@/hooks/useDemoApps";
import { useNotifications } from "@/hooks/useOSStore";
import { computePill } from "@/lib/statusPill";
import { READY_COLORS, visualForAgentStatus } from "@/lib/agentStatus";
import { TYTUS_WALLPAPERS } from "@/lib/brand";
import { languagePackExample, useI18n } from "@/i18n";
import {
  maskSecret,
  maskTokenUrl,
  revealSecret,
  revealTokenUrl,
} from "@/lib/secrets";
import { resolveAgentDisplay } from "@/lib/agentCatalog";
import type {
  Catalog,
  CatalogAgent,
  DaemonSettings,
  PodReadiness,
  Tier,
  UpdateStatus,
  Binding,
  SharingDefaults,
  GaragetytusStatus,
} from "@/types/daemon";

interface SettingCategory {
  id: string;
  label: string;
  icon: React.ReactNode;
}

// Tytus-first ordering: identity + private-AI controls live above the
// fold; OS-feel preferences (wifi, sound, etc.) follow a divider so
// they don't bury Pods/Agents on a low monitor.
const TYTUS_CATEGORIES: SettingCategory[] = [
  { id: "account", label: "Account", icon: <User size={18} /> },
  { id: "plan", label: "Plan & Units", icon: <CreditCard size={18} /> },
  { id: "pods", label: "Pods", icon: <Box size={18} /> },
  { id: "agents", label: "Agents", icon: <Sparkles size={18} /> },
  { id: "daemon", label: "Daemon", icon: <Server size={18} /> },
  { id: "sharing", label: "Sharing", icon: <FolderSync size={18} /> },
];

const SYSTEM_CATEGORIES: SettingCategory[] = [
  { id: "background", label: "Background", icon: <Image size={18} /> },
  { id: "appearance", label: "Appearance", icon: <Palette size={18} /> },
  { id: "language", label: "Languages", icon: <Globe2 size={18} /> },
  { id: "notifications", label: "Notifications", icon: <Bell size={18} /> },
  { id: "privacy", label: "Privacy", icon: <Eye size={18} /> },
  { id: "about", label: "About", icon: <Info size={18} /> },
];

const ACTIVE_CATEGORY_IDS = new Set(
  [...TYTUS_CATEGORIES, ...SYSTEM_CATEGORIES].map((cat) => cat.id),
);

const ACCENT_COLORS = [
  { name: "Purple", value: "#7C4DFF" },
  { name: "Blue", value: "#2196F3" },
  { name: "Teal", value: "#009688" },
  { name: "Green", value: "#4CAF50" },
  { name: "Yellow", value: "#FFEB3B" },
  { name: "Orange", value: "#FF9800" },
  { name: "Red", value: "#F44336" },
  { name: "Pink", value: "#E91E63" },
];

const WALLPAPERS = TYTUS_WALLPAPERS;

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

const formatUnixTime = (secs: number | null | undefined): string => {
  if (!secs) return "Never";
  return new Date(secs * 1000).toLocaleString();
};

const CategoryButton: React.FC<{
  cat: SettingCategory;
  active: boolean;
  onSelect: () => void;
  label?: string;
}> = ({ cat, active, onSelect, label }) => (
  <button
    onClick={onSelect}
    className="flex items-center gap-3 w-full px-3 py-2.5 text-sm transition-colors"
    style={{
      background: active ? "var(--bg-selected)" : "transparent",
      color: active ? "var(--accent-primary)" : "var(--text-primary)",
      borderLeft: active
        ? "3px solid var(--accent-primary)"
        : "3px solid transparent",
    }}
  >
    {cat.icon}
    {label ?? cat.label}
  </button>
);

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({
  value,
  onChange,
}) => (
  <button
    onClick={() => onChange(!value)}
    className="relative h-6 rounded-full transition-colors duration-150"
    style={{
      width: 40,
      background: value ? "var(--accent-primary)" : "var(--border-default)",
    }}
  >
    <div
      className="absolute top-0.5 w-5 h-5 rounded-full shadow-sm transition-all duration-150"
      style={{ left: value ? 18 : 2, background: "var(--bg-control-thumb)" }}
    />
  </button>
);

const TIER_RANK: Record<Tier, number> = {
  explorer: 0,
  creator: 1,
  operator: 2,
};

const TYTUS_HOME_DISPLAY = "~/Tytus";
const PROVIDER_BILLING_URL = "https://tytus.traylinx.com/account/plan";

const ACTIVE_CATEGORY_STORAGE_KEY = "tytus_settings_active_category";

interface OfficialLanguagePackCatalogItem {
  locale: string;
  name: string;
  nativeName?: string;
  version: string;
  url: string;
  sha256?: string;
}

const OFFICIAL_LANGUAGE_CATALOG_URL =
  "https://raw.githubusercontent.com/traylinx/tytus-os-language-index/main/catalog.json";
const OFFICIAL_LANGUAGE_RAW_PREFIX =
  "https://raw.githubusercontent.com/traylinx/";

const isOfficialLanguageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.href.startsWith(OFFICIAL_LANGUAGE_RAW_PREFIX) &&
      parsed.pathname.endsWith(".json")
    );
  } catch {
    return false;
  }
};

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const Settings: React.FC = () => {
  const { state, dispatch } = useOS();
  const {
    language,
    availableLanguages,
    t,
    setLanguage,
    installLanguagePack,
    removeLanguagePack,
  } = useI18n();
  const route = useHashRoute();
  const { addNotification } = useNotifications();
  // Initial category resolution: hash route wins (deep-link), then
  // localStorage (returning user), then 'account' default.
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    if (
      route.kind === "settings" &&
      route.section &&
      ACTIVE_CATEGORY_IDS.has(route.section)
    ) {
      return route.section;
    }
    try {
      const saved = localStorage.getItem(ACTIVE_CATEGORY_STORAGE_KEY);
      if (saved && ACTIVE_CATEGORY_IDS.has(saved)) return saved;
    } catch {
      // localStorage can throw in private-mode / sandboxed contexts.
    }
    return "account";
  });

  // Persist on every change so reload restores the last-viewed panel.
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_CATEGORY_STORAGE_KEY, activeCategory);
    } catch {
      // best-effort — see above
    }
  }, [activeCategory]);
  const [search, setSearch] = useState("");
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const pill = computePill(daemon.status, daemon.state, daemon.error);
  // Tier-aware default — paid tiers (creator/operator) start with
  // demos OFF; Explorer defaults ON. The stored choice wins once the
  // user toggles.
  const { showDemoApps, setShowDemoApps } = useDemoApps(daemon.state?.tier);

  // Deep-link: navigate(#/settings/agents) flips the active panel.
  // Deliberate setState-in-effect — we're syncing UI state from a URL
  // hash (an external store), not deriving state from props.
  useEffect(() => {
    if (route.kind !== "settings") return;
    if (!route.section) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setActiveCategory(
      ACTIVE_CATEGORY_IDS.has(route.section) ? route.section : "account",
    );
  }, [route]);

  const [daemonSettings, setDaemonSettings] = useState<DaemonSettings | null>(
    null,
  );
  const [daemonSettingsErr, setDaemonSettingsErr] = useState<string | null>(
    null,
  );
  const [pendingSetting, setPendingSetting] = useState<
    keyof DaemonSettings | null
  >(null);
  const [lifecycleAction, setLifecycleAction] = useState<
    "start" | "stop" | "restart" | null
  >(null);
  const [lifecycleErr, setLifecycleErr] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [configureErr, setConfigureErr] = useState<string | null>(null);
  const [configureStarted, setConfigureStarted] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutErr, setSignOutErr] = useState<string | null>(null);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [openWorkspaceErr, setOpenWorkspaceErr] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateErr, setUpdateErr] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingAutoChecks, setUpdatingAutoChecks] = useState(false);
  const [languageImportStatus, setLanguageImportStatus] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [officialLanguagePacks, setOfficialLanguagePacks] = useState<
    OfficialLanguagePackCatalogItem[] | null
  >(null);
  const [officialLanguageLoading, setOfficialLanguageLoading] = useState(false);
  const [officialLanguageInstalling, setOfficialLanguageInstalling] = useState<
    string | null
  >(null);
  const [officialLanguageErr, setOfficialLanguageErr] = useState<string | null>(
    null,
  );
  const languagePackInputRef = useRef<HTMLInputElement | null>(null);

  const loadOfficialLanguageCatalog = useCallback(async () => {
    setOfficialLanguageLoading(true);
    setOfficialLanguageErr(null);
    try {
      const response = await fetch(OFFICIAL_LANGUAGE_CATALOG_URL, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
      const json = await response.json();
      const packs = Array.isArray(json) ? json : json.packs;
      if (!Array.isArray(packs))
        throw new Error("catalog must contain a packs array");
      const clean = packs.filter(
        (pack: unknown): pack is OfficialLanguagePackCatalogItem => {
          if (!pack || typeof pack !== "object") return false;
          const p = pack as Record<string, unknown>;
          return (
            typeof p.locale === "string" &&
            typeof p.name === "string" &&
            typeof p.version === "string" &&
            typeof p.url === "string" &&
            isOfficialLanguageUrl(p.url)
          );
        },
      );
      setOfficialLanguagePacks(clean);
      if (clean.length === 0)
        throw new Error("catalog has no installable official packs");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOfficialLanguageErr(
        t("settings.languages.officialLoadError", { message }),
      );
      setOfficialLanguagePacks([]);
    } finally {
      setOfficialLanguageLoading(false);
    }
  }, [t]);

  const installOfficialLanguagePack = useCallback(
    async (pack: OfficialLanguagePackCatalogItem) => {
      setOfficialLanguageInstalling(pack.locale);
      setOfficialLanguageErr(null);
      try {
        if (!isOfficialLanguageUrl(pack.url))
          throw new Error("pack URL is not in the official Tytus OS GitHub org");
        const response = await fetch(pack.url, { cache: "no-store" });
        if (!response.ok) throw new Error(`pack HTTP ${response.status}`);
        const text = await response.text();
        if (pack.sha256) {
          const actual = await sha256Hex(text);
          if (actual !== pack.sha256.toLowerCase())
            throw new Error("pack checksum mismatch");
        }
        const installed = installLanguagePack(text);
        setLanguageImportStatus({
          kind: "ok",
          text: t("settings.appearance.language.importSuccess", {
            name: installed.nativeName || installed.name,
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setOfficialLanguageErr(
          t("settings.languages.officialInstallError", { message }),
        );
      } finally {
        setOfficialLanguageInstalling(null);
      }
    },
    [installLanguagePack, t],
  );

  const handleLanguagePackFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const pack = installLanguagePack(await file.text());
        setLanguageImportStatus({
          kind: "ok",
          text: t("settings.appearance.language.importSuccess", {
            name: pack.nativeName || pack.name,
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLanguageImportStatus({
          kind: "error",
          text: t("settings.appearance.language.importError", { message }),
        });
      } finally {
        if (languagePackInputRef.current)
          languagePackInputRef.current.value = "";
      }
    },
    [installLanguagePack, t],
  );

  // Catalog state — loaded on demand when the user opens the Agents tab.
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  // Bumped by Retry button to re-fire getCatalog without depending on
  // the activeCategory effect's other inputs.
  const [catalogReloadNonce, setCatalogReloadNonce] = useState(0);

  // Install wizard state. `pendingAgent` is the chosen card before install
  // fires; once we have a job_id, `installJob` is set and the modal swaps
  // to the streaming pane.
  const [pendingAgent, setPendingAgent] = useState<CatalogAgent | null>(null);
  const [installJob, setInstallJob] = useState<{
    id: string;
    agent: CatalogAgent;
  } | null>(null);
  const [installSubmitting, setInstallSubmitting] = useState(false);
  const [installSubmitErr, setInstallSubmitErr] = useState<string | null>(null);
  const [installRetryRevoke, setInstallRetryRevoke] = useState<{
    id: string;
    podId: string;
  } | null>(null);
  const retryRevokeStream = useJobStream({
    url: installRetryRevoke ? client.jobStreamUrl(installRetryRevoke.id) : null,
  });

  // Load daemon settings on mount + when daemon comes online.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = await client.getSettings();
      if (cancelled) return;
      if (r.ok) {
        setDaemonSettings(r.value);
        setDaemonSettingsErr(null);
      } else if (r.error.code !== "daemon_offline") {
        setDaemonSettingsErr(r.error.message);
      }
    };
    if (daemon.status === "online") load();
    return () => {
      cancelled = true;
    };
  }, [client, daemon.status]);

  useEffect(() => {
    if (daemon.status !== "online") return;
    let cancelled = false;
    client.getUpdateStatus().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setUpdateStatus(r.value);
        setUpdateErr(null);
      } else if (r.error.code !== "daemon_offline") {
        setUpdateErr(r.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, daemon.status]);

  const toggleAutostart = useCallback(
    async (key: keyof DaemonSettings) => {
      if (!daemonSettings) return;
      const next = !daemonSettings[key];
      setPendingSetting(key);
      const r =
        key === "autostart_tray"
          ? await client.postSettingsAutostartTray(next)
          : await client.postSettingsAutostartTunnel(next);
      setPendingSetting(null);
      if (r.ok) {
        setDaemonSettings({ ...daemonSettings, [key]: next });
      } else {
        setDaemonSettingsErr(r.error.message);
      }
    },
    [client, daemonSettings],
  );

  const runLifecycle = useCallback(
    async (action: "start" | "stop" | "restart") => {
      setLifecycleAction(action);
      setLifecycleErr(null);
      const r =
        action === "start"
          ? await client.postDaemonStart()
          : action === "stop"
            ? await client.postDaemonStop()
            : await client.postDaemonRestart();
      setLifecycleAction(null);
      if (!r.ok) {
        setLifecycleErr(r.error.message);
      } else {
        daemon.refresh();
      }
    },
    [client, daemon],
  );

  const openTytusHome = useCallback(async () => {
    setOpenWorkspaceErr(null);
    const r = await client.postWorkspaceOpen();
    if (!r.ok) setOpenWorkspaceErr(r.error.message);
  }, [client]);

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    setUpdateErr(null);
    const r = await client.postUpdateCheck();
    setCheckingUpdates(false);
    if (r.ok) {
      setUpdateStatus(r.value);
      addNotification({
        appId: "settings",
        appName: "Settings",
        appIcon: "Info",
        title: "Software Update",
        message:
          r.value.status === "update_available"
            ? `Tytus OS ${r.value.latest_version} is available.`
            : r.value.detail,
        isRead: false,
      });
    } else {
      setUpdateErr(r.error.message);
    }
  }, [addNotification, client]);

  const toggleAutomaticChecks = useCallback(
    async (enabled: boolean) => {
      setUpdatingAutoChecks(true);
      setUpdateErr(null);
      const r = await client.postUpdateAutomaticChecks(enabled);
      setUpdatingAutoChecks(false);
      if (r.ok) {
        setUpdateStatus(r.value);
      } else {
        setUpdateErr(r.error.message);
      }
    },
    [client],
  );

  const runConfigure = useCallback(() => {
    setConfiguring(true);
    setConfigureErr(null);
    setConfigureStarted(false);
    try {
      dispatch({
        type: "OPEN_OR_FOCUS_WINDOW",
        appId: "terminal",
        title: "Configure Agent",
        args: { terminal: { command: "tytus", args: ["configure"] } },
      });
      setConfigureStarted(true);
    } catch (err) {
      setConfigureErr(err instanceof Error ? err.message : String(err));
    } finally {
      setConfiguring(false);
    }
  }, [dispatch]);

  // Load catalog when Agents tab opens (and re-load after a successful
  // install so newly available units are reflected if the catalog ever
  // gates them). The lint rule warns about setState-in-effect, but
  // we're syncing local UI state with the result of a network fetch —
  // there's no other place this initialisation can live.
  useEffect(() => {
    if (activeCategory !== "agents") return;
    if (daemon.status !== "online") return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setCatalogLoading(true);
    setCatalogErr(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    client.getCatalog().then((r) => {
      if (cancelled) return;
      setCatalogLoading(false);
      if (r.ok) {
        setCatalog(r.value);
      } else if (r.error.code !== "daemon_offline") {
        setCatalogErr(r.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeCategory, client, daemon.status, catalogReloadNonce]);

  // Deep-link install: navigate(#/settings/agents?install=<id|auto>)
  // pre-opens the wizard with the matching (or cheapest installable)
  // agent. Consumed once — we strip the param to avoid re-firing on
  // user navigation.
  const installParamConsumedRef = useRef(false);
  useEffect(() => {
    if (route.kind !== "settings" || route.section !== "agents") return;
    if (!catalog || !daemon.state) return;
    if (installParamConsumedRef.current) return;
    const want = route.params.get("install");
    if (!want) return;

    const tier = daemon.state.tier;
    const remaining = daemon.state.units_limit - daemon.state.units_used;
    const userRank = TIER_RANK[tier];
    const installable = catalog.agents.filter(
      (a) => userRank >= TIER_RANK[a.min_plan] && remaining >= a.units,
    );

    let pick: CatalogAgent | undefined;
    if (want === "auto") {
      // Cheapest first; nemoclaw at 1u beats hermes at 2u.
      pick = [...installable].sort((a, b) => a.units - b.units)[0];
    } else {
      pick = catalog.agents.find((a) => a.id === want);
    }
    if (!pick) return;

    installParamConsumedRef.current = true;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setPendingAgent(pick);
    // Strip ?install so refresh / back-nav doesn't re-trigger.
    const cleaned = new URLSearchParams(route.params);
    cleaned.delete("install");
    if (typeof location !== "undefined") {
      const q = cleaned.toString();
      location.hash = `#/settings/agents${q ? `?${q}` : ""}`;
    }
  }, [route, catalog, daemon.state]);

  const startInstall = useCallback(async () => {
    if (!pendingAgent) return;
    setInstallSubmitting(true);
    setInstallSubmitErr(null);
    const r = await client.postInstall(pendingAgent.id);
    setInstallSubmitting(false);
    if (!r.ok) {
      setInstallSubmitErr(r.error.message);
      return;
    }
    setInstallJob({ id: r.value.job_id, agent: pendingAgent });
  }, [client, pendingAgent]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!installRetryRevoke) return;
    if (retryRevokeStream.status === "success") {
      setInstallRetryRevoke(null);
      setInstallJob(null);
      setInstallSubmitErr(null);
      daemon.refresh();
    } else if (
      retryRevokeStream.status === "failed" ||
      retryRevokeStream.status === "lost"
    ) {
      setInstallSubmitErr(
        `Revoke pod ${installRetryRevoke.podId} before retry failed (${retryRevokeStream.status}). Use Pod Inspector or try again.`,
      );
      setInstallRetryRevoke(null);
    }
  }, [daemon, installRetryRevoke, retryRevokeStream.status]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const retryInstall = useCallback(
    async (podId?: string) => {
      if (!podId) {
        // Drop the failed/lost job but keep pendingAgent so the wizard
        // returns to the confirm step with the same selection.
        setInstallJob(null);
        setInstallSubmitErr(null);
        return;
      }

      setInstallSubmitErr(null);
      setInstallSubmitting(true);
      const r = await client.postPodRunStreamed(podId, "revoke");
      setInstallSubmitting(false);
      if (!r.ok) {
        setInstallSubmitErr(`Couldn't revoke pod ${podId}: ${r.error.message}`);
        return;
      }
      setInstallRetryRevoke({ id: r.value.job_id, podId });
    },
    [client],
  );

  const closeInstallWizard = useCallback(() => {
    setPendingAgent(null);
    setInstallJob(null);
    setInstallSubmitErr(null);
    setInstallRetryRevoke(null);
    daemon.refresh();
  }, [daemon]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setSignOutErr(null);
    const r = await client.postLogout();
    setSigningOut(false);
    if (!r.ok) {
      setSignOutErr(r.error.message);
      return;
    }
    setSignOutConfirmOpen(false);
    dispatch({ type: "LOGOUT" });
    daemon.refresh();
  }, [client, dispatch, daemon]);

  // While searching: flatten both groups and filter; sidebar renders a
  // single list. Otherwise: render the two groups with a divider.
  const ALL_CATEGORIES = useMemo(
    () => [...TYTUS_CATEGORIES, ...SYSTEM_CATEGORIES],
    [],
  );

  useEffect(() => {
    if (ALL_CATEGORIES.some((cat) => cat.id === activeCategory)) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setActiveCategory("account");
  }, [ALL_CATEGORIES, activeCategory]);

  const filteredCategories = search
    ? ALL_CATEGORIES.filter((c) =>
        t(`settings.category.${c.id}`)
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : null;

  const renderPanel = () => {
    switch (activeCategory) {
      case "account":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              Account
            </h2>
            <div
              className="p-4 rounded-lg flex items-center gap-4"
              style={{
                background: "var(--bg-card, rgba(255,255,255,0.03))",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #7C4DFF, #4A148C)",
                }}
              >
                <User size={28} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--text-primary)] font-semibold truncate">
                  {daemon.state?.email ?? "Not signed in"}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Tier:{" "}
                  <span className="font-medium">
                    {daemon.state?.tier ?? "—"}
                  </span>
                  {daemon.state && (
                    <>
                      {" · "}
                      {daemon.state.units_used}/{daemon.state.units_limit} units
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => setSignOutConfirmOpen(true)}
                disabled={signingOut || !daemon.state?.logged_in}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50"
                style={{
                  background: "rgba(244,67,54,0.10)",
                  border: "1px solid rgba(244,67,54,0.30)",
                  color: "var(--accent-error)",
                }}
              >
                <LogOut size={14} />
                Sign out
              </button>
              {signOutErr && (
                <div
                  className="text-xs"
                  style={{ color: "var(--accent-error)" }}
                >
                  {signOutErr}
                </div>
              )}
              <div className="text-[11px] text-[var(--text-secondary)]">
                Sign-in is initiated from the Tytus tray menu (
                <strong>Sign in</strong>). Tytus OS will pick up the new session
                automatically.
              </div>
            </div>
          </div>
        );

      case "sharing":
        return <SharingSettingsPanel />;

      case "daemon":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              Daemon
            </h2>

            <div
              className="p-4 rounded-lg flex items-start gap-3"
              style={{
                background: "var(--bg-card, rgba(255,255,255,0.03))",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <span
                className="w-3 h-3 rounded-full mt-1.5"
                style={{
                  background:
                    pill.color === "green"
                      ? "var(--accent-success)"
                      : pill.color === "yellow"
                        ? "var(--accent-warning)"
                        : pill.color === "red"
                          ? "var(--accent-error)"
                          : "var(--text-secondary)",
                }}
                aria-hidden="true"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {pill.label}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {pill.detail}
                </div>
                {daemon.state && (
                  <div className="text-[11px] text-[var(--text-secondary)] mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <span>PID</span>
                    <span className="font-mono">{daemon.state.daemon_pid}</span>
                    <span>Uptime</span>
                    <span className="font-mono">
                      {Math.round(daemon.state.uptime_secs / 60)}m
                    </span>
                    <span>Tunnel</span>
                    <span className="font-mono">
                      {daemon.state.tunnel_active ? "active" : "down"}
                    </span>
                    <span>Keychain</span>
                    <span className="font-mono">
                      {daemon.state.keychain_healthy ? "healthy" : "unhealthy"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                Lifecycle
              </div>
              <div className="flex flex-wrap gap-2">
                {(["start", "restart", "stop"] as const).map((action) => (
                  <button
                    key={action}
                    onClick={() => runLifecycle(action)}
                    disabled={lifecycleAction !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-60"
                    style={{
                      background: "var(--bg-hover, rgba(255,255,255,0.04))",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {lifecycleAction === action ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Power size={12} />
                    )}
                    {action.charAt(0).toUpperCase() + action.slice(1)}
                  </button>
                ))}
              </div>
              {lifecycleErr && (
                <div
                  className="text-xs"
                  style={{ color: "var(--accent-error)" }}
                >
                  {lifecycleErr}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                Configuration
              </div>
              <div
                className="p-3 rounded-md flex items-start justify-between gap-3"
                style={{
                  background: "var(--bg-hover, rgba(255,255,255,0.02))",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="min-w-0">
                  <div className="text-sm text-[var(--text-primary)]">
                    Configure agent
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    Runs <code className="font-mono">tytus configure</code> in
                    the internal Tytus OS terminal.
                  </div>
                  {configureErr && (
                    <div
                      className="text-xs mt-2"
                      style={{ color: "var(--accent-error)" }}
                    >
                      {configureErr}
                    </div>
                  )}
                  {configureStarted && (
                    <div
                      className="text-xs mt-2"
                      style={{ color: "var(--accent-success)" }}
                    >
                      Configure flow started in the internal Tytus OS Terminal.
                    </div>
                  )}
                </div>
                <button
                  onClick={runConfigure}
                  disabled={configuring}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-60"
                  style={{
                    background: "var(--accent-primary)",
                    color: "var(--text-on-accent)",
                  }}
                >
                  {configuring ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Server size={12} />
                  )}
                  Configure
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                Autostart
              </div>
              {!daemonSettings && !daemonSettingsErr && (
                <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Loading
                  settings…
                </div>
              )}
              {daemonSettingsErr && (
                <div
                  className="text-xs"
                  style={{ color: "var(--accent-error)" }}
                >
                  {daemonSettingsErr}
                </div>
              )}
              {daemonSettings && (
                <>
                  <div
                    className="flex items-center justify-between py-2 px-3 rounded-md"
                    style={{
                      background: "var(--bg-hover, rgba(255,255,255,0.02))",
                    }}
                  >
                    <div>
                      <div className="text-sm text-[var(--text-primary)]">
                        Tray autostart
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        Launch the menu-bar app at login.
                      </div>
                    </div>
                    {pendingSetting === "autostart_tray" ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-[var(--text-secondary)]"
                      />
                    ) : (
                      <Toggle
                        value={daemonSettings.autostart_tray}
                        onChange={() => toggleAutostart("autostart_tray")}
                      />
                    )}
                  </div>
                  <div
                    className="flex items-center justify-between py-2 px-3 rounded-md"
                    style={{
                      background: "var(--bg-hover, rgba(255,255,255,0.02))",
                    }}
                  >
                    <div>
                      <div className="text-sm text-[var(--text-primary)]">
                        Tunnel autostart
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        Bring up the WireGuard tunnel at login.
                      </div>
                    </div>
                    {pendingSetting === "autostart_tunnel" ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-[var(--text-secondary)]"
                      />
                    ) : (
                      <Toggle
                        value={daemonSettings.autostart_tunnel}
                        onChange={() => toggleAutostart("autostart_tunnel")}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );

      case "plan":
        return (
          <PlanPanel
            state={daemon.state}
            onUpgrade={() => client.postOpenExternal(PROVIDER_BILLING_URL)}
            onRefresh={daemon.refresh}
          />
        );

      case "pods":
        return (
          <PodsPanel
            state={daemon.state}
            onAllocate={() => setActiveCategory("agents")}
            onRefresh={daemon.refresh}
          />
        );

      case "agents":
        return (
          <AgentsPanel
            state={daemon.state}
            catalog={catalog}
            loading={catalogLoading}
            error={catalogErr}
            onPick={(a) => setPendingAgent(a)}
            onRetry={() => setCatalogReloadNonce((n) => n + 1)}
          />
        );

      case "appearance":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              Appearance
            </h2>
            <div
              className="flex items-center justify-between py-3 border-b"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div>
                <div className="text-sm text-[var(--text-primary)]">
                  Dark Mode
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Use dark theme across the shell.
                </div>
              </div>
              <Toggle
                value={state.theme.mode === "dark"}
                onChange={() => dispatch({ type: "TOGGLE_THEME" })}
              />
            </div>
            <div className="space-y-3">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                Accent Color
              </div>
              <div className="flex gap-3 flex-wrap">
                {ACCENT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() =>
                      dispatch({
                        type: "SET_THEME",
                        theme: { accent: c.value },
                      })
                    }
                    className="w-10 h-10 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: c.value,
                      boxShadow:
                        state.theme.accent === c.value
                          ? `0 0 0 3px var(--bg-window), 0 0 0 5px ${c.value}`
                          : "none",
                    }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
            <div
              className="flex items-center justify-between py-3 border-t"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div>
                <div className="text-sm text-[var(--text-primary)]">
                  Show demo apps
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Reveal optional OS-feel demo apps in the App Launcher. Tytus
                  product surfaces stay visible either way.
                </div>
              </div>
              <Toggle value={showDemoApps} onChange={setShowDemoApps} />
            </div>
          </div>
        );

      case "language":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              {t("settings.languages.title")}
            </h2>
            <div
              className="p-4 rounded-lg space-y-4"
              style={{
                background: "var(--bg-card, rgba(255,255,255,0.03))",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div>
                <div className="text-sm text-[var(--text-primary)] font-semibold">
                  {t("settings.languages.defaultTitle")}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {t("settings.languages.defaultDescription")}
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-[var(--text-primary)]">
                    {t("settings.appearance.language.title")}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    {t("settings.appearance.language.description")}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableLanguages.map((option) => (
                    <button
                      key={option.locale}
                      onClick={() => setLanguage(option.locale)}
                      className="text-left px-3 py-2 rounded-md transition-colors"
                      style={{
                        background:
                          language === option.locale
                            ? "var(--bg-selected)"
                            : "var(--bg-hover, rgba(255,255,255,0.02))",
                        border:
                          language === option.locale
                            ? "1px solid var(--accent-primary)"
                            : "1px solid var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <div className="text-sm font-medium">
                        {option.nativeName || option.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {option.locale} ·{" "}
                        {option.bundled
                          ? t("settings.appearance.language.bundled")
                          : t("settings.appearance.language.community")}
                      </div>
                    </button>
                  ))}
                </div>
                <div
                  className="p-3 rounded-md space-y-2"
                  style={{
                    background: "var(--bg-hover, rgba(255,255,255,0.02))",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-[var(--text-primary)] font-medium">
                        {t("settings.appearance.language.import")}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                        {t("settings.appearance.language.importHint")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => languagePackInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-md text-xs transition-colors"
                      style={{
                        background: "var(--accent-primary)",
                        color: "var(--text-on-accent)",
                      }}
                    >
                      JSON
                    </button>
                  </div>
                  <input
                    ref={languagePackInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) =>
                      void handleLanguagePackFile(
                        event.target.files?.[0] ?? null,
                      )
                    }
                  />
                  {languageImportStatus && (
                    <div
                      className="text-[11px]"
                      style={{
                        color:
                          languageImportStatus.kind === "ok"
                            ? "var(--accent-success)"
                            : "var(--accent-error)",
                      }}
                    >
                      {languageImportStatus.text}
                    </div>
                  )}
                  <details className="text-[11px] text-[var(--text-secondary)]">
                    <summary className="cursor-pointer">
                      {t("settings.appearance.language.format")}
                    </summary>
                    <pre
                      className="mt-2 p-2 rounded-md overflow-auto font-mono text-[10px]"
                      style={{ background: "rgba(0,0,0,0.25)" }}
                    >
                      {JSON.stringify(languagePackExample, null, 2)}
                    </pre>
                  </details>
                  <div
                    className="mt-3 p-3 rounded-md space-y-3"
                    style={{
                      background: "rgba(0,0,0,0.14)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs text-[var(--text-primary)] font-medium">
                          {t("settings.languages.officialTitle")}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                          {t("settings.languages.officialHint")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadOfficialLanguageCatalog()}
                        disabled={officialLanguageLoading}
                        className="px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-60 flex items-center gap-1.5"
                        style={{
                          background: "var(--bg-control)",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border-default)",
                        }}
                      >
                        {officialLanguageLoading ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        {t("settings.languages.officialRefresh")}
                      </button>
                    </div>
                    {officialLanguageErr && (
                      <div
                        className="text-[11px]"
                        style={{ color: "var(--accent-error)" }}
                      >
                        {officialLanguageErr}
                      </div>
                    )}
                    {officialLanguagePacks &&
                      officialLanguagePacks.length > 0 && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {officialLanguagePacks.map((pack) => {
                            const installed = availableLanguages.some(
                              (option) => option.locale === pack.locale,
                            );
                            return (
                              <button
                                key={`${pack.locale}-${pack.version}`}
                                type="button"
                                onClick={() => {
                                  if (!installed)
                                    void installOfficialLanguagePack(pack);
                                }}
                                disabled={
                                  installed ||
                                  officialLanguageInstalling !== null
                                }
                                className="text-left px-3 py-2 rounded-md transition-colors disabled:opacity-60"
                                style={{
                                  background:
                                    "var(--bg-hover, rgba(255,255,255,0.02))",
                                  border: "1px solid var(--border-subtle)",
                                  color: "var(--text-primary)",
                                }}
                              >
                                <div className="text-sm font-medium flex items-center gap-2">
                                  {officialLanguageInstalling ===
                                    pack.locale && (
                                    <Loader2
                                      size={12}
                                      className="animate-spin"
                                    />
                                  )}
                                  {pack.nativeName || pack.name}
                                  {installed && (
                                    <span className="text-[10px] text-[var(--text-secondary)]">
                                      · {t("settings.languages.installed")}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[var(--text-secondary)]">
                                  {t("settings.languages.officialPackMeta", {
                                    locale: pack.locale,
                                    version: pack.version,
                                  })}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                  </div>
                  <div
                    className="mt-2 p-3 rounded-md space-y-2"
                    style={{
                      background: "rgba(124,77,255,0.08)",
                      border: "1px solid rgba(124,77,255,0.18)",
                    }}
                  >
                    <div className="text-xs text-[var(--text-primary)] font-semibold">
                      {t("settings.languages.contributeTitle")}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      {t("settings.languages.contributeBody")}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <a
                        href="https://github.com/traylinx/tytus-os-language-index"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 text-[var(--accent-primary)] hover:text-[var(--text-primary)]"
                      >
                        {t("settings.languages.createPackLink")}
                      </a>
                      <span className="text-[var(--text-secondary)]">·</span>
                      <a
                        href="https://github.com/traylinx/tytus-os-lang-es"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        {t("settings.languages.spanishRepoLink")}
                      </a>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableLanguages
                      .filter((option) => !option.bundled)
                      .map((option) => (
                        <button
                          key={option.locale}
                          type="button"
                          onClick={() => removeLanguagePack(option.locale)}
                          className="px-2 py-1 rounded-md text-[11px]"
                          style={{
                            background: "rgba(244,67,54,0.10)",
                            border: "1px solid rgba(244,67,54,0.30)",
                            color: "var(--accent-error)",
                          }}
                        >
                          {t("settings.appearance.language.remove")}{" "}
                          {option.locale}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case "background":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              Background
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {WALLPAPERS.map((w) => (
                <button
                  key={w.id}
                  onClick={() =>
                    dispatch({ type: "SET_THEME", theme: { wallpaper: w.id } })
                  }
                  className="relative rounded-lg overflow-hidden border-2 transition-all hover:scale-[1.02]"
                  style={{
                    borderColor:
                      state.theme.wallpaper === w.id
                        ? "var(--accent-primary)"
                        : "transparent",
                    aspectRatio: "16/9",
                  }}
                >
                  <img
                    src={w.id}
                    alt={w.name}
                    className="w-full h-full object-cover"
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 px-2 py-1 text-xs text-white"
                    style={{ background: "rgba(0,0,0,0.6)" }}
                  >
                    {w.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case "notifications": {
        const total = state.notifications.length;
        const unread = state.notifications.filter((n) => !n.isRead).length;
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              Notifications
            </h2>
            <div
              className="p-4 rounded-lg flex items-center justify-between gap-4"
              style={{
                background: "var(--bg-card, rgba(255,255,255,0.03))",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div>
                <div className="text-sm text-[var(--text-primary)] font-semibold">
                  Notification Center
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {total === 0
                    ? "No notifications"
                    : `${unread} unread · ${total} total`}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1.5 rounded-md text-xs transition-colors"
                  style={{
                    background: "var(--bg-hover)",
                    color: "var(--text-primary)",
                  }}
                  onClick={() =>
                    dispatch({ type: "TOGGLE_NOTIFICATION_CENTER" })
                  }
                >
                  Open Center
                </button>
                <button
                  className="px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50"
                  style={{
                    background: "var(--bg-hover)",
                    color: "var(--text-primary)",
                  }}
                  disabled={total === 0}
                  onClick={() => dispatch({ type: "CLEAR_NOTIFICATIONS" })}
                >
                  Clear All
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                Recent
              </div>
              {state.notifications.length === 0 ? (
                <div className="text-sm text-[var(--text-secondary)] py-6 text-center">
                  No recent notifications.
                </div>
              ) : (
                state.notifications.slice(0, 5).map((notification) => (
                  <div
                    key={notification.id}
                    className="p-3 rounded-lg"
                    style={{
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div className="text-sm text-[var(--text-primary)] font-semibold">
                      {notification.title}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-1">
                      {notification.message}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      }

      case "privacy":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              Privacy
            </h2>
            <div
              className="p-4 rounded-lg space-y-3"
              style={{
                background: "var(--bg-card, rgba(255,255,255,0.03))",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div>
                <div className="text-sm text-[var(--text-primary)] font-semibold">
                  Private AI shell
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-1">
                  Tytus OS shows daemon/pod state from your local Tytus daemon.
                  Browser-side telemetry and fake device controls are
                  intentionally not exposed.
                </div>
              </div>
              <button
                className="px-3 py-1.5 rounded-md text-xs transition-colors"
                style={{
                  background: "var(--bg-hover)",
                  color: "var(--text-primary)",
                }}
                onClick={() => dispatch({ type: "LOCK" })}
              >
                Lock Screen Now
              </button>
            </div>
          </div>
        );

      case "about": {
        const daemonVersion =
          daemon.state?.daemon_version ??
          daemon.version?.daemon_version ??
          "unknown";
        const daemonPid =
          daemon.state?.daemon_pid ?? daemon.version?.daemon_pid ?? null;
        const daemonStartedAt =
          daemon.state?.daemon_started_at ??
          daemon.version?.daemon_started_at ??
          null;
        const softwareVersion =
          updateStatus?.installed_version ?? daemonVersion;
        const updateStatusLabel =
          updateStatus?.status === "update_available"
            ? `Tytus OS ${updateStatus.latest_version} available`
            : updateStatus?.status === "up_to_date"
              ? "Tytus OS is up to date"
              : "Local build installed";
        const updateStatusColor =
          updateStatus?.status === "update_available"
            ? "#FF9800"
            : updateStatus?.status === "up_to_date"
              ? "var(--accent-success)"
              : "var(--text-secondary)";
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              About
            </h2>
            <div className="flex flex-col items-center py-6">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "var(--bg-card)" }}
              >
                <img
                  src="/brand/tytusos-mark-64.png"
                  alt="Tytus OS"
                  width={64}
                  height={64}
                />
              </div>
              <div className="text-xl font-semibold text-[var(--text-primary)]">
                Tytus OS
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                Web shell for your private AI pod
              </div>
            </div>

            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                className="px-4 py-3 flex items-center justify-between border-b"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    Software Update
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    Installed Tytus OS {softwareVersion}
                  </div>
                </div>
                <button
                  className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-60"
                  style={{
                    background: "var(--bg-hover)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-subtle)",
                  }}
                  disabled={checkingUpdates || daemon.status !== "online"}
                  onClick={checkForUpdates}
                >
                  {checkingUpdates ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" /> Checking…
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <RefreshCw size={12} /> Check for updates
                    </span>
                  )}
                </button>
              </div>
              <div
                className="divide-y"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div className="px-4 py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-[var(--text-primary)]">
                      {updateStatusLabel}
                    </div>
                    <div
                      className="text-xs mt-0.5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {updateStatus?.detail ?? "Loading update status…"}
                    </div>
                  </div>
                  <div
                    className="text-xs font-medium"
                    style={{ color: updateStatusColor }}
                  >
                    {updateStatus?.status === "update_available"
                      ? "Update"
                      : updateStatus?.status === "up_to_date"
                        ? "Installed"
                        : "Local"}
                  </div>
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-[var(--text-primary)]">
                      Automatic update checks
                    </div>
                    <div
                      className="text-xs mt-0.5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Last checked:{" "}
                      {formatUnixTime(updateStatus?.last_checked_at)}
                    </div>
                  </div>
                  <div
                    className={
                      updatingAutoChecks ? "opacity-60 pointer-events-none" : ""
                    }
                  >
                    <Toggle
                      value={updateStatus?.automatic_checks ?? true}
                      onChange={toggleAutomaticChecks}
                    />
                  </div>
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-4">
                  <span className="text-sm text-[var(--text-secondary)]">
                    Update channel
                  </span>
                  <span className="text-sm text-[var(--text-primary)]">
                    {updateStatus?.channel ?? "local"}
                  </span>
                </div>
              </div>
              {updateErr && (
                <div
                  className="px-4 py-2 text-xs border-t"
                  style={{
                    color: "var(--accent-error)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  {updateErr}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {[
                ["Daemon version", daemonVersion],
                ["Daemon PID", daemonPid === null ? "—" : String(daemonPid)],
                [
                  "Daemon uptime",
                  daemon.state ? formatUptime(daemon.state.uptime_secs) : "—",
                ],
                [
                  "Daemon started",
                  daemonStartedAt === null
                    ? "—"
                    : new Date(daemonStartedAt * 1000).toLocaleString(),
                ],
                [
                  "Signed in",
                  daemon.state?.logged_in ? daemon.state.email : "no",
                ],
                ["Plan", daemon.state?.tier ?? "—"],
                ["Tytus Home", TYTUS_HOME_DISPLAY],
                [
                  "Units",
                  daemon.state
                    ? `${daemon.state.units_used} / ${daemon.state.units_limit}`
                    : "—",
                ],
                ["Tunnel", daemon.state?.tunnel_active ? "active" : "down"],
                [
                  "Keychain",
                  daemon.state?.keychain_healthy ? "healthy" : "unhealthy",
                ],
                ["Browser", navigator.userAgent.slice(0, 80)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-2 border-b"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <span className="text-sm text-[var(--text-secondary)]">
                    {label}
                  </span>
                  <span className="text-sm text-[var(--text-primary)]">
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <LocalDataPanel />
            <div className="grid grid-cols-2 gap-3">
              <button
                className="py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
                style={{
                  background: "var(--accent-primary)",
                  color: "var(--text-on-accent)",
                }}
                onClick={openTytusHome}
              >
                Open Tytus Home
              </button>
              <button
                className="py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
                onClick={daemon.refresh}
              >
                Refresh daemon state
              </button>
            </div>
            {openWorkspaceErr && (
              <div className="text-xs" style={{ color: "var(--accent-error)" }}>
                Could not open Tytus Home: {openWorkspaceErr}
              </div>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="flex h-full" style={{ background: "var(--bg-window)" }}>
      {/* Sidebar */}
      <div
        className="w-56 shrink-0 border-r flex flex-col"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-titlebar)",
        }}
      >
        <div className="p-2">
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
            style={{ background: "var(--bg-input)" }}
          >
            <Search size={14} className="text-[var(--text-secondary)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              className="flex-1 bg-transparent rounded-input text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredCategories ? (
            filteredCategories.map((cat) => (
              <CategoryButton
                key={cat.id}
                cat={cat}
                label={t(`settings.category.${cat.id}`)}
                active={activeCategory === cat.id}
                onSelect={() => {
                  setActiveCategory(cat.id);
                  setSearch("");
                }}
              />
            ))
          ) : (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] opacity-70">
                {t("settings.section.tytus")}
              </div>
              {TYTUS_CATEGORIES.map((cat) => (
                <CategoryButton
                  key={cat.id}
                  cat={cat}
                  label={t(`settings.category.${cat.id}`)}
                  active={activeCategory === cat.id}
                  onSelect={() => setActiveCategory(cat.id)}
                />
              ))}
              <div
                className="my-2 mx-3"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              />
              <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] opacity-70">
                {t("settings.section.system")}
              </div>
              {SYSTEM_CATEGORIES.map((cat) => (
                <CategoryButton
                  key={cat.id}
                  cat={cat}
                  label={t(`settings.category.${cat.id}`)}
                  active={activeCategory === cat.id}
                  onSelect={() => setActiveCategory(cat.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        {renderPanel()}
      </div>

      {/* Install wizard modal */}
      {(pendingAgent || installJob) && (
        <InstallWizard
          agent={(installJob?.agent ?? pendingAgent) as CatalogAgent}
          jobId={installJob?.id ?? null}
          submitting={installSubmitting}
          submitErr={installSubmitErr}
          jobStreamUrl={installJob ? client.jobStreamUrl(installJob.id) : null}
          retryRevokePodId={installRetryRevoke?.podId ?? null}
          retryRevokeStatus={
            installRetryRevoke ? retryRevokeStream.status : null
          }
          retryRevokeLines={retryRevokeStream.lines}
          onConfirm={startInstall}
          onRetry={retryInstall}
          onSuccess={() => {
            daemon.refresh();
            const agent = (installJob?.agent ??
              pendingAgent) as CatalogAgent | null;
            if (agent) {
              addNotification({
                appId: "settings",
                appName: "Settings",
                appIcon: "Sparkles",
                title: `${agent.name} installed`,
                message: `Allocated ${agent.units} unit${agent.units === 1 ? "" : "s"}. Find the new pod in the Pods panel.`,
                isRead: false,
              });
            }
          }}
          onOpenAssistant={(podId) => client.postPodOpen(podId)}
          onConnectMessenger={(podId) =>
            dispatch({
              type: "OPEN_OR_FOCUS_WINDOW",
              appId: "channels",
              args: {
                routeNonce: `install-${Date.now().toString(36)}`,
                podId,
                channels: { podId },
              },
            })
          }
          onClose={closeInstallWizard}
        />
      )}

      {/* Sign-out confirmation. /api/logout revokes ALL pod allocations
          server-side; never call it without a confirmation step. */}
      {signOutConfirmOpen && (
        <SignOutConfirm
          podCount={daemon.state?.agents.length ?? 0}
          submitting={signingOut}
          onConfirm={signOut}
          onCancel={() => setSignOutConfirmOpen(false)}
        />
      )}
    </div>
  );
};

// ============================================================
// Plan & Units panel
// ============================================================

interface PlanPanelProps {
  state: import("@/types/daemon").StateSnapshot | null;
  onUpgrade: () => void;
  onRefresh: () => void;
}

const PlanPanel: React.FC<PlanPanelProps> = ({
  state,
  onUpgrade,
  onRefresh,
}) => {
  if (!state) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
          Plan & Units
        </h2>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" /> Loading plan…
        </div>
      </div>
    );
  }

  const pct =
    state.units_limit > 0
      ? Math.min(100, Math.round((state.units_used / state.units_limit) * 100))
      : 0;
  const remaining = Math.max(0, state.units_limit - state.units_used);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
          Plan & Units
        </h2>
        <RefreshButton onClick={onRefresh} />
      </div>

      <div
        className="p-5 rounded-lg"
        style={{
          background: "var(--bg-card, rgba(255,255,255,0.03))",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
              Tier
            </div>
            <div className="text-lg font-semibold text-[var(--text-primary)] capitalize">
              {state.tier}
            </div>
          </div>
          <button
            onClick={onUpgrade}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: "rgba(124,77,255,0.12)",
              border: "1px solid rgba(124,77,255,0.30)",
              color: "var(--accent-primary)",
            }}
          >
            Upgrade plan <ExternalLink size={11} />
          </button>
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-1.5">
            <span>
              {state.units_used} of {state.units_limit} units used
            </span>
            <span>{remaining} available</span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: "var(--border-subtle)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background:
                  pct >= 100
                    ? "var(--accent-error)"
                    : pct >= 75
                      ? "var(--accent-warning)"
                      : "var(--accent-primary)",
              }}
            />
          </div>
        </div>
      </div>

      {state.agents.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Breakdown
          </div>
          <div className="space-y-1">
            {state.agents.map((a) => (
              <div
                key={a.pod_id}
                className="flex items-center justify-between py-1.5 px-3 rounded-md text-xs"
                style={{
                  background: "var(--bg-card, rgba(255,255,255,0.03))",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <span className="text-[var(--text-primary)]">
                  Pod {a.pod_id} · {a.agent_type}
                </span>
                <span className="font-mono text-[var(--text-secondary)]">
                  {a.units} unit{a.units === 1 ? "" : "s"}
                </span>
              </div>
            ))}
            <div
              className="flex items-center justify-between py-1.5 px-3 text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>Total</span>
              <span className="font-mono">
                {state.units_used} of {state.units_limit}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-[var(--text-secondary)]">
        Units are consumed by allocated agents (nemoclaw = 1 unit, hermes = 2
        units). Included AIL pods don't count against your unit budget.
      </div>
    </div>
  );
};

// ============================================================
// Pods panel
// ============================================================

interface PodsPanelProps {
  state: import("@/types/daemon").StateSnapshot | null;
  onAllocate: () => void;
  onRefresh: () => void;
}

const PodsPanel: React.FC<PodsPanelProps> = ({
  state,
  onAllocate,
  onRefresh,
}) => {
  // Bumped by RefreshButton clicks; PodCard reads it to re-probe
  // /api/pod/ready without us coupling to daemon poll timing.
  const [readyNonce, setReadyNonce] = useState(0);
  const handleRefresh = useCallback(() => {
    onRefresh();
    setReadyNonce((n) => n + 1);
  }, [onRefresh]);
  if (!state) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
          Pods
        </h2>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" /> Loading pods…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
          Pods
        </h2>
        <div className="flex items-center gap-2">
          <RefreshButton onClick={handleRefresh} />
          <button
            onClick={onAllocate}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: "var(--accent-primary)",
              color: "var(--text-on-accent)",
            }}
          >
            + Allocate pod
          </button>
        </div>
      </div>

      {state.agents.length === 0 && state.included.length === 0 && (
        <div
          className="p-6 rounded-lg flex flex-col items-center text-center gap-3"
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.03))",
            border: "1px dashed var(--border-default)",
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(124,77,255,0.12)",
              border: "1px solid rgba(124,77,255,0.25)",
            }}
          >
            <Box size={18} className="text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">
              No pods yet
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-1 max-w-[280px]">
              Allocate your first pod to start using Tytus. The Agents tab has
              the catalog of available agents.
            </div>
          </div>
          <button
            onClick={onAllocate}
            className="mt-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: "var(--accent-primary)",
              color: "var(--text-on-accent)",
            }}
          >
            Browse agents →
          </button>
        </div>
      )}

      {state.agents.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Allocated ({state.agents.length})
          </div>
          <div className="space-y-2">
            {state.agents.map((a) => (
              <PodCard key={a.pod_id} agent={a} refreshNonce={readyNonce} />
            ))}
          </div>
        </div>
      )}

      {state.included.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Included ({state.included.length})
          </div>
          <div className="space-y-2">
            {state.included.map((p) => (
              <div
                key={p.pod_id}
                className="p-3 rounded-lg flex items-center gap-3 opacity-80"
                style={{
                  background: "var(--bg-card, rgba(255,255,255,0.03))",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <Sparkles
                  size={20}
                  className="text-[var(--text-secondary)] flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {p.kind.toUpperCase()} · {p.endpoint}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    Free with your account · doesn't count against units
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Pod card — connection details with copy + reveal
// ============================================================

interface PodCardProps {
  agent: import("@/types/daemon").Agent;
  /** Bumped by parent's RefreshButton to re-probe pod readiness. */
  refreshNonce?: number;
}

type ReadyDot = {
  color: string;
  label: string;
  ready: boolean;
  detail?: string;
  overall?: PodReadiness["overall"];
  stages?: PodReadiness["stages"];
} | null;

const firstBlockingStage = (readiness: PodReadiness) =>
  readiness.stages.find((stage) =>
    ["failed", "starting", "unknown"].includes(stage.status),
  ) ??
  readiness.stages.find((stage) => stage.status === "degraded") ??
  null;

const readyDotFromReadiness = (
  readiness: PodReadiness,
): NonNullable<ReadyDot> => {
  const blocking = firstBlockingStage(readiness);
  if (readiness.open_enabled) {
    return {
      color:
        readiness.overall === "degraded"
          ? "var(--accent-warning)"
          : "var(--accent-success)",
      label: readiness.overall === "degraded" ? "Ready · degraded" : "Ready",
      ready: true,
      detail: blocking?.detail ?? undefined,
      overall: readiness.overall,
      stages: readiness.stages,
    };
  }
  if (readiness.overall === "failed") {
    return {
      color: "var(--accent-error)",
      label: blocking?.label ?? "Not ready",
      ready: false,
      detail: blocking?.detail ?? undefined,
      overall: readiness.overall,
      stages: readiness.stages,
    };
  }
  return {
    color: "var(--accent-warning)",
    label: blocking?.label ?? "Starting",
    ready: false,
    detail: blocking?.detail ?? undefined,
    overall: readiness.overall,
    stages: readiness.stages,
  };
};

const PodCard: React.FC<PodCardProps> = ({ agent, refreshNonce = 0 }) => {
  const client = useDaemonClient();
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [uiRevealed, setUiRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [ready, setReady] = useState<ReadyDot>(null);

  // Prefer the structured readiness contract. It carries the exact failing
  // stage and the authoritative `open_enabled` gate. Fall back to legacy
  // status fields only for old daemons.
  useEffect(() => {
    let cancelled = false;
    client.getPodReadiness(agent.pod_id).then(async (r) => {
      if (cancelled) return;
      if (r.ok) {
        setReady(readyDotFromReadiness(r.value));
        return;
      }
      if (agent.status !== undefined) {
        const v = visualForAgentStatus(agent.status);
        setReady({
          color: READY_COLORS[v.state],
          label: v.label,
          ready: v.ready,
        });
        return;
      }
      const legacy = await client.getPodReady(agent.pod_id);
      if (cancelled) return;
      if (!legacy.ok) {
        setReady({
          color: "var(--text-secondary)",
          label: "Probe failed",
          ready: false,
        });
      } else if (legacy.value.ready) {
        setReady({
          color: "var(--accent-success)",
          label: "Ready",
          ready: true,
        });
      } else {
        setReady({
          color: "var(--accent-warning)",
          label: legacy.value.reason || "Not ready",
          ready: false,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, agent.pod_id, agent.status, refreshNonce]);

  const copyToClipboard = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
    } catch {
      // Clipboard API can reject in non-secure contexts; ignore — the
      // user can still select+copy from the displayed value.
    }
  }, []);

  const openPod = useCallback(async () => {
    setOpening(true);
    setOpenErr(null);
    const r = await client.postPodOpen(agent.pod_id);
    setOpening(false);
    if (!r.ok) setOpenErr(r.error.message);
  }, [client, agent.pod_id]);
  const openLabel =
    agent.agent_type === "hermes" ? "Open dashboard" : "Open agent UI";

  return (
    <div
      className="p-3 rounded-lg flex flex-col gap-2"
      style={{
        background: "var(--bg-card, rgba(255,255,255,0.03))",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <Box size={20} className="text-[var(--accent-primary)]" />
          {ready && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full"
              style={{
                background: ready.color,
                boxShadow: "0 0 0 2px var(--bg-card, #1E1E1E)",
              }}
              title={
                ready.detail ? `${ready.label}: ${ready.detail}` : ready.label
              }
              aria-label={ready.label}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate">
            Pod {agent.pod_id} · {agent.agent_type}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
            {agent.units} unit{agent.units === 1 ? "" : "s"} ·{" "}
            <span style={{ color: ready?.color ?? "var(--text-secondary)" }}>
              {ready?.label ?? "…"}
            </span>
          </div>
        </div>
        <button
          onClick={openPod}
          disabled={opening || ready?.ready === false}
          title={
            ready?.ready === false
              ? `Pod is not ready yet: ${ready.detail ?? ready.label}`
              : openLabel
          }
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-60"
          style={{
            background: "var(--bg-hover, rgba(255,255,255,0.04))",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          {opening ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <ExternalLink size={11} />
          )}
          Open
        </button>
      </div>

      {openErr && (
        <div className="text-[11px]" style={{ color: "var(--accent-warning)" }}>
          Couldn't open pod URL: {openErr}
        </div>
      )}

      <div className="grid grid-cols-[80px_1fr_auto] gap-x-2 gap-y-1.5 text-[11px] items-center mt-1">
        <span className="text-[var(--text-secondary)]">API URL</span>
        <code
          className="font-mono text-[var(--text-primary)] truncate"
          style={{
            background: "rgba(255,255,255,0.03)",
            padding: "2px 6px",
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
            padding: "2px 6px",
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
            padding: "2px 6px",
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
            padding: "2px 6px",
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
  );
};

const RefreshButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  // Local "spinning" flag — useDaemonState.refresh() is fire-and-forget,
  // so we just animate for a fixed window to give the click visible
  // feedback. Default poll is 2s, so 800ms is comfortably under the
  // next natural state update.
  const [spinning, setSpinning] = useState(false);
  const spin = useCallback(() => {
    setSpinning(true);
    onClick();
    setTimeout(() => setSpinning(false), 800);
  }, [onClick]);
  return (
    <button
      onClick={spin}
      aria-label="Refresh"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-colors"
      style={{
        background: "var(--bg-hover, rgba(255,255,255,0.04))",
        border: "1px solid var(--border-default)",
        color: "var(--text-secondary)",
      }}
    >
      <RefreshCw size={11} className={spinning ? "animate-spin" : undefined} />
      Refresh
    </button>
  );
};

const CopyBtn: React.FC<{
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
      color: isCopied ? "var(--accent-success)" : "var(--text-secondary)",
    }}
  >
    {isCopied ? <Check size={12} /> : <Copy size={12} />}
  </button>
);

const RevealBtn: React.FC<{
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

// ============================================================
// Agents catalog panel
// ============================================================
//
// Marketing display copy for each agent (tagline / description /
// bullet highlights) is centralised in `@/lib/agentCatalog` and
// translated through the i18n layer so language packs can localise
// these strings. Anything that isn't prose (icons, homepage / github
// links, port numbers) lives in the same module as plain literals.

interface AgentsPanelProps {
  state: import("@/types/daemon").StateSnapshot | null;
  catalog: Catalog | null;
  loading: boolean;
  error: string | null;
  onPick: (agent: CatalogAgent) => void;
  onRetry: () => void;
}

const AgentsPanel: React.FC<AgentsPanelProps> = ({
  state,
  catalog,
  loading,
  error,
  onPick,
  onRetry,
}) => {
  const { t } = useI18n();
  const tier = state?.tier ?? "explorer";
  const unitsRemaining = state ? state.units_limit - state.units_used : 0;
  const userTierRank = TIER_RANK[tier];

  // Count allocated pods per agent_type so the catalog can show
  // "1 running on pod 02" — feedback after a successful install and a
  // hint that the agent can be installed multiple times.
  const allocatedByType = useMemo(() => {
    const map = new Map<string, { count: number; pods: string[] }>();
    if (!state) return map;
    for (const a of state.agents) {
      const entry = map.get(a.agent_type) ?? { count: 0, pods: [] };
      entry.count += 1;
      entry.pods.push(a.pod_id);
      map.set(a.agent_type, entry);
    }
    return map;
  }, [state]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
          {t("agents.panel.title")}
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          {t("agents.panel.subtitle")}
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" />{" "}
          {t("agents.panel.loading")}
        </div>
      )}

      {error && (
        <div
          className="p-3 rounded-lg flex items-start gap-2 text-xs"
          style={{
            background: "rgba(244,67,54,0.10)",
            border: "1px solid rgba(244,67,54,0.30)",
            color: "var(--accent-error)",
          }}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div>{t("agents.panel.loadError", { message: error })}</div>
            <button
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={{
                background: "var(--bg-hover)",
                border: "1px solid var(--border-default)",
                color: "var(--accent-error)",
              }}
            >
              <RefreshCw size={11} /> {t("agents.panel.retry")}
            </button>
          </div>
        </div>
      )}

      {catalog && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {catalog.agents.map((a) => {
            const tierRank = TIER_RANK[a.min_plan];
            const tierOk = userTierRank >= tierRank;
            const fits = unitsRemaining >= a.units;
            const installable = tierOk && fits;
            const reason = !tierOk
              ? t("agents.panel.reasonPlan", { plan: a.min_plan })
              : !fits
                ? t("agents.panel.reasonUnits", {
                    needed: String(a.units),
                    unit:
                      a.units === 1
                        ? t("agents.panel.unitSingular")
                        : t("agents.panel.unitPlural"),
                    available: String(unitsRemaining),
                  })
                : null;
            const display = resolveAgentDisplay(a.id, a, t);
            const allocated = allocatedByType.get(a.id);
            return (
              <div
                key={a.id}
                className="rounded-lg flex flex-col p-5 transition-colors"
                style={{
                  background: "var(--bg-card, rgba(255,255,255,0.03))",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {/* Head: icon + name/tagline + units pill */}
                <div className="flex items-center gap-3.5 mb-3.5">
                  <div
                    className="flex-shrink-0 w-11 h-11 rounded-md flex items-center justify-center"
                    style={{
                      background: "rgba(124,77,255,0.12)",
                      border: "1px solid rgba(124,77,255,0.20)",
                    }}
                  >
                    {display.icon ? (
                      <img
                        src={display.icon}
                        alt=""
                        width={28}
                        height={28}
                        style={{ display: "block" }}
                      />
                    ) : (
                      <Sparkles
                        size={20}
                        style={{ color: "var(--accent-primary)" }}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[17px] font-bold tracking-tight text-[var(--text-primary)] leading-tight">
                      {display.name}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-snug">
                      {display.tagline}
                    </div>
                  </div>
                  <div
                    className="flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap tabular-nums"
                    style={{
                      background: "rgba(124,77,255,0.12)",
                      color: "var(--accent-primary)",
                    }}
                  >
                    {a.units}{" "}
                    {a.units === 1
                      ? t("agents.panel.unitSingular")
                      : t("agents.panel.unitPlural")}
                  </div>
                </div>

                {allocated && (
                  <div
                    className="text-[10px] px-2 py-1 rounded-md flex items-center gap-1.5 self-start mb-3"
                    style={{
                      background: "rgba(76,175,80,0.10)",
                      border: "1px solid rgba(76,175,80,0.25)",
                      color: "var(--accent-success)",
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: "var(--accent-success)" }}
                    />
                    {t(
                      allocated.count === 1
                        ? "agents.panel.runningOnSingular"
                        : "agents.panel.runningOnPlural",
                      {
                        count: String(allocated.count),
                        pods: allocated.pods.join(", "),
                      },
                    )}
                  </div>
                )}

                {/* Description */}
                <div className="text-[13px] leading-relaxed text-[var(--text-secondary)] mb-3.5">
                  {display.description}
                </div>

                {/* Feature bullets */}
                {display.highlights.length > 0 && (
                  <ul className="list-none p-0 m-0 mb-4 grid gap-2 flex-1">
                    {display.highlights.map((h) => (
                      <li
                        key={h}
                        className="text-[12.5px] leading-snug text-[var(--text-primary)] pl-5 relative"
                      >
                        <span
                          className="absolute left-0 w-1.5 h-1.5 rounded-full"
                          style={{
                            top: "0.45rem",
                            background: "var(--accent-primary, #7C4DFF)",
                          }}
                        />
                        {h}
                      </li>
                    ))}
                  </ul>
                )}

                {!installable && reason && (
                  <div
                    className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md mb-3 flex items-center gap-1.5"
                    style={{
                      background: "rgba(244,67,54,0.10)",
                      border: "1px solid rgba(244,67,54,0.30)",
                      color: "var(--accent-error)",
                    }}
                  >
                    <AlertTriangle size={12} className="flex-shrink-0" />
                    {reason}
                  </div>
                )}

                {/* Footer: links + install CTA */}
                <div
                  className="mt-auto pt-3 flex items-center justify-between gap-3"
                  style={{ borderTop: "1px solid var(--border-subtle)" }}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    {display.homepage && (
                      <a
                        href={display.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors no-underline"
                      >
                        {t("agents.panel.website")}{" "}
                        <span className="opacity-50">↗</span>
                      </a>
                    )}
                    {display.github && (
                      <a
                        href={display.github}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors no-underline"
                      >
                        {t("agents.panel.github")}{" "}
                        <span className="opacity-50">↗</span>
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => onPick(a)}
                    disabled={!installable}
                    title={reason ?? undefined}
                    className="px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: installable
                        ? "var(--accent-primary)"
                        : "var(--bg-hover, rgba(255,255,255,0.04))",
                      color: installable ? "white" : "var(--text-secondary)",
                      border: installable
                        ? "none"
                        : "1px solid var(--border-default)",
                    }}
                  >
                    {t("agents.panel.install")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Install wizard modal — confirm + stream
// ============================================================

interface InstallWizardProps {
  agent: CatalogAgent;
  jobId: string | null;
  submitting: boolean;
  submitErr: string | null;
  jobStreamUrl: string | null;
  retryRevokePodId: string | null;
  retryRevokeStatus: JobStatus | null;
  retryRevokeLines: string[];
  onConfirm: () => void;
  onRetry: (podId?: string) => void;
  onSuccess: () => void;
  onOpenAssistant: (podId: string) => void;
  onConnectMessenger: (podId: string) => void;
  onClose: () => void;
}

const objectStringField = (value: unknown, keys: string[]): string | null => {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
};

const extractInstallPodId = (
  payload: unknown,
  lines: string[],
): string | null => {
  const fromPayload = objectStringField(payload, ["pod_id", "podId", "pod"]);
  if (fromPayload) return fromPayload;
  for (const line of [...lines].reverse()) {
    const m =
      line.match(/installed on pod\s+(\d+)/i) ??
      line.match(/pod[_\s-]?id["':=\s]+(\d+)/i);
    if (m?.[1]) return m[1];
  }
  return null;
};

const buildEditorEnv = (payload: unknown): string | null => {
  const baseUrl = objectStringField(payload, [
    "stable_ai_endpoint",
    "api_url",
    "base_url",
    "openai_base_url",
  ]);
  const key = objectStringField(payload, [
    "user_key",
    "api_key",
    "openai_api_key",
  ]);
  if (!baseUrl || !key) return null;
  return `OPENAI_BASE_URL=${baseUrl}\nOPENAI_API_KEY=${key}`;
};

const installPhase = (
  lines: string[],
  status: JobStatus,
  readiness: PodReadiness | null,
): { label: string; detail: string; progress: number } => {
  if (readiness) {
    const blocking = firstBlockingStage(readiness);
    if (readiness.open_enabled) {
      return {
        label: readiness.overall === "degraded" ? "Ready · degraded" : "Ready",
        detail: blocking?.detail ?? "Pod is serving traffic end-to-end.",
        progress: 100,
      };
    }
    if (readiness.overall === "failed") {
      return {
        label: "Needs attention",
        detail: blocking?.detail ?? "Readiness check failed.",
        progress: 100,
      };
    }
    const okCount = readiness.stages.filter((stage) =>
      ["ok", "skipped", "not_configured", "degraded"].includes(stage.status),
    ).length;
    const progress = Math.min(
      94,
      Math.max(
        62,
        Math.round((okCount / Math.max(1, readiness.stages.length)) * 92),
      ),
    );
    return {
      label: "Waiting for readiness",
      detail:
        blocking?.detail ??
        blocking?.label ??
        "Checking API, UI, and pod bootstrap.",
      progress,
    };
  }
  const text = lines.join("\n").toLowerCase();
  if (status === "success") {
    return {
      label: "Ready",
      detail: "Pod is serving traffic end-to-end.",
      progress: 100,
    };
  }
  if (status === "failed") {
    return {
      label: "Needs attention",
      detail: "Install did not reach ready state.",
      progress: 100,
    };
  }
  if (status === "lost") {
    return {
      label: "Checking lost",
      detail: "Stream disconnected before final status.",
      progress: 100,
    };
  }
  if (text.includes("pod ") && text.includes(" is ready")) {
    return {
      label: "Ready",
      detail: "Finalising install response…",
      progress: 96,
    };
  }
  if (text.includes("waiting for pod") || text.includes("readiness:")) {
    return {
      label: "Waiting for readiness",
      detail: "Checking API and browser UI before enabling Open.",
      progress: 82,
    };
  }
  if (text.includes("zero-config") || text.includes("config")) {
    return {
      label: "Configuring agent",
      detail: "Applying zero-config and credentials.",
      progress: 68,
    };
  }
  if (text.includes("installed on pod") || text.includes("deploy")) {
    return {
      label: "Starting container",
      detail: "Agent deployed; container is booting.",
      progress: 56,
    };
  }
  if (text.includes("allocating") || text.includes("request")) {
    return {
      label: "Allocating pod",
      detail: "Provider is reserving a pod slot.",
      progress: 34,
    };
  }
  if (status === "streaming") {
    return {
      label: "Installing",
      detail: "Running Tytus install workflow.",
      progress: 18,
    };
  }
  return {
    label: "Connecting",
    detail: "Opening install stream…",
    progress: 8,
  };
};

const InstallWizard: React.FC<InstallWizardProps> = ({
  agent,
  jobId,
  submitting,
  submitErr,
  jobStreamUrl,
  retryRevokePodId,
  retryRevokeStatus,
  retryRevokeLines,
  onConfirm,
  onRetry,
  onSuccess,
  onOpenAssistant,
  onConnectMessenger,
  onClose,
}) => {
  const client = useDaemonClient();
  const stream = useJobStream({ url: jobStreamUrl });
  const isStreaming = jobId !== null;
  const isDone =
    stream.status === "success" ||
    stream.status === "failed" ||
    stream.status === "lost";
  const isInstalling = isStreaming && !isDone;
  const knownPodId = useMemo(
    () => extractInstallPodId(stream.donePayload, stream.lines),
    [stream.donePayload, stream.lines],
  );
  const editorEnv = useMemo(
    () => buildEditorEnv(stream.donePayload),
    [stream.donePayload],
  );
  const [readiness, setReadiness] = useState<PodReadiness | null>(null);
  const [readinessErr, setReadinessErr] = useState<string | null>(null);
  const phase = useMemo(
    () => installPhase(stream.lines, stream.status, readiness),
    [readiness, stream.lines, stream.status],
  );
  const isHermes = agent.id === "hermes";
  const openLabel = isHermes ? "Open dashboard" : "Open assistant";
  const [editorEnvCopied, setEditorEnvCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!knownPodId || !isStreaming) {
      queueMicrotask(() => {
        if (cancelled) return;
        setReadiness(null);
        setReadinessErr(null);
      });
      return () => {
        cancelled = true;
      };
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const r = await client.getPodReadiness(knownPodId);
      if (cancelled) return;
      if (r.ok) {
        setReadiness(r.value);
        setReadinessErr(null);
        if (!r.value.open_enabled && stream.status !== "failed") {
          timer = setTimeout(poll, 2500);
        }
      } else {
        setReadinessErr(r.error.message);
        timer = setTimeout(poll, 4000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, isStreaming, knownPodId, stream.status]);

  const copyEditorEnv = useCallback(async () => {
    if (!editorEnv) return;
    try {
      await navigator.clipboard.writeText(editorEnv);
      setEditorEnvCopied(true);
      setTimeout(() => setEditorEnvCopied(false), 1200);
    } catch {
      // non-secure contexts can reject clipboard writes; env remains visible.
    }
  }, [editorEnv]);

  // Refresh daemon state once when the install completes successfully.
  // Done lives outside the modal — without this, the new pod wouldn't
  // appear in the Pods panel until the user closed the modal.
  const successFiredRef = useRef(false);
  useEffect(() => {
    if (stream.status === "success" && !successFiredRef.current) {
      successFiredRef.current = true;
      onSuccess();
    }
  }, [stream.status, onSuccess]);

  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-[520px] max-h-[80vh] rounded-xl flex flex-col overflow-hidden"
        style={{
          background: "var(--bg-window, #1E1E1E)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {!isStreaming && `Install ${agent.name}`}
              {isInstalling && `Installing ${agent.name}…`}
              {stream.status === "success" && `${agent.name} installed`}
              {stream.status === "failed" && `Install failed`}
              {stream.status === "lost" && `Stream lost`}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
              {agent.units} unit{agent.units === 1 ? "" : "s"} · min plan{" "}
              {agent.min_plan}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isInstalling}
            className="p-1 rounded-md transition-colors disabled:opacity-30"
            style={{
              background: "transparent",
              color: "var(--text-secondary)",
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
          {!isStreaming && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                {agent.description}
              </p>
              <div
                className="p-3 rounded-md text-[11px] flex items-start gap-2"
                style={{
                  background: "rgba(124,77,255,0.08)",
                  border: "1px solid rgba(124,77,255,0.20)",
                  color: "var(--text-secondary)",
                }}
              >
                <Sparkles size={12} className="flex-shrink-0 mt-0.5" />
                <span>
                  The daemon will pick a free pod slot automatically.
                  Allocation, image pull, and container start typically take
                  30–90 seconds.
                </span>
              </div>
              {submitErr && (
                <div
                  className="p-3 rounded-md text-xs flex items-start gap-2"
                  style={{
                    background: "rgba(244,67,54,0.10)",
                    border: "1px solid rgba(244,67,54,0.30)",
                    color: "var(--accent-error)",
                  }}
                >
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{submitErr}</span>
                </div>
              )}
            </div>
          )}

          {isStreaming && (
            <div className="space-y-3">
              <div
                className="rounded-lg p-3"
                style={{
                  background: "var(--bg-card, rgba(255,255,255,0.03))",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {phase.label}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      {phase.detail}
                    </div>
                  </div>
                  {!isDone && (
                    <Loader2
                      size={16}
                      className="animate-spin text-[var(--accent-primary)]"
                    />
                  )}
                </div>
                <div
                  className="mt-3 h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--bg-input)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${phase.progress}%`,
                      background:
                        stream.status === "failed"
                          ? "var(--accent-error)"
                          : "var(--accent-primary)",
                    }}
                  />
                </div>
              </div>
              {knownPodId && (
                <div
                  className="rounded-lg p-3"
                  style={{
                    background: "var(--bg-card, rgba(255,255,255,0.03))",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      Readiness · Pod {knownPodId}
                    </div>
                    {readiness && (
                      <span
                        className="text-[10px] uppercase tracking-wide"
                        style={{
                          color: readiness.open_enabled
                            ? "var(--accent-success)"
                            : readiness.overall === "failed"
                              ? "var(--accent-error)"
                              : "var(--accent-warning)",
                        }}
                      >
                        {readiness.open_enabled
                          ? "Open enabled"
                          : readiness.overall}
                      </span>
                    )}
                  </div>
                  {readinessErr && (
                    <div
                      className="text-[11px]"
                      style={{ color: "var(--accent-warning)" }}
                    >
                      Readiness probe failed: {readinessErr}
                    </div>
                  )}
                  {!readiness && !readinessErr && (
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      Waiting for daemon readiness details…
                    </div>
                  )}
                  {readiness && (
                    <div className="space-y-1.5">
                      {readiness.stages.map((stage) => (
                        <div
                          key={stage.id}
                          className="flex items-start gap-2 text-[11px]"
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
                                className="text-[var(--text-secondary)] truncate"
                                title={stage.detail}
                              >
                                {stage.detail}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <LogPane
                lines={stream.lines}
                status={stream.status}
                exitCode={stream.exitCode}
                failMessage={stream.failMessage}
                title="Install log"
                emptyText="Connecting to install stream…"
                maxLines={200}
                minHeight={200}
                maxHeight={360}
                className="rounded-md"
              >
                {stream.status === "success" && (
                  <div className="mt-2 text-[var(--terminal-text)]">
                    ✓ Install complete —{" "}
                    {readiness?.open_enabled === false
                      ? "waiting for readiness details"
                      : "pod is ready"}
                  </div>
                )}
                {stream.status === "failed" && (
                  <div
                    className="mt-2"
                    style={{ color: "var(--terminal-error)" }}
                  >
                    ✗{" "}
                    {stream.failMessage
                      ? stream.failMessage
                      : `Install exited with code ${stream.exitCode ?? "?"}`}
                  </div>
                )}
                {stream.status === "lost" && (
                  <div
                    className="mt-2"
                    style={{ color: "var(--terminal-warning)" }}
                  >
                    Stream disconnected. Check Settings → Pods to verify.
                  </div>
                )}
                {knownPodId && stream.status !== "success" && (
                  <div
                    className="mt-2"
                    style={{ color: "var(--terminal-warning)" }}
                  >
                    Pod {knownPodId} was allocated before failure. Retry will
                    revoke it first.
                  </div>
                )}
                {retryRevokePodId && (
                  <div
                    className="mt-3 pt-3 border-t"
                    style={{
                      borderColor: "rgba(255,255,255,0.10)",
                      color: "var(--terminal-warning)",
                    }}
                  >
                    Revoking pod {retryRevokePodId} before retry…{" "}
                    {retryRevokeStatus}
                    {retryRevokeLines.length > 0 && (
                      <div
                        className="mt-2"
                        style={{ color: "var(--terminal-text)" }}
                      >
                        {retryRevokeLines.slice(-20).join("\n")}
                      </div>
                    )}
                  </div>
                )}
              </LogPane>
            </div>
          )}

          {stream.status === "success" && knownPodId && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => onOpenAssistant(knownPodId)}
                disabled={readiness?.open_enabled === false}
                className={`${isHermes ? "col-span-2 " : ""}px-3 py-2 rounded-md text-xs font-medium transition-colors`}
                title={
                  readiness?.open_enabled === false
                    ? `Pod is not ready yet: ${phase.detail}`
                    : openLabel
                }
                style={{
                  background: "var(--bg-hover, rgba(255,255,255,0.04))",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                  opacity: readiness?.open_enabled === false ? 0.55 : 1,
                }}
              >
                {openLabel}
              </button>
              {!isHermes && (
                <button
                  onClick={() => onConnectMessenger(knownPodId)}
                  disabled={readiness?.open_enabled === false}
                  className="px-3 py-2 rounded-md text-xs font-medium transition-colors"
                  title={
                    readiness?.open_enabled === false
                      ? `Pod is not ready yet: ${phase.detail}`
                      : "Connect messenger"
                  }
                  style={{
                    background: "var(--bg-hover, rgba(255,255,255,0.04))",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-default)",
                    opacity: readiness?.open_enabled === false ? 0.55 : 1,
                  }}
                >
                  Connect messenger
                </button>
              )}
              {editorEnv && (
                <button
                  onClick={copyEditorEnv}
                  className="col-span-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: "var(--bg-hover, rgba(255,255,255,0.04))",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  {editorEnvCopied ? <Check size={12} /> : <Copy size={12} />}
                  {editorEnvCopied ? "Copied editor env" : "Copy editor env"}
                </button>
              )}
            </div>
          )}
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          {!isStreaming && (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-xs transition-colors"
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
                disabled={submitting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-60"
                style={{
                  background: "var(--accent-primary)",
                  color: "var(--text-on-accent)",
                }}
              >
                {submitting && <Loader2 size={12} className="animate-spin" />}
                Install
              </button>
            </>
          )}
          {isInstalling && (
            <span className="text-[11px] text-[var(--text-secondary)]">
              Cancel disabled while install runs.
            </span>
          )}
          {isDone &&
            (stream.status === "failed" || stream.status === "lost") && (
              <button
                onClick={() => onRetry(knownPodId ?? undefined)}
                disabled={retryRevokePodId !== null || submitting}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: "transparent",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                }}
              >
                {knownPodId ? `Revoke pod ${knownPodId} & try again` : "Retry"}
              </button>
            )}
          {isDone && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-md text-xs font-semibold transition-colors"
              style={{
                background: "var(--accent-primary)",
                color: "var(--text-on-accent)",
              }}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Sign-out confirmation modal
// ============================================================

interface SignOutConfirmProps {
  podCount: number;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const SignOutConfirm: React.FC<SignOutConfirmProps> = ({
  podCount,
  submitting,
  onConfirm,
  onCancel,
}) => (
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
            background: "rgba(244,67,54,0.12)",
            border: "1px solid rgba(244,67,54,0.30)",
          }}
        >
          <AlertTriangle size={18} style={{ color: "var(--accent-error)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Sign out of Tytus?
          </div>
          <div className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            Signing out{" "}
            <strong style={{ color: "var(--accent-error)" }}>
              revokes all pod allocations
            </strong>
            {podCount > 0 ? (
              <>
                {" "}
                — including {podCount} pod{podCount === 1 ? "" : "s"} you have
                running. Workspace data on those pods will be permanently lost.
              </>
            ) : (
              <> on this account.</>
            )}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-2">
            You can always sign in again from the Tytus tray menu.
          </div>
        </div>
      </div>

      <div
        className="px-5 py-3 flex items-center justify-end gap-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <button
          onClick={onCancel}
          disabled={submitting}
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
          disabled={submitting}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-60"
          style={{
            background: "var(--accent-error)",
            color: "var(--text-on-accent)",
          }}
        >
          {submitting && <Loader2 size={12} className="animate-spin" />}
          Sign out and revoke pods
        </button>
      </div>
    </div>
  </div>
);

// ============================================================
// Local data panel — surfaces the in-browser SQLite store and
// provides a one-click export so users can `sqlite3 tytusos.db`
// the file in their host shell. Useful for agentic apps that
// build on the same DB and want offline inspection / backup.
// ============================================================

const LocalDataPanel: React.FC = () => {
  const [meta, setMeta] = useState<{
    persistent: boolean;
    version: number;
    libVersion: string;
  } | null>(null);
  const [counts, setCounts] = useState<{
    history: number;
    collections: number;
    items: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dbMod = await import("@/lib/db");
        setMeta(dbMod.getDbMeta());
        const db = dbMod.getDb();
        if (!db) return;
        const [h, c, i] = await Promise.all([
          db.query<{ n: number }>("SELECT COUNT(*) as n FROM api_history"),
          db.query<{ n: number }>("SELECT COUNT(*) as n FROM api_collections"),
          db.query<{ n: number }>(
            "SELECT COUNT(*) as n FROM api_collection_items",
          ),
        ]);
        if (cancelled) return;
        setCounts({
          history: Number(h[0]?.n ?? 0),
          collections: Number(c[0]?.n ?? 0),
          items: Number(i[0]?.n ?? 0),
        });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onExport = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const { downloadDb } = await import("@/lib/db/download");
      await downloadDb();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          Local data (SQLite)
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
          Browser-side database for collections, history, and future agent apps.
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        <Row
          label="Storage"
          value={
            meta
              ? meta.persistent
                ? "OPFS (persistent)"
                : "In-memory (transient)"
              : "—"
          }
        />
        <Row label="SQLite version" value={meta?.libVersion ?? "—"} />
        <Row label="Schema version" value={meta ? `v${meta.version}` : "—"} />
        <Row
          label="Rows"
          value={
            counts
              ? `${counts.history} history · ${counts.collections} collections · ${counts.items} items`
              : "—"
          }
        />
      </div>
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--text-secondary)] leading-snug max-w-[60%]">
          Download as a real <code>.sqlite</code> file. Open with{" "}
          <code>sqlite3</code>, the SQLite Browser, or any tool that speaks the
          format.
        </div>
        <button
          onClick={onExport}
          disabled={busy || !meta}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
          style={{
            background: "var(--accent-primary)",
            color: "var(--text-on-accent)",
          }}
        >
          {busy ? "Exporting…" : "Export database…"}
        </button>
      </div>
      {err && (
        <div
          className="px-4 py-2 text-xs border-t"
          style={{
            color: "var(--accent-error)",
            borderColor: "var(--border-subtle)",
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
};

const SHARING_DIAGNOSTICS = [
  {
    action: "status" as const,
    label: "Run status",
    detail: "Check every garagetytus binding, pod credential, and sync worker.",
  },
  {
    action: "conflicts" as const,
    label: "Find conflicts",
    detail: "Scan bisync state for files that need manual resolution.",
  },
  {
    action: "list" as const,
    label: "List bindings",
    detail: "Print the full daemon-side bindings table.",
  },
  {
    action: "refresh-all" as const,
    label: "Refresh pod sign-in",
    detail: "Rotate or refresh pod credentials where the helper supports it.",
  },
];

type SharingAction = (typeof SHARING_DIAGNOSTICS)[number]["action"];

const normalizeSharingPodId = (pod: string): string =>
  pod.trim().replace(/^(wannolot|tytus)-/, "");

const SharingSettingsPanel: React.FC = () => {
  const client = useDaemonClient();
  const daemon = useDaemonStateContext();
  const { addNotification } = useNotifications();
  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const [garageStatus, setGarageStatus] = useState<GaragetytusStatus | null>(
    null,
  );
  const [sharingDefaults, setSharingDefaults] =
    useState<SharingDefaults | null>(null);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsErr, setDefaultsErr] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [cacheErr, setCacheErr] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<{
    id: string;
    action: string;
  } | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] =
    useState<SharingAction | null>(null);
  const [refreshingPod, setRefreshingPod] = useState<string | null>(null);
  const [provisioningPodKey, setProvisioningPodKey] = useState<string | null>(
    null,
  );
  const stream = useJobStream({
    url: activeJob ? client.jobStreamUrl(activeJob.id) : null,
  });
  const streamDone =
    stream.status === "success" ||
    stream.status === "failed" ||
    stream.status === "lost";

  const loadSharingState = useCallback(async () => {
    setListing(true);
    setListErr(null);
    setDefaultsErr(null);
    const [folders, status, defaults] = await Promise.all([
      client.getSharedFolders(),
      client.getGaragetytusStatus(),
      client.getSharingDefaults(),
    ]);
    setListing(false);
    if (!folders.ok) {
      setListErr(folders.error.message);
      return;
    }
    setBindings(folders.value.bindings);
    if (status.ok) {
      setGarageStatus(status.value);
    } else {
      setGarageStatus(null);
      setListErr(status.error.message);
    }
    if (defaults.ok) {
      setSharingDefaults(defaults.value);
    } else {
      setSharingDefaults(null);
      setDefaultsErr(defaults.error.message);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [folders, status, defaults] = await Promise.all([
        client.getSharedFolders(),
        client.getGaragetytusStatus(),
        client.getSharingDefaults(),
      ]);
      if (cancelled) return;
      if (folders.ok) {
        setBindings(folders.value.bindings);
        setListErr(null);
      } else {
        setListErr(folders.error.message);
      }
      if (status.ok) {
        setGarageStatus(status.value);
      } else {
        setGarageStatus(null);
        setListErr((prev) => prev ?? status.error.message);
      }
      if (defaults.ok) {
        setSharingDefaults(defaults.value);
        setDefaultsErr(null);
      } else {
        setSharingDefaults(null);
        setDefaultsErr(defaults.error.message);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const runDiagnostic = useCallback(
    async (action: SharingAction) => {
      if (activeJob && !streamDone) return;
      if (
        action === "refresh-all" &&
        sharingDefaults?.sharing_globally_enabled === false
      ) {
        setActionErr("Sharing is paused. Enable it before rotating credentials.");
        return;
      }
      setActionSubmitting(action);
      setActionErr(null);
      setActiveJob(null);
      const r = await client.postSharedFoldersRunStreamed(action);
      setActionSubmitting(null);
      if (!r.ok) {
        setActionErr(r.error.message);
        return;
      }
      setActiveJob({ id: r.value.job_id, action });
    },
    [activeJob, client, sharingDefaults?.sharing_globally_enabled, streamDone],
  );

  const runPodCredentialRefresh = useCallback(
    async (pod: string) => {
      if (activeJob && !streamDone) return;
      if (sharingDefaults?.sharing_globally_enabled === false) {
        setActionErr("Sharing is paused. Enable it before refreshing pod credentials.");
        return;
      }
      setRefreshingPod(pod);
      setActionErr(null);
      setActiveJob(null);
      const r = await client.postPodRefreshCreds(pod);
      setRefreshingPod(null);
      if (!r.ok) {
        setActionErr(r.error.message);
        return;
      }
      setActiveJob({ id: r.value.job_id, action: `refresh credentials ${pod}` });
    },
    [activeJob, client, sharingDefaults?.sharing_globally_enabled, streamDone],
  );

  const runPodSharedProvision = useCallback(
    async (pod: string, bucket: string) => {
      if (activeJob && !streamDone) return;
      if (sharingDefaults?.sharing_globally_enabled === false) {
        setActionErr("Sharing is paused. Enable it before provisioning pods.");
        return;
      }
      const key = `${pod}:${bucket}`;
      setProvisioningPodKey(key);
      setActionErr(null);
      setActiveJob(null);
      const r = await client.postSharedFoldersProvisionPod({
        pod,
        buckets: [bucket],
      });
      setProvisioningPodKey(null);
      if (!r.ok) {
        setActionErr(r.error.message);
        return;
      }
      setActiveJob({
        id: r.value.job_id,
        action: `provision shared storage ${pod} → ${bucket}`,
      });
    },
    [activeJob, client, sharingDefaults?.sharing_globally_enabled, streamDone],
  );

  const saveSharingDefaults = useCallback(
    async (patch: Partial<SharingDefaults>) => {
      setSavingDefaults(true);
      setDefaultsErr(null);
      const r = await client.postSharingDefaults(patch);
      setSavingDefaults(false);
      if (!r.ok) {
        setDefaultsErr(r.error.message);
        return;
      }
      setSharingDefaults(r.value);
    },
    [client],
  );

  const openCache = useCallback(async () => {
    setCacheErr(null);
    const r = await client.postSharedFoldersOpenCache();
    if (!r.ok) {
      setCacheErr(r.error.message);
      return;
    }
    addNotification({
      appId: "settings",
      appName: "Settings",
      appIcon: "Folder",
      title: "Sharing cache",
      message: "Opened the local garagetytus cache folder.",
      isRead: false,
    });
  }, [addNotification, client]);

  const bindingCount = bindings?.length ?? 0;
  const provisionedPods = useMemo(() => {
    const pods = new Set<string>();
    for (const binding of bindings ?? []) {
      for (const pod of binding.pods_provisioned) pods.add(pod);
    }
    return Array.from(pods).sort();
  }, [bindings]);
  const allocatedPods = daemon.state?.agents ?? [];
  const helperCount = garageStatus
    ? `${garageStatus.helpers.filter((h) => h.found).length}/${garageStatus.helpers.length}`
    : "—";
  const serviceValue = garageStatus
    ? garageStatus.running === true
      ? `Running :${garageStatus.port}`
      : garageStatus.running === false
        ? "Stopped"
        : garageStatus.state === "missing"
          ? "Not installed"
          : "Unknown"
    : "—";
  const serviceDetail =
    garageStatus?.version ??
    garageStatus?.status_text ??
    "Local Garage service health";
  const statusWarnings = garageStatus?.warnings ?? [];
  const sharingPaused = sharingDefaults?.sharing_globally_enabled === false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
          Sharing
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-2xl">
          Shared folders, pod credential refresh, and garagetytus diagnostics.
          This is the Tower parity surface; Files stays for day-to-day browsing.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard
          icon={<Server size={18} />}
          label="Service"
          value={serviceValue}
          detail={serviceDetail}
        />
        <MetricCard
          icon={<FolderSync size={18} />}
          label="Bindings"
          value={bindings === null ? "—" : String(bindingCount)}
          detail="Host folders mirrored to pods"
        />
        <MetricCard
          icon={<Box size={18} />}
          label="Provisioned pods"
          value={
            provisionedPods.length === 0 ? "—" : provisionedPods.join(", ")
          }
          detail="Pods with sharing credentials"
        />
        <MetricCard
          icon={<ShieldCheck size={18} />}
          label="Helpers"
          value={helperCount}
          detail={
            garageStatus?.missing_helpers.length
              ? `${garageStatus.missing_helpers.length} missing`
              : "Bind, diagnostics, pod refresh"
          }
        />
      </div>

      {statusWarnings.length > 0 && (
        <div
          className="p-3 rounded-lg text-xs flex items-start gap-2"
          style={{
            background: "rgba(255,193,7,0.10)",
            border: "1px solid rgba(255,193,7,0.30)",
            color: "var(--text-primary)",
          }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Sharing needs attention</div>
            <div className="mt-1 text-[var(--text-secondary)]">
              {statusWarnings.slice(0, 3).join(" · ")}
              {statusWarnings.length > 3 ? " · …" : ""}
            </div>
          </div>
        </div>
      )}

      {(listErr || actionErr || cacheErr || defaultsErr) && (
        <div
          className="p-3 rounded-lg text-xs flex items-start gap-2"
          style={{
            background: "rgba(244,67,54,0.10)",
            border: "1px solid rgba(244,67,54,0.30)",
            color: "#FFCDD2",
          }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{listErr ?? actionErr ?? cacheErr ?? defaultsErr}</span>
        </div>
      )}

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Defaults & safety
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            Stored in Tytus config. Existing bindings stay visible if sharing is
            paused; mutating bind/sync/credential operations are blocked.
          </div>
        </div>
        <div className="p-4 grid gap-3 md:grid-cols-2">
          <label
            className="p-3 rounded-lg flex items-center justify-between gap-3"
            style={{
              background: "var(--bg-hover, rgba(255,255,255,0.04))",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            <div>
              <div className="text-sm font-semibold">Sharing enabled</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                Global kill switch for bind, sync, and credential refresh.
              </div>
            </div>
            <input
              type="checkbox"
              checked={sharingDefaults?.sharing_globally_enabled ?? true}
              disabled={!sharingDefaults || savingDefaults}
              onChange={(e) =>
                void saveSharingDefaults({
                  sharing_globally_enabled: e.target.checked,
                })
              }
            />
          </label>
          <label
            className="p-3 rounded-lg flex items-center justify-between gap-3"
            style={{
              background: "var(--bg-hover, rgba(255,255,255,0.04))",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            <div>
              <div className="text-sm font-semibold">Auto-sync by default</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                Applies to newly bound folders only.
              </div>
            </div>
            <input
              type="checkbox"
              checked={sharingDefaults?.default_auto_sync ?? true}
              disabled={!sharingDefaults || savingDefaults}
              onChange={(e) =>
                void saveSharingDefaults({
                  default_auto_sync: e.target.checked,
                })
              }
            />
          </label>
          <div>
            <label className="text-[11px] font-medium text-[var(--text-secondary)]">
              Default bucket
            </label>
            <input
              className="mt-1 w-full px-3 py-2 rounded-md text-xs font-mono outline-none"
              style={{
                background: "var(--bg-input, rgba(255,255,255,0.04))",
                color: "var(--text-primary)",
                border: "1px solid var(--border-default)",
              }}
              value={sharingDefaults?.default_bucket ?? ""}
              disabled={!sharingDefaults || savingDefaults}
              onChange={(e) =>
                setSharingDefaults((prev) =>
                  prev ? { ...prev, default_bucket: e.target.value } : prev,
                )
              }
              onBlur={(e) =>
                void saveSharingDefaults({ default_bucket: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--text-secondary)]">
              Default local root
            </label>
            <input
              className="mt-1 w-full px-3 py-2 rounded-md text-xs font-mono outline-none"
              style={{
                background: "var(--bg-input, rgba(255,255,255,0.04))",
                color: "var(--text-primary)",
                border: "1px solid var(--border-default)",
              }}
              value={sharingDefaults?.default_local_root ?? ""}
              disabled={!sharingDefaults || savingDefaults}
              onChange={(e) =>
                setSharingDefaults((prev) =>
                  prev
                    ? { ...prev, default_local_root: e.target.value }
                    : prev,
                )
              }
              onBlur={(e) =>
                void saveSharingDefaults({
                  default_local_root: e.target.value,
                })
              }
            />
          </div>
        </div>
        {sharingPaused && (
          <div
            className="mx-4 mb-4 p-3 rounded-lg text-xs flex items-start gap-2"
            style={{
              background: "rgba(255,193,7,0.10)",
              border: "1px solid rgba(255,193,7,0.30)",
              color: "#FFE082",
            }}
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Sharing is paused. Existing bindings are read-only; bind, refresh,
              and credential rotation actions are disabled.
            </span>
          </div>
        )}
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between gap-3 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              Active bindings
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-0.5">
              Read-only overview. Bind and browse folders from the Files app.
            </div>
          </div>
          <button
            onClick={loadSharingState}
            disabled={listing}
            className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 disabled:opacity-60"
            style={{
              background: "var(--bg-hover, rgba(255,255,255,0.04))",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            {listing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Refresh
          </button>
        </div>
        <div
          className="divide-y"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {bindings === null ? (
            <div className="px-4 py-8 text-sm text-[var(--text-secondary)] flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading bindings…
            </div>
          ) : bindings.length === 0 ? (
            <div className="px-4 py-8 text-sm text-[var(--text-secondary)]">
              No shared folders configured yet. Open Files → Shared → Bind new
              folder.
            </div>
          ) : (
            bindings.map((binding) => {
              const provisionedIds = new Set(
                binding.pods_provisioned.map(normalizeSharingPodId),
              );
              const unprovisionedAllocatedPods = allocatedPods.filter(
                (pod) => !provisionedIds.has(normalizeSharingPodId(pod.pod_id)),
              );
              return (
                <div
                  key={`${binding.local_path}:${binding.bucket}`}
                  className="px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-[var(--text-primary)] truncate">
                        {binding.local_path}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] mt-1">
                        bucket {binding.bucket} · pods{" "}
                        {binding.pods_provisioned.length > 0
                          ? binding.pods_provisioned.join(", ")
                          : "none"}{" "}
                        · {binding.auto_sync ? "auto-sync on" : "manual sync"}
                      </div>
                      {(binding.pods_provisioned.length > 0 ||
                        unprovisionedAllocatedPods.length > 0) && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {binding.pods_provisioned.map((pod) => {
                            const busy =
                              refreshingPod === pod ||
                              (!!activeJob && !streamDone);
                            return (
                              <button
                                key={`refresh:${pod}`}
                                onClick={() =>
                                  void runPodCredentialRefresh(pod)
                                }
                                disabled={busy || sharingPaused}
                                className="px-2 py-1 rounded-md text-[10px] flex items-center gap-1 disabled:opacity-60"
                                style={{
                                  background:
                                    "var(--bg-hover, rgba(255,255,255,0.04))",
                                  border: "1px solid var(--border-default)",
                                  color: "var(--text-secondary)",
                                }}
                                title="Refresh this pod's shared-folder credentials"
                              >
                                {refreshingPod === pod ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={10} />
                                )}
                                Refresh {pod}
                              </button>
                            );
                          })}
                          {unprovisionedAllocatedPods.map((pod) => {
                            const podId = pod.pod_id;
                            const key = `${podId}:${binding.bucket}`;
                            const busy =
                              provisioningPodKey === key ||
                              (!!activeJob && !streamDone);
                            return (
                              <button
                                key={`provision:${podId}`}
                                onClick={() =>
                                  void runPodSharedProvision(
                                    podId,
                                    binding.bucket,
                                  )
                                }
                                disabled={busy || sharingPaused}
                                className="px-2 py-1 rounded-md text-[10px] flex items-center gap-1 disabled:opacity-60"
                                style={{
                                  background: "rgba(124, 77, 255, 0.12)",
                                  border: "1px solid rgba(124, 77, 255, 0.34)",
                                  color: "var(--accent-primary)",
                                }}
                                title="Install this shared folder into the pod workspace"
                              >
                                {provisioningPodKey === key ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : (
                                  <FolderSync size={10} />
                                )}
                                Provision {podId}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        void client.postSharedFoldersOpen(binding.local_path)
                      }
                      className="px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1.5 shrink-0"
                      style={{
                        background: "var(--bg-hover, rgba(255,255,255,0.04))",
                        border: "1px solid var(--border-default)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <ExternalLink size={11} /> Open
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Diagnostics
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            Runs the same garagetytus actions Tower exposed: status, conflicts,
            full list, and credential refresh.
          </div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {SHARING_DIAGNOSTICS.map((item) => {
            const busy =
              actionSubmitting === item.action ||
              (activeJob?.action === item.action && !streamDone);
            const blockedByPause =
              sharingPaused && item.action === "refresh-all";
            return (
              <button
                key={item.action}
                onClick={() => runDiagnostic(item.action)}
                disabled={busy || blockedByPause || (!!activeJob && !streamDone)}
                className="text-left p-3 rounded-lg transition-colors disabled:opacity-60"
                style={{
                  background: "var(--bg-hover, rgba(255,255,255,0.04))",
                  border: "1px solid var(--border-default)",
                }}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  {busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ListChecks
                      size={14}
                      className="text-[var(--accent-primary)]"
                    />
                  )}
                  {item.label}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-1 leading-snug">
                  {item.detail}
                </div>
              </button>
            );
          })}
        </div>
        {activeJob && (
          <div className="px-4 pb-4">
            <DiagnosticStreamPane
              action={activeJob.action}
              status={stream.status}
              lines={stream.lines}
              exitCode={stream.exitCode}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={openCache}
          className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5"
          style={{
            background: "var(--bg-hover, rgba(255,255,255,0.04))",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          <HardDriveDownload size={12} /> Open sharing cache
        </button>
      </div>
    </div>
  );
};

const MetricCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}> = ({ icon, label, value, detail }) => (
  <div
    className="rounded-xl p-4"
    style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border-subtle)",
    }}
  >
    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
      <span className="text-[var(--accent-primary)]">{icon}</span>
      {label}
    </div>
    <div className="text-lg font-semibold text-[var(--text-primary)] mt-2 truncate">
      {value}
    </div>
    <div className="text-[11px] text-[var(--text-secondary)] mt-1">
      {detail}
    </div>
  </div>
);

const DiagnosticStreamPane: React.FC<{
  action: string;
  status: JobStatus;
  lines: string[];
  exitCode: number | null;
}> = ({ action, status, lines, exitCode }) => (
  <LogPane
    title={action}
    status={status}
    lines={lines}
    exitCode={exitCode}
    maxLines={80}
    maxHeight={256}
    emptyText="Waiting for output…"
    filterBlank
  />
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-4 py-2.5 flex items-center justify-between">
    <span className="text-sm text-[var(--text-secondary)]">{label}</span>
    <span className="text-sm text-[var(--text-primary)] font-mono">
      {value}
    </span>
  </div>
);

export default Settings;
