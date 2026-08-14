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

/** A Many-to-Many relationship's intersect entity — its Web API EntitySet accepts GET (plain
 *  queries work fine) but not a normal POST/PATCH/DELETE with field values; those 400 with
 *  "Invalid property ... was found" because the intersect entity's two lookup columns aren't
 *  ordinary writable properties. Writes have to go through the relationship's $ref associate/
 *  disassociate endpoints instead (see writeOps.ts's insertIntersectRow/deleteIntersectRow),
 *  which need exactly the fields captured here. */
export interface ManyToManyInfo {
  intersectEntityName: string;
  entity1LogicalName: string;
  entity1IntersectAttribute: string;
  entity1NavigationPropertyName: string;
  entity2LogicalName: string;
  entity2IntersectAttribute: string;
  entity2NavigationPropertyName: string;
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
  entityListCache.clear();
  manyToManyCache.clear();
  optionSetCache.clear();
}

/** Cached like the rest of this module (`null` is a valid cached value — "confirmed not an
 *  intersect entity" — so presence is checked via `.has()`, not truthiness). */
const manyToManyCache = new Map<string, ManyToManyInfo | null>();

/** Returns the N:N relationship definition if `entityLogicalName` is an intersect entity, or
 *  `null` for an ordinary entity. `IsIntersect` is checked first as a cheap short-circuit — most
 *  entities aren't intersect entities and don't need the second (relationship-lookup) call.
 *  `RelationshipDefinitions/.../ManyToManyRelationshipMetadata?$filter=IntersectEntityName eq ...`
 *  finds the relationship without needing to already know either side's logical name (confirmed
 *  against a live org — the alternative, `EntityDefinitions(LogicalName='<oneSide>')/
 *  ManyToManyRelationships`, requires knowing one side up front, which we don't). */
export async function fetchManyToManyInfo(connectionId: string, entityLogicalName: string): Promise<ManyToManyInfo | null> {
  const trimmed = entityLogicalName.trim();
  const key = cacheKey(connectionId, trimmed);
  if (manyToManyCache.has(key)) return manyToManyCache.get(key)!;

  const entityDef = await callNative<{ IsIntersect: boolean }>("dataverse.request", {
    connectionId,
    method: "GET",
    path: `EntityDefinitions(LogicalName='${trimmed}')?$select=IsIntersect`,
  });
  if (!entityDef.IsIntersect) {
    manyToManyCache.set(key, null);
    return null;
  }

  const res = await callNative<{
    value: {
      Entity1LogicalName: string;
      Entity1IntersectAttribute: string;
      Entity1NavigationPropertyName: string;
      Entity2LogicalName: string;
      Entity2IntersectAttribute: string;
      Entity2NavigationPropertyName: string;
    }[];
  }>("dataverse.request", {
    connectionId,
    method: "GET",
    path:
      "RelationshipDefinitions/Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata" +
      `?$filter=IntersectEntityName eq '${trimmed}'` +
      "&$select=Entity1LogicalName,Entity1IntersectAttribute,Entity1NavigationPropertyName,Entity2LogicalName,Entity2IntersectAttribute,Entity2NavigationPropertyName",
  });
  const rel = res.value[0];
  const info: ManyToManyInfo | null = rel
    ? {
        intersectEntityName: trimmed,
        entity1LogicalName: rel.Entity1LogicalName,
        entity1IntersectAttribute: rel.Entity1IntersectAttribute,
        entity1NavigationPropertyName: rel.Entity1NavigationPropertyName,
        entity2LogicalName: rel.Entity2LogicalName,
        entity2IntersectAttribute: rel.Entity2IntersectAttribute,
        entity2NavigationPropertyName: rel.Entity2NavigationPropertyName,
      }
    : null;
  manyToManyCache.set(key, info);
  return info;
}

/** All entity logical names for a connection, cached per-connection — used for SQL4CDS's
 *  table-name autocomplete. EntityDefinitions doesn't support $orderby (confirmed against a live
 *  org), so results are sorted client-side instead. */
const entityListCache = new Map<string, string[]>();

export async function fetchEntityList(connectionId: string): Promise<string[]> {
  const cached = entityListCache.get(connectionId);
  if (cached) return cached;

  const res = await callNative<{ value: { LogicalName: string }[] }>("dataverse.request", {
    connectionId,
    method: "GET",
    path: "EntityDefinitions?$select=LogicalName",
  });
  const names = res.value.map((e) => e.LogicalName).sort();
  entityListCache.set(connectionId, names);
  return names;
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

export interface OptionSetValue {
  value: number;
  label: string;
}

/** Cached like the rest of this module, keyed by connection+entity+attribute. */
const optionSetCache = new Map<string, OptionSetValue[]>();

/** A Picklist attribute's option list (local or global — this endpoint returns either the same
 *  way, so no need to tell them apart up front). Confirmed against a live org:
 *  `EntityDefinitions(LogicalName='account')/Attributes(LogicalName='industrycode')/
 *  Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`
 *  returns `{ OptionSet: { Options: [{ Value, Label: { UserLocalizedLabel: { Label } } }] } }` —
 *  only State/Status attributes use a different metadata cast (StateAttributeMetadata/
 *  StatusAttributeMetadata), not covered here since those aren't in scope for the tools that
 *  use this (v1 editable-cell support is Picklist only, not State/Status). */
export async function fetchOptionSetValues(
  connectionId: string,
  entityLogicalName: string,
  attributeLogicalName: string,
): Promise<OptionSetValue[]> {
  const trimmedEntity = entityLogicalName.trim();
  const trimmedAttribute = attributeLogicalName.trim();
  const key = `${cacheKey(connectionId, trimmedEntity)}:${trimmedAttribute.toLowerCase()}`;
  const cached = optionSetCache.get(key);
  if (cached) return cached;

  const res = await callNative<{
    OptionSet: { Options: { Value: number; Label: { UserLocalizedLabel: { Label: string } | null } }[] };
  }>("dataverse.request", {
    connectionId,
    method: "GET",
    path:
      `EntityDefinitions(LogicalName='${trimmedEntity}')/Attributes(LogicalName='${trimmedAttribute}')` +
      "/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)",
  });
  const options = res.OptionSet.Options.map((o) => ({ value: o.Value, label: o.Label.UserLocalizedLabel?.Label ?? String(o.Value) }));
  optionSetCache.set(key, options);
  return options;
}
