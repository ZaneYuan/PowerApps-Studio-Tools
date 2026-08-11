import { callNative } from "../../native/bridge";
import { fetchAttributes, fetchEntityMeta, type AttributeMeta } from "../../native/metadataService";
import { buildLookupRelationshipMap } from "../../native/navProperty";
import { withSelectRetry } from "../../native/withSelectRetry";
import {
  ADMIN_LOOKUP_BLACKLIST,
  isChildRelationshipRelevant,
  type ChildGroup,
  type ParentGroup,
  type RecordGraph,
  type RecordSnapshot,
} from "./types";

const CHILD_ROW_LIMIT = 50;
/** Cap on distinct *tables* shown under "关联记录（向上）" — a wide entity like `quote` can
 *  easily have a dozen resolvable lookups (currency, price list, SLA, several custom contoso_*
 *  references...), and showing all of them buries the ones that actually matter. See
 *  rankByActivity's doc comment for how "matter" is judged. */
const LEVEL1_MAX_GROUPS = 5;

async function fetchDataverse<T>(connectionId: string, path: string, includeFormattedValues = false): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path, includeFormattedValues });
}

/** Lookup-type attributes must be $select-ed as `_logicalname_value` — Dataverse 400s on the
 *  bare logical name ("Could not find a property named 'x'"), the same issue hit and fixed in
 *  Data Migration and Plugin Registration. withSelectRetry silently dropping every Lookup field
 *  one-by-one on that error was masking this rather than actually working around a real
 *  environment quirk — this is what was making level-1 parents (and every child table) come up
 *  nearly empty regardless of environment. */
function selectFieldFor(a: AttributeMeta): string {
  return a.attributeType === "Lookup" ? `_${a.logicalName}_value` : a.logicalName;
}

/** Splits a raw Dataverse JSON record into plain field values plus the two annotation kinds
 *  fetchDataverse's `includeFormattedValues` requests — human-readable labels and (for
 *  polymorphic lookups) which entity a given value actually points to. */
function unwrapRecord(raw: Record<string, unknown>): {
  fields: Record<string, unknown>;
  formattedFields: Record<string, string>;
  lookupTargetEntity: Record<string, string>;
} {
  const fields: Record<string, unknown> = {};
  const formattedFields: Record<string, string> = {};
  const lookupTargetEntity: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.includes("@")) {
      const [rawBaseKey, annotation] = key.split("@");
      const baseKey =
        rawBaseKey.startsWith("_") && rawBaseKey.endsWith("_value") ? rawBaseKey.slice(1, -"_value".length) : rawBaseKey;
      if (annotation === "OData.Community.Display.V1.FormattedValue" && typeof value === "string") {
        formattedFields[baseKey] = value;
      } else if (annotation === "Microsoft.Dynamics.CRM.lookuplogicalname" && typeof value === "string") {
        lookupTargetEntity[baseKey] = value;
      }
      continue;
    }
    const unwrapped = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -"_value".length) : key;
    fields[unwrapped] = value;
  }
  return { fields, formattedFields, lookupTargetEntity };
}

/** attribute logical name (lowercased) -> set of possible ReferencedEntity values. More than
 *  one entry means a polymorphic lookup (Customer/Owner/regardingobjectid-style) — resolvable
 *  per-record only if the lookuplogicalname annotation says which entity this particular value
 *  points to (see resolveParents). */
async function buildLookupTargetMap(connectionId: string, entityLogicalName: string): Promise<Map<string, Set<string>>> {
  const relMap = await buildLookupRelationshipMap(connectionId, entityLogicalName);
  const map = new Map<string, Set<string>>();
  for (const [attr, rels] of relMap) {
    map.set(attr, new Set(rels.map((r) => r.ReferencedEntity)));
  }
  return map;
}

export async function fetchRecordSnapshot(
  connectionId: string,
  entityLogicalName: string,
  id: string,
): Promise<RecordSnapshot> {
  const [entityMeta, attributes] = await Promise.all([
    fetchEntityMeta(connectionId, entityLogicalName),
    fetchAttributes(connectionId, entityLogicalName),
  ]);
  const raw = await withSelectRetry(attributes.map(selectFieldFor), (fields) =>
    fetchDataverse<Record<string, unknown>>(
      connectionId,
      `${entityMeta.entitySetName}(${id})?$select=${fields.join(",")}`,
      true,
    ),
  );

  const { fields, formattedFields, lookupTargetEntity } = unwrapRecord(raw);
  const primaryName = (fields[entityMeta.primaryNameAttribute] as string | undefined)?.trim() || id;
  return { entityLogicalName, id, primaryName, fields, formattedFields, lookupTargetEntity };
}

function groupByEntity(items: RecordSnapshot[]): ParentGroup[] {
  const map = new Map<string, RecordSnapshot[]>();
  for (const record of items) {
    const list = map.get(record.entityLogicalName) ?? [];
    list.push(record);
    map.set(record.entityLogicalName, list);
  }
  return [...map.entries()].map(([entityLogicalName, records]) => ({ entityLogicalName, records }));
}

/** Resolves the populated, non-administrative lookup fields on `snapshot` into their full
 *  target records. Single-target lookups always resolve; polymorphic ones (targets.size > 1)
 *  only resolve when the lookuplogicalname annotation told us which entity this specific
 *  record's value points to — otherwise there's no reliable way to know which table to query. */
async function resolveParents(
  connectionId: string,
  snapshot: RecordSnapshot,
  lookupMap: Map<string, Set<string>>,
): Promise<RecordSnapshot[]> {
  const candidates = Object.entries(snapshot.fields).filter(([attr, value]) => {
    if (value === null || value === undefined) return false;
    if (ADMIN_LOOKUP_BLACKLIST.has(attr)) return false;
    const targets = lookupMap.get(attr);
    if (!targets) return false;
    return targets.size === 1 || !!snapshot.lookupTargetEntity[attr];
  });

  const resolved = await Promise.all(
    candidates.map(async ([attr, value]) => {
      const targetEntity = snapshot.lookupTargetEntity[attr] ?? [...lookupMap.get(attr)!][0];
      try {
        return await fetchRecordSnapshot(connectionId, targetEntity, value as string);
      } catch {
        // Target deleted, inaccessible, or the relationship metadata was stale — drop this one
        // branch rather than failing the whole graph.
        return null;
      }
    }),
  );

  return resolved.filter((r): r is RecordSnapshot => r !== null);
}

/** Best available proxy for "how actively is this related record used" — there's no real usage/
 *  access-frequency signal exposed via the Web API, so recency of the target record's own last
 *  modification stands in for it. Ties (e.g. two records never modified) sort last, not first. */
function activityTimestamp(snapshot: RecordSnapshot): number {
  const raw = snapshot.fields.modifiedon ?? snapshot.fields.createdon;
  const parsed = raw ? Date.parse(String(raw)) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Ranks parent-record groups by their most recently modified record and keeps only the top
 *  `LEVEL1_MAX_GROUPS` — see activityTimestamp's doc comment for the ranking signal. */
function rankByActivity(groups: ParentGroup[]): ParentGroup[] {
  return groups
    .map((g): [ParentGroup, number] => [g, Math.max(0, ...g.records.map(activityTimestamp))])
    .sort((a, b) => b[1] - a[1])
    .slice(0, LEVEL1_MAX_GROUPS)
    .map(([g]) => g);
}

async function fetchChildren(connectionId: string, entityLogicalName: string, id: string): Promise<ChildGroup[]> {
  const raw = await fetchDataverse<{
    value: { SchemaName: string; ReferencingEntity: string; ReferencingAttribute: string; IsCustomRelationship: boolean }[];
  }>(
    connectionId,
    `EntityDefinitions(LogicalName='${entityLogicalName}')/OneToManyRelationships` +
      `?$select=SchemaName,ReferencingEntity,ReferencingAttribute,IsCustomRelationship`,
  );
  const relevant = raw.value.filter((r) => isChildRelationshipRelevant(r.ReferencingEntity, r.IsCustomRelationship));

  const groups = await Promise.all(
    relevant.map(async (rel): Promise<ChildGroup | null> => {
      try {
        const [childMeta, childAttributes] = await Promise.all([
          fetchEntityMeta(connectionId, rel.ReferencingEntity),
          fetchAttributes(connectionId, rel.ReferencingEntity),
        ]);
        const res = await withSelectRetry(childAttributes.map(selectFieldFor), (fields) =>
          fetchDataverse<{ value: Record<string, unknown>[] }>(
            connectionId,
            `${childMeta.entitySetName}?$select=${fields.join(",")}&$filter=${rel.ReferencingAttribute} eq ${id}&$top=${CHILD_ROW_LIMIT + 1}`,
            true,
          ),
        );
        const truncated = res.value.length > CHILD_ROW_LIMIT;
        const rows = res.value.slice(0, CHILD_ROW_LIMIT).map((raw) => toSnapshot(raw, rel.ReferencingEntity, childMeta.primaryNameAttribute));
        if (rows.length === 0) return null;
        return { entityLogicalName: rel.ReferencingEntity, relationshipSchemaName: rel.SchemaName, rows, truncated };
      } catch {
        // A handful of system relationships have quirky $filter/$select support even after the
        // blacklist — skip that one tab rather than failing the whole "down" traversal.
        return null;
      }
    }),
  );

  return groups.filter((g): g is ChildGroup => g !== null);
}

function toSnapshot(raw: Record<string, unknown>, entityLogicalName: string, primaryNameAttribute: string): RecordSnapshot {
  const { fields, formattedFields, lookupTargetEntity } = unwrapRecord(raw);
  const idAttr = Object.keys(fields).find((k) => k.toLowerCase() === `${entityLogicalName}id`);
  const id = (idAttr ? fields[idAttr] : undefined) as string | undefined;
  const primaryName = (fields[primaryNameAttribute] as string | undefined)?.trim() || id || "";
  return { entityLogicalName, id: id ?? "", primaryName, fields, formattedFields, lookupTargetEntity };
}

export async function fetchRecordGraph(connectionId: string, entityLogicalName: string, id: string): Promise<RecordGraph> {
  const current = await fetchRecordSnapshot(connectionId, entityLogicalName, id);
  const currentLookupMap = await buildLookupTargetMap(connectionId, entityLogicalName);

  const [level1Records, children] = await Promise.all([
    resolveParents(connectionId, current, currentLookupMap),
    fetchChildren(connectionId, entityLogicalName, id),
  ]);
  const level1 = rankByActivity(groupByEntity(level1Records));

  return { current, level1, children };
}
