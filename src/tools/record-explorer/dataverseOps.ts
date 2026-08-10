import { callNative } from "../../native/bridge";
import { fetchAttributes, fetchEntityMeta } from "../../native/metadataService";
import { buildLookupRelationshipMap } from "../../native/navProperty";
import {
  ADMIN_LOOKUP_BLACKLIST,
  isChildRelationshipRelevant,
  type ChildGroup,
  type Level2Record,
  type ParentGroup,
  type ParentGroupLevel2,
  type RecordGraph,
  type RecordSnapshot,
} from "./types";

const CHILD_ROW_LIMIT = 50;

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

const UNKNOWN_PROPERTY_RE = /Could not find a property named '([^']+)'/i;

/** `EntityDefinitions/Attributes` metadata can list an attribute the live OData $metadata model
 *  doesn't actually expose — seen in practice on system entities like `quote`, presumably a
 *  metadata/EDM sync quirk in that org, not something predictable ahead of time. Rather than
 *  fail the whole record/child fetch over one bad field, drop it from $select and retry. */
async function withSelectRetry<T>(fields: string[], run: (fields: string[]) => Promise<T>): Promise<T> {
  let current = fields;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await run(current);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const match = message.match(UNKNOWN_PROPERTY_RE);
      if (!match) throw err;
      const next = current.filter((f) => f.toLowerCase() !== match[1].toLowerCase());
      if (next.length === current.length) throw err; // nothing removed — avoid looping forever
      current = next;
    }
  }
  throw new Error("多次尝试后仍然查询失败，可能有多个字段在这个环境的 OData 模型里不可用。");
}

/** attribute logical name (lowercased) -> set of possible ReferencedEntity values. More than
 *  one entry means a polymorphic lookup (Customer/Owner/regardingobjectid-style) we can't
 *  resolve without the `_value@...lookuplogicalname` annotation — those are skipped for
 *  traversal (still shown as a raw value on the record itself). */
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
  const raw = await withSelectRetry(
    attributes.map((a) => a.logicalName),
    (fields) =>
      fetchDataverse<Record<string, unknown>>(connectionId, `${entityMeta.entitySetName}(${id})?$select=${fields.join(",")}`),
  );

  // Lookups come back as `_logicalname_value` — unwrap to the plain attribute name so
  // fields is keyed consistently with every other (non-lookup) attribute.
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.includes("@")) continue; // stray annotations, if any
    const unwrapped = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -"_value".length) : key;
    fields[unwrapped] = value;
  }

  const primaryName = (fields[entityMeta.primaryNameAttribute] as string | undefined)?.trim() || id;
  return { entityLogicalName, id, primaryName, fields };
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

/** Resolves the populated, non-administrative, non-polymorphic lookup fields on `snapshot`
 *  into their full target records — this is one "level" of upward traversal. */
async function resolveParents(
  connectionId: string,
  snapshot: RecordSnapshot,
  lookupMap: Map<string, Set<string>>,
): Promise<RecordSnapshot[]> {
  const candidates = Object.entries(snapshot.fields).filter(([attr, value]) => {
    if (value === null || value === undefined) return false;
    if (ADMIN_LOOKUP_BLACKLIST.has(attr)) return false;
    const targets = lookupMap.get(attr);
    return !!targets && targets.size === 1;
  });

  const resolved = await Promise.all(
    candidates.map(async ([attr, value]) => {
      const targetEntity = [...lookupMap.get(attr)!][0];
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
        const res = await withSelectRetry(
          childAttributes.map((a) => a.logicalName),
          (fields) =>
            fetchDataverse<{ value: Record<string, unknown>[] }>(
              connectionId,
              `${childMeta.entitySetName}?$select=${fields.join(",")}&$filter=${rel.ReferencingAttribute} eq ${id}&$top=${CHILD_ROW_LIMIT + 1}`,
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
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.includes("@")) continue;
    const unwrapped = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -"_value".length) : key;
    fields[unwrapped] = value;
  }
  const idAttr = Object.keys(fields).find((k) => k.toLowerCase() === `${entityLogicalName}id`);
  const id = (idAttr ? fields[idAttr] : undefined) as string | undefined;
  const primaryName = (fields[primaryNameAttribute] as string | undefined)?.trim() || id || "";
  return { entityLogicalName, id: id ?? "", primaryName, fields };
}

export async function fetchRecordGraph(connectionId: string, entityLogicalName: string, id: string): Promise<RecordGraph> {
  const current = await fetchRecordSnapshot(connectionId, entityLogicalName, id);
  const currentLookupMap = await buildLookupTargetMap(connectionId, entityLogicalName);

  const [level1Records, children] = await Promise.all([
    resolveParents(connectionId, current, currentLookupMap),
    fetchChildren(connectionId, entityLogicalName, id),
  ]);
  const level1 = groupByEntity(level1Records);

  const level2Items: Level2Record[] = (
    await Promise.all(
      level1Records.map(async (record) => {
        const lookupMap = await buildLookupTargetMap(connectionId, record.entityLogicalName);
        const parents = await resolveParents(connectionId, record, lookupMap);
        return parents.map((p) => ({
          record: p,
          via: { entityLogicalName: record.entityLogicalName, primaryName: record.primaryName },
        }));
      }),
    )
  ).flat();

  const level2Map = new Map<string, Level2Record[]>();
  for (const item of level2Items) {
    const list = level2Map.get(item.record.entityLogicalName) ?? [];
    list.push(item);
    level2Map.set(item.record.entityLogicalName, list);
  }
  const level2: ParentGroupLevel2[] = [...level2Map.entries()].map(([entityLogicalName, items]) => ({
    entityLogicalName,
    items,
  }));

  return { current, level1, level2, children };
}
