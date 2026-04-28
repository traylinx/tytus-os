import { useEffect, useState } from "react";
import { parseHash, type Route } from "@/lib/router";

export const useHashRoute = (): Route => {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof location !== "undefined" ? location.hash : ""),
  );

  useEffect(() => {
    const handler = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", handler);
    // hashchange does NOT fire on initial load; sync once.
    handler();
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return route;
};
