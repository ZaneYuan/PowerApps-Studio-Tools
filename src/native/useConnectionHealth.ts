import { useEffect, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "./bridge";
import { formatDataverseError } from "../shared/errorFormatting";

export interface ConnectionHealth {
  status: "idle" | "checking" | "ok" | "error";
  error?: string;
}

/** Pings WhoAmI (the same lightweight connectivity check ConnectionsPage.tsx's own "登录 +
 *  WhoAmI" button already uses) whenever `connectionId` changes, so a tool's own connection
 *  picker can show at a glance whether the bound connection is actually still usable instead of
 *  only finding out once some real query/write fails. `idle` outside the desktop shell or with no
 *  connection selected — this never runs without both. */
export function useConnectionHealth(connectionId: string | null): ConnectionHealth {
  const [health, setHealth] = useState<ConnectionHealth>({ status: "idle" });

  useEffect(() => {
    if (!connectionId || !isNativeBridgeAvailable()) {
      setHealth({ status: "idle" });
      return;
    }
    let cancelled = false;
    setHealth({ status: "checking" });
    callNative("dataverse.request", { connectionId, method: "GET", path: "WhoAmI" })
      .then(() => {
        if (!cancelled) setHealth({ status: "ok" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setHealth({ status: "error", error: formatDataverseError(err).summary });
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  return health;
}
