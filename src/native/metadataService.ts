import { callNative } from "./bridge";

export interface EntityMeta {
  logicalName: string;
  entitySetName: string;
  primaryIdAttribute: string;
}

/** Keyed by `${connectionId}:${logicalName}` — the real EntitySetName/PrimaryIdAttribute from
 *  metadata, shared across every tool that needs to turn a logical entity name into a Web API
 *  collection path. Replaces each tool guessing with its own naive-pluralization heuristic
 *  (SQL4CDS, FetchXML Builder, data-migration all used to duplicate that logic). */
const cache = new Map<string, EntityMeta>();

function cacheKey(connectionId: string, logicalName: string): string {
  return `${connectionId}:${logicalName.trim().toLowerCase()}`;
}

export async function fetchEntityMeta(connectionId: string, logicalName: string): Promise<EntityMeta> {
  const trimmed = logicalName.trim();
  const key = cacheKey(connectionId, trimmed);
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await callNative<{ EntitySetName: string; PrimaryIdAttribute: string }>("dataverse.request", {
    connectionId,
    method: "GET",
    path: `EntityDefinitions(LogicalName='${trimmed}')?$select=EntitySetName,PrimaryIdAttribute`,
  });
  const meta: EntityMeta = {
    logicalName: trimmed,
    entitySetName: res.EntitySetName,
    primaryIdAttribute: res.PrimaryIdAttribute,
  };
  cache.set(key, meta);
  return meta;
}

/** Drop one entity's cached metadata so the next fetch re-reads it from the server — use after
 *  a metadata publish, or when a user suspects the cached value is stale. */
export function invalidateEntityMeta(connectionId: string, logicalName: string): void {
  cache.delete(cacheKey(connectionId, logicalName));
}

export function clearEntityMetaCache(): void {
  cache.clear();
}
