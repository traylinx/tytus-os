import { createContext, useContext, type ReactNode } from "react";
import { useDaemonClient } from "@/hooks/useDaemonClient";
import {
  useDaemonState,
  type UseDaemonStateResult,
} from "@/hooks/useDaemonState";

const DaemonStateContext = createContext<UseDaemonStateResult | null>(null);

interface ProviderProps {
  children: ReactNode;
  intervalMs?: number;
}

export const DaemonStateProvider = ({
  children,
  intervalMs = 4000,
}: ProviderProps) => {
  const client = useDaemonClient();
  const value = useDaemonState({ client, intervalMs });
  return (
    <DaemonStateContext.Provider value={value}>
      {children}
    </DaemonStateContext.Provider>
  );
};

export const useDaemonStateContext = (): UseDaemonStateResult => {
  const v = useContext(DaemonStateContext);
  if (!v)
    throw new Error(
      "useDaemonStateContext must be used within DaemonStateProvider",
    );
  return v;
};
