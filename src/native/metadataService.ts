import { callNative } from "./bridge";

export interface EntityMeta {
  logicalName: string;
  entitySetName: string;
  primaryIdAttribute: string;
  primaryNameAttribute: string;
}

export interface AttributeMeta {
  logicalName: string;
  attributeType: string;
  isCustomAttribute: boolean;
}

/** Keyed by `${connectionId}:${logicalName}` — the real EntitySetName/PrimaryIdAttribute from
 *  metadata, shared across every tool that needs to turn a logical entity name into a Web API
 *  collection path. Replaces each tool guessing with its own naive-pluralization heuristic
 *  (SQL4CDS, FetchXML Builder, data-migration all used to duplicate that logic). */
const cache = new Map<string, EntityMeta>();
const attributeCache = new Map<string, AttributeMeta[]>();

function cacheKey(connectionId: string, logicalName: string): string {
  return `${connectionId}:${logicalName.trim().toLowerCase()}`;
}

export async function fetchEntityMeta(connectionId: string, logicalName: string): Promise<EntityMeta> {
  const trimmed = logicalName.trim();
  const key = cacheKey(connectionId, trimmed);
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await callNative<{ EntitySetName: string; PrimaryIdAttribute: string; PrimaryNameAttribute: string }>(
    "dataverse.request",
    {
      connectionId,
      method: "GET",
      path: `EntityDefinitions(LogicalName='${trimmed}')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`,
    },
  );
  const meta: EntityMeta = {
    logicalName: trimmed,
    entitySetName: res.EntitySetName,
    primaryIdAttribute: res.PrimaryIdAttribute,
    primaryNameAttribute: res.PrimaryNameAttribute,
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
  attributeCache.clear();
}

/** All of an entity's attributes (excluding "Virtual" — compound/image-type fields that either
 *  can't be $select-ed directly or aren't meaningful on their own), cached the same way as
 *  fetchEntityMeta. Used by Record Explorer to build a full-field $select and to tell custom
 *  lookups apart from system ones. */
export async function fetchAttributes(connectionId: string, logicalName: string): Promise<AttributeMeta[]> {
  const trimmed = logicalName.trim();
  const key = cacheKey(connectionId, trimmed);
  const cached = attributeCache.get(key);
  if (cached) return cached;

  const res = await callNative<{
    value: { LogicalName: string; AttributeType: string; IsCustomAttribute: boolean }[];
  }>("dataverse.request", {
    connectionId,
    method: "GET",
    path: `EntityDefinitions(LogicalName='${trimmed}')/Attributes?$select=LogicalName,AttributeType,IsCustomAttribute`,
  });
  const attrs = res.value
    .filter((a) => a.AttributeType !== "Virtual")
    .map((a) => ({ logicalName: a.LogicalName, attributeType: a.AttributeType, isCustomAttribute: a.IsCustomAttribute }));
  attributeCache.set(key, attrs);
  return attrs;
}
