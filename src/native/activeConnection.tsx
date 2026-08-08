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
}

interface ActiveConnectionContextValue {
  connections: ConnectionDto[];
  activeConnectionId: string | null;
  setActiveConnectionId: (id: string | null) => void;
  refreshConnections: () => Promise<void>;
}

const ActiveConnectionContext = createContext<ActiveConnectionContextValue | null>(null);

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
  return ctx;
}
