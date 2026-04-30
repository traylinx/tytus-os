import { useEffect, useRef } from "react";
import { useOS } from "@/hooks/useOSStore";
import { shellTargetForHash } from "@/lib/shellRoutes";

const currentHash = () => globalThis.location?.hash ?? "";

// Once a deep-link has been consumed (target window opened with its
// routeNonce), clear the hash from the URL bar. We use replaceState
// instead of writing `location.hash = ""` to avoid firing a redundant
// hashchange event. Without this the URL bar lingers on the last deep-
// link target (e.g. `#/settings/agents`) even after the user has moved
// to a different window, which is cosmetically misleading.
const clearHash = () => {
  const loc = globalThis.location;
  const hist = globalThis.history;
  if (!loc || !hist || !loc.hash) return;
  hist.replaceState(null, "", `${loc.pathname}${loc.search}`);
};

export default function ShellRouteDispatcher() {
  const { dispatch } = useOS();
  const lastHandledHashRef = useRef<string | null>(null);

  useEffect(() => {
    const handleHash = () => {
      const hash = currentHash();
      if (hash === lastHandledHashRef.current) return;
      lastHandledHashRef.current = hash;

      const target = shellTargetForHash(hash);
      if (!target) return;

      dispatch({
        type: "OPEN_OR_FOCUS_WINDOW",
        appId: target.appId,
        args: target.args,
      });

      // The window args (incl. routeNonce) are now in app state; the
      // hash itself is no longer needed. Clear it so the URL bar
      // reflects the active OS shell, not the last deep-link.
      clearHash();
      lastHandledHashRef.current = "";
    };

    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [dispatch]);

  return null;
}
