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
// Caches the in-flight Promise, not just the resolved value — several sibling components can ask
// for the same entity's metadata in the same tick (e.g. multiple FieldNameInput instances scoped
// to the same entity mounting together), and without this they'd each fire their own redundant
// network request before the first one resolves. A rejected promise evicts its own cache entry
// (see the `.catch()` below each `cache.set`) so a transient failure doesn't get cached forever —
// the next call genuinely retries instead of replaying the same rejection.
const cache = new Map<string, Promise<EntityMeta>>();
const attributeCache = new Map<string, Promise<AttributeMeta[]>>();

function cacheKey(connectionId: string, logicalName: string): string {
  return `${connectionId}:${logicalName.trim().toLowerCase()}`;
}

export function fetchEntityMeta(connectionId: string, logicalName: string): Promise<EntityMeta> {
  const trimmed = logicalName.trim();
  const key = cacheKey(connectionId, trimmed);
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<EntityMeta> => {
    const res = await callNative<{ EntitySetName: string; PrimaryIdAttribute: string; PrimaryNameAttribute: string }>(
      "dataverse.request",
      {
        connectionId,
        method: "GET",
        path: `EntityDefinitions(LogicalName='${trimmed}')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`,
      },
    );
    return {
      logicalName: trimmed,
      entitySetName: res.EntitySetName,
      primaryIdAttribute: res.PrimaryIdAttribute,
      primaryNameAttribute: res.PrimaryNameAttribute,
    };
  })();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
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
  defaultViewOrderCache.clear();
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
const entityListCache = new Map<string, Promise<string[]>>();

export function fetchEntityList(connectionId: string): Promise<string[]> {
  const cached = entityListCache.get(connectionId);
  if (cached) return cached;

  const promise = (async (): Promise<string[]> => {
    const res = await callNative<{ value: { LogicalName: string }[] }>("dataverse.request", {
      connectionId,
      method: "GET",
      path: "EntityDefinitions?$select=LogicalName",
    });
    return res.value.map((e) => e.LogicalName).sort();
  })();
  entityListCache.set(connectionId, promise);
  promise.catch(() => entityListCache.delete(connectionId));
  return promise;
}

/** The standard audit/framework columns Dataverse adds to (almost) every entity automatically —
 *  never something a user actually wants to bulk-copy or migrate 1:1 onto a new record (a copy
 *  should get its own createdon/modifiedby/etc. from the server, not inherit the source row's).
 *  Fixed, well-known logical names (part of Dataverse's base entity contract, not something an
 *  org can rename) — checked as a name set rather than derived from any metadata flag because
 *  there isn't one: ordinary out-of-box fields (e.g. account.name) are just as much
 *  `IsCustomAttribute: false` as these are. Used by Data Copy / Data Migration to default these
 *  columns unchecked instead of matching every other column. */
const SYSTEM_AUDIT_FIELDS = new Set([
  "createdon",
  "createdby",
  "createdonbehalfby",
  "modifiedon",
  "modifiedby",
  "modifiedonbehalfby",
  "overriddencreatedon",
  "organizationid",
  "importsequencenumber",
  "timezoneruleversionnumber",
  "utcconversiontimezonecode",
  "versionnumber",
  "statecode",
  "statuscode",
  "ownerid",
  "owninguser",
  "owningteam",
  "owningbusinessunit",
]);

export function isSystemAuditField(logicalName: string): boolean {
  return SYSTEM_AUDIT_FIELDS.has(logicalName.toLowerCase());
}

/** An entity's default public view column order (`querytype eq 0 and isdefault eq true` — the
 *  one that actually shows up as the grid view in Dataverse's own UI, confirmed against a live
 *  org), parsed from its `layoutxml`'s `<cell name="...">` sequence. Skips linked-entity columns
 *  (`name` containing "." — a related record's field, not this entity's own attribute) since
 *  callers only care about ordering this entity's own columns. Falls back to `[]` (not throwing)
 *  when an entity has no such view or `layoutxml` is null — callers treat that as "no view-order
 *  signal, fall back to alphabetical" rather than an error. Cached like the rest of this module. */
const defaultViewOrderCache = new Map<string, Promise<string[]>>();

export function fetchDefaultViewColumnOrder(connectionId: string, entityLogicalName: string): Promise<string[]> {
  const trimmed = entityLogicalName.trim();
  const key = cacheKey(connectionId, trimmed);
  const cached = defaultViewOrderCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<string[]> => {
    const res = await callNative<{ value: { layoutxml: string | null }[] }>("dataverse.request", {
      connectionId,
      method: "GET",
      path:
        "savedqueries?$select=layoutxml" +
        `&$filter=returnedtypecode eq '${trimmed}' and querytype eq 0 and isdefault eq true`,
    });
    const layoutXml = res.value[0]?.layoutxml;
    if (!layoutXml) return [];
    const names: string[] = [];
    for (const m of layoutXml.matchAll(/<cell\s+name="([^"]+)"/g)) {
      if (!m[1].includes(".")) names.push(m[1]);
    }
    return names;
  })().catch((err) => {
    defaultViewOrderCache.delete(key);
    throw err;
  });
  defaultViewOrderCache.set(key, promise);
  return promise;
}

/** Reorders a column-name list for display: the primary key first (if present), then every
 *  column that appears on the entity's default view in that view's own order, then everything
 *  else alphabetically. Pure/sync — `defaultViewOrder` and `primaryIdAttribute` are fetched
 *  separately (see `fetchDefaultViewColumnOrder`/`fetchEntityMeta`) so this can be unit-tested
 *  and reused without a connection. Case-insensitive matching throughout since Dataverse logical
 *  names are, but the caller's original casing is preserved in the output. */
export function sortColumnsForDisplay(columnNames: string[], primaryIdAttribute: string, defaultViewOrder: string[]): string[] {
  const remaining = new Map(columnNames.map((name) => [name.toLowerCase(), name]));
  const pkLower = primaryIdAttribute.toLowerCase();
  const ordered: string[] = [];

  const pk = remaining.get(pkLower);
  if (pk) {
    ordered.push(pk);
    remaining.delete(pkLower);
  }
  for (const viewName of defaultViewOrder) {
    const match = remaining.get(viewName.toLowerCase());
    if (match) {
      ordered.push(match);
      remaining.delete(viewName.toLowerCase());
    }
  }
  ordered.push(...Array.from(remaining.values()).sort((a, b) => a.localeCompare(b)));
  return ordered;
}

/** All of an entity's attributes (excluding "Virtual" — compound/image-type fields that either
 *  can't be $select-ed directly or aren't meaningful on their own), cached the same way as
 *  fetchEntityMeta. Used by Record Explorer to build a full-field $select and to tell custom
 *  lookups apart from system ones. */
export function fetchAttributes(connectionId: string, logicalName: string): Promise<AttributeMeta[]> {
  const trimmed = logicalName.trim();
  const key = cacheKey(connectionId, trimmed);
  const cached = attributeCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<AttributeMeta[]> => {
    const res = await callNative<{
      value: { LogicalName: string; AttributeType: string; IsCustomAttribute: boolean }[];
    }>("dataverse.request", {
      connectionId,
      method: "GET",
      path: `EntityDefinitions(LogicalName='${trimmed}')/Attributes?$select=LogicalName,AttributeType,IsCustomAttribute`,
    });
    return res.value
      .filter((a) => a.AttributeType !== "Virtual")
      .map((a) => ({ logicalName: a.LogicalName, attributeType: a.AttributeType, isCustomAttribute: a.IsCustomAttribute }));
  })();
  attributeCache.set(key, promise);
  promise.catch(() => attributeCache.delete(key));
  return promise;
}

export interface OptionSetValue {
  value: number;
  label: string;
}

/** Cached like the rest of this module, keyed by connection+entity+attribute+metadata cast. */
const optionSetCache = new Map<string, OptionSetValue[]>();

async function fetchOptionSetValuesForCast(
  connectionId: string,
  entityLogicalName: string,
  attributeLogicalName: string,
  cast: string,
): Promise<OptionSetValue[]> {
  const trimmedEntity = entityLogicalName.trim();
  const trimmedAttribute = attributeLogicalName.trim();
  const key = `${cacheKey(connectionId, trimmedEntity)}:${trimmedAttribute.toLowerCase()}:${cast}`;
  const cached = optionSetCache.get(key);
  if (cached) return cached;

  const res = await callNative<{
    OptionSet: { Options: { Value: number; Label: { UserLocalizedLabel: { Label: string } | null } }[] };
  }>("dataverse.request", {
    connectionId,
    method: "GET",
    path:
      `EntityDefinitions(LogicalName='${trimmedEntity}')/Attributes(LogicalName='${trimmedAttribute}')` +
      `/Microsoft.Dynamics.CRM.${cast}?$select=LogicalName&$expand=OptionSet($select=Options)`,
  });
  const options = res.OptionSet.Options.map((o) => ({ value: o.Value, label: o.Label.UserLocalizedLabel?.Label ?? String(o.Value) }));
  optionSetCache.set(key, options);
  return options;
}

/** A Picklist attribute's option list (local or global — this endpoint returns either the same
 *  way, so no need to tell them apart up front). Confirmed against a live org:
 *  `EntityDefinitions(LogicalName='account')/Attributes(LogicalName='industrycode')/
 *  Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`
 *  returns `{ OptionSet: { Options: [{ Value, Label: { UserLocalizedLabel: { Label } } }] } }`. */
export async function fetchOptionSetValues(
  connectionId: string,
  entityLogicalName: string,
  attributeLogicalName: string,
): Promise<OptionSetValue[]> {
  return fetchOptionSetValuesForCast(connectionId, entityLogicalName, attributeLogicalName, "PicklistAttributeMetadata");
}

/** State/Status/MultiSelectPicklist expose the identical `OptionSet.Options` shape as Picklist,
 *  just under their own metadata cast (per Microsoft's Web API metadata reference — only the
 *  Picklist cast above has actually been run against a live org). Kept separate from
 *  `fetchOptionSetValues` rather than widening it: that one backs *writable* cell editors
 *  (DataCopy, FetchXML Builder's condition value picker) which intentionally stay Picklist-only —
 *  this one only backs Metadata Browser's read-only "show all options" panel. */
const OPTIONSET_ATTRIBUTE_CASTS: Record<string, string> = {
  Picklist: "PicklistAttributeMetadata",
  State: "StateAttributeMetadata",
  Status: "StatusAttributeMetadata",
  MultiSelectPicklist: "MultiSelectPicklistAttributeMetadata",
};

/** A polymorphic lookup (customerid -> account/contact, ownerid/createdby/modifiedby ->
 *  systemuser/team) reports as "Customer"/"Owner" in attribute metadata, not "Lookup" —
 *  checking only "Lookup" would miss these very common fields. Mirrors the local `LOOKUP_TYPES`
 *  set in fetchxml-builder/ConditionValueInput.tsx; kept here too since Metadata Browser needs
 *  the same check and this module is where the sibling `isOptionSetAttributeType` already lives. */
const LOOKUP_ATTRIBUTE_TYPES = new Set(["Lookup", "Customer", "Owner"]);

export function isLookupAttributeType(attributeType: string): boolean {
  return LOOKUP_ATTRIBUTE_TYPES.has(attributeType);
}

export function isOptionSetAttributeType(attributeType: string): boolean {
  return attributeType in OPTIONSET_ATTRIBUTE_CASTS;
}

export async function fetchOptionSetValuesForType(
  connectionId: string,
  entityLogicalName: string,
  attributeLogicalName: string,
  attributeType: string,
): Promise<OptionSetValue[]> {
  const cast = OPTIONSET_ATTRIBUTE_CASTS[attributeType];
  if (!cast) throw new Error(`"${attributeType}" 不是可展开选项列表的字段类型。`);
  return fetchOptionSetValuesForCast(connectionId, entityLogicalName, attributeLogicalName, cast);
}
