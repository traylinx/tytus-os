import { useEffect, useRef } from "react";
import { useOS } from "@/hooks/useOSStore";
import { shellTargetForHash } from "@/lib/shellRoutes";

const currentHash = () => globalThis.location?.hash ?? "";

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
    };

    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [dispatch]);

  return null;
}
