import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createDaemonClient, type DaemonClient } from "@/lib/daemon";
import { getDaemonBaseUrl } from "@/lib/daemonBaseUrl";

const DaemonClientContext = createContext<DaemonClient | null>(null);

interface ProviderProps {
  children: ReactNode;
  /** Override for tests or alternate hosts. */
  client?: DaemonClient;
}

export const DaemonClientProvider = ({ children, client }: ProviderProps) => {
  const value = useMemo<DaemonClient>(
    () => client ?? createDaemonClient({ baseUrl: getDaemonBaseUrl() }),
    [client],
  );
  return (
    <DaemonClientContext.Provider value={value}>
      {children}
    </DaemonClientContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useDaemonClient = (): DaemonClient => {
  const c = useContext(DaemonClientContext);
  if (!c)
    throw new Error("useDaemonClient must be used within DaemonClientProvider");
  return c;
};
