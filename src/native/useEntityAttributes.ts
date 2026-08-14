import { useEffect, useState } from "react";
import { fetchAttributes, fetchEntityList, type AttributeMeta } from "./metadataService";

export interface UseEntityAttributesResult {
  /** null while loading, while entityLogicalName doesn't resolve to a real entity yet, or once
   *  it's empty — callers treat null as "no suggestions / no type info available yet", not an
   *  error (the user may just still be typing the entity name). */
  attributes: AttributeMeta[] | null;
  loading: boolean;
  error: string | null;
}

/** Resolves `entityLogicalName`'s real attribute list, but only once the name is confirmed to be
 *  a real entity — checked against the already-cached `fetchEntityList` result first. Without
 *  this gate, typing an entity name character by character would fire a doomed-to-fail
 *  `fetchAttributes` call on every keystroke, and every field-name input scoped to that entity
 *  (filter condition, order clause, link from/to) would each discover "not valid yet" via its own
 *  redundant failed network call instead of one shared, cheap membership check. */
export function useEntityAttributes(connectionId: string | null, entityLogicalName: string): UseEntityAttributesResult {
  const [attributes, setAttributes] = useState<AttributeMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = entityLogicalName.trim();

  useEffect(() => {
    setAttributes(null);
    setError(null);
    if (!connectionId || !trimmed) return;

    let cancelled = false;
    setLoading(true);
    fetchEntityList(connectionId)
      .then((names) => {
        if (cancelled) return null;
        const exists = names.some((n) => n.toLowerCase() === trimmed.toLowerCase());
        return exists ? fetchAttributes(connectionId, trimmed) : null;
      })
      .then((attrs) => {
        if (!cancelled && attrs) setAttributes(attrs);
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
  }, [connectionId, trimmed]);

  return { attributes, loading, error };
}
