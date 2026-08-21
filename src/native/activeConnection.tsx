import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { callNative, isNativeBridgeAvailable } from "./bridge";

export interface ConnectionDto {
  id: string;
  name: string;
  environmentUrl: string;
  authType: "Interactive" | "ClientSecret" | "Certificate";
  tenantId?: string;
  clientId?: string;
  hasSecret: boolean;
  certificateFilePath?: string;
  hasCertificatePassword: boolean;
  allowWrite: boolean;
}

interface ActiveConnectionContextValue {
  connections: ConnectionDto[];
  activeConnectionId: string | null;
  setActiveConnectionId: (id: string | null) => void;
  refreshConnections: () => Promise<void>;
}

const ActiveConnectionContext = createContext<ActiveConnectionContextValue | null>(null);

/** Set by ToolPanel to bind one open tab's tools to that tab's own connection instead of the
 *  single global one — `undefined` means "no override, use the global value" (the Home page and
 *  any context outside a tab). This is what lets two tabs of the same tool run against two
 *  different connections simultaneously: every tool component keeps calling useActiveConnection()
 *  exactly as before, but the id it reads is transparently swapped per tab via this context. */
export const TabConnectionContext = createContext<string | null | undefined>(undefined);

const STORAGE_KEY = "msdpptools.activeConnectionId";

export function ActiveConnectionProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [activeConnectionId, setActiveConnectionIdState] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  async function refreshConnections() {
    if (!isNativeBridgeAvailable()) return;
    const list = await callNative<ConnectionDto[]>("connections.list");
    setConnections(list);
  }

  useEffect(() => {
    void refreshConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (connections.length === 0) return;
    if (activeConnectionId && !connections.some((c) => c.id === activeConnectionId)) {
      setActiveConnectionIdState(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [connections, activeConnectionId]);

  function setActiveConnectionId(id: string | null) {
    setActiveConnectionIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <ActiveConnectionContext.Provider
      value={{ connections, activeConnectionId, setActiveConnectionId, refreshConnections }}
    >
      {children}
    </ActiveConnectionContext.Provider>
  );
}

export function useActiveConnection(): ActiveConnectionContextValue {
  const ctx = useContext(ActiveConnectionContext);
  if (!ctx) throw new Error("useActiveConnection 必须在 ActiveConnectionProvider 内使用");
  const tabOverride = useContext(TabConnectionContext);
  if (tabOverride === undefined) return ctx;
  // Inside a tab: activeConnectionId reflects *this tab's* bound connection. setActiveConnectionId
  // still targets the global/pending value (only the sidebar's "open a new tab" flow and the
  // connection switcher's own no-tab-focused state use the setter directly) — no tool page calls
  // it today, so this is only reachable if one starts to.
  return { ...ctx, activeConnectionId: tabOverride };
}
