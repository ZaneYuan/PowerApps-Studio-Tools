import { callNative } from "./bridge";

export interface RelationshipMeta {
  ReferencingAttribute: string;
  ReferencingEntityNavigationPropertyName: string;
  ReferencedEntity: string;
}

/** Keyed by `${connectionId}:${entityLogicalName}` — a small, generic, cross-tool cache of an
 *  entity's many-to-one relationships, used to resolve `@odata.bind` navigation property names
 *  for write payloads instead of guessing them from the attribute's display name. */
const cache = new Map<string, RelationshipMeta[]>();

async function loadManyToOne(connectionId: string, entityLogicalName: string): Promise<RelationshipMeta[]> {
  const key = `${connectionId}:${entityLogicalName}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await callNative<{ value: RelationshipMeta[] }>("dataverse.request", {
    connectionId,
    method: "GET",
    path:
      `EntityDefinitions(LogicalName='${entityLogicalName}')/ManyToOneRelationships` +
      `?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity`,
  });
  cache.set(key, res.value);
  return res.value;
}

/** Resolves the `{navProp}` to use as `{navProp}@odata.bind` when creating/updating a lookup
 *  on `entityLogicalName`. Pass `referencedEntity` to disambiguate polymorphic lookups (like
 *  `sdkmessageprocessingstep.eventhandler`, which can point at either plugintype or
 *  serviceendpoint) where several relationships share the same referencing attribute. */
export async function getBindNavigationProperty(
  connectionId: string,
  entityLogicalName: string,
  referencingAttribute: string,
  referencedEntity?: string,
): Promise<string> {
  const rels = await loadManyToOne(connectionId, entityLogicalName);
  const candidates = rels.filter(
    (r) => r.ReferencingAttribute.toLowerCase() === referencingAttribute.toLowerCase(),
  );
  const match = referencedEntity
    ? candidates.find((r) => r.ReferencedEntity.toLowerCase() === referencedEntity.toLowerCase())
    : candidates[0];
  if (!match) {
    throw new Error(
      `找不到 ${entityLogicalName}.${referencingAttribute}${referencedEntity ? ` (→ ${referencedEntity})` : ""} 对应的导航属性名`,
    );
  }
  return match.ReferencingEntityNavigationPropertyName;
}

export function clearNavPropertyCache(): void {
  cache.clear();
}

/** Exposes the cached many-to-one relationship list directly — used by Record Explorer to
 *  resolve which entity a lookup *value* points to (via `ReferencingAttribute` →
 *  `ReferencedEntity`) without a second metadata call, reusing the same cache
 *  `getBindNavigationProperty` already populates for @odata.bind resolution. */
export async function getManyToOneRelationships(
  connectionId: string,
  entityLogicalName: string,
): Promise<RelationshipMeta[]> {
  return loadManyToOne(connectionId, entityLogicalName);
}

/** attribute logical name (lowercased) -> every ManyToOneRelationships candidate for it. More
 *  than one entry for the same attribute means a polymorphic lookup — callers that can't
 *  disambiguate (no `_value@...lookuplogicalname` annotation to read) should treat that as
 *  unresolvable. Shared by Record Explorer (read-side: which entity does a populated lookup
 *  point to) and the data migration tool (write-side: build `@odata.bind` for a lookup column). */
export async function buildLookupRelationshipMap(
  connectionId: string,
  entityLogicalName: string,
): Promise<Map<string, RelationshipMeta[]>> {
  const rels = await loadManyToOne(connectionId, entityLogicalName);
  const map = new Map<string, RelationshipMeta[]>();
  for (const r of rels) {
    const attr = r.ReferencingAttribute.toLowerCase();
    const list = map.get(attr) ?? [];
    list.push(r);
    map.set(attr, list);
  }
  return map;
}
