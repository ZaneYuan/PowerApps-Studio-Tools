import { useEffect, useState } from "react";
import { fetchEntityMeta, invalidateEntityMeta } from "./metadataService";

export interface UseEntitySetNameResult {
  /** override (if the user typed one) → resolved real value → "" while neither is available yet */
  entitySetName: string;
  override: string;
  setOverride: (value: string) => void;
  /** the real EntitySetName once the metadata call succeeds, null otherwise (loading/no
   *  connection/lookup failed) — callers fall back to a naive-pluralization guess for the
   *  placeholder while this is null */
  resolved: string | null;
  loading: boolean;
  error: string | null;
  /** invalidate the cached value for this entity and re-fetch */
  refresh: () => void;
}

/** Resolves `logicalName` to its real EntitySetName via the shared metadata cache, with a
 *  user-editable override that always wins. Shared by SQL4CDS and FetchXML Builder so both
 *  stop guessing with naive pluralization once a connection is available. */
export function useEntitySetName(connectionId: string | null, logicalName: string): UseEntitySetNameResult {
  const [override, setOverride] = useState("");
  const [resolved, setResolved] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const trimmed = logicalName.trim();

  useEffect(() => {
    setResolved(null);
    setError(null);
    if (!connectionId || !trimmed) return;

    let cancelled = false;
    setLoading(true);
    fetchEntityMeta(connectionId, trimmed)
      .then((meta) => {
        if (!cancelled) setResolved(meta.entitySetName);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, trimmed, nonce]);

  return {
    entitySetName: override || resolved || "",
    override,
    setOverride,
    resolved,
    loading,
    error,
    refresh: () => {
      if (connectionId && trimmed) invalidateEntityMeta(connectionId, trimmed);
      setNonce((n) => n + 1);
    },
  };
}
