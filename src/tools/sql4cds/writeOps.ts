import { callNative } from "../../native/bridge";
import { fetchAttributes, fetchEntityMeta } from "../../native/metadataService";
import { buildLookupRelationshipMap } from "../../native/navProperty";

/** Builds one write payload from a plain column→value map, resolving Lookup-typed columns to
 *  `{navProp}@odata.bind` — same approach as data-migration's `importRow`
 *  (src/tools/data-migration/dataverseOps.ts), generalized to take an explicit value map instead
 *  of a queried source row, since SQL4CDS's columns come from the parsed INSERT/UPDATE statement.
 *  A Lookup column with zero or multiple relationship candidates (unresolvable/polymorphic, e.g.
 *  `customerid`) is rejected rather than silently written as a raw field, since Dataverse always
 *  400s on that — better to fail with a clear reason up front. */
export async function buildRowBody(
  connectionId: string,
  entityLogicalName: string,
  columnValues: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [attrTypes, lookupMap] = await Promise.all([
    fetchAttributes(connectionId, entityLogicalName),
    buildLookupRelationshipMap(connectionId, entityLogicalName),
  ]);
  const typeByName = new Map(attrTypes.map((a) => [a.logicalName.toLowerCase(), a.attributeType]));

  const body: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(columnValues)) {
    const isLookup = typeByName.get(col.toLowerCase()) === "Lookup";
    if (!isLookup) {
      body[col] = value;
      continue;
    }
    if (value === null || value === undefined) continue; // nothing to bind — omit rather than error
    const candidates = lookupMap.get(col.toLowerCase());
    if (!candidates || candidates.length !== 1) {
      throw new Error(`字段 "${col}" 是一个 Lookup，但无法唯一确定它指向哪个实体（可能是多态查找字段），暂不支持写入。`);
    }
    const targetMeta = await fetchEntityMeta(connectionId, candidates[0].ReferencedEntity);
    body[`${candidates[0].ReferencingEntityNavigationPropertyName}@odata.bind`] = `/${targetMeta.entitySetName}(${value})`;
  }
  return body;
}

/** Prefer: return=representation is already sent unconditionally by the C# layer
 *  (DataverseApiClient.cs), so the POST response already carries the created record — including
 *  its new id under `{entityLogicalName}id`, per Dataverse's standard primary-id-attribute naming
 *  convention (same guess used for COUNT(*) in translate.ts). Purely cosmetic if wrong (the
 *  insert still succeeds; only the displayed new-id is blank). */
export async function insertRow(
  connectionId: string,
  entityLogicalName: string,
  entitySetName: string,
  columnValues: Record<string, unknown>,
): Promise<{ newId: string | null }> {
  const body = await buildRowBody(connectionId, entityLogicalName, columnValues);
  const created = await callNative<Record<string, unknown>>("dataverse.request", {
    connectionId,
    method: "POST",
    path: entitySetName,
    body,
  });
  const idField = `${entityLogicalName}id`;
  const newId = typeof created[idField] === "string" ? (created[idField] as string) : null;
  return { newId };
}

export async function updateRow(
  connectionId: string,
  entityLogicalName: string,
  entitySetName: string,
  id: string,
  columnValues: Record<string, unknown>,
): Promise<void> {
  const body = await buildRowBody(connectionId, entityLogicalName, columnValues);
  await callNative("dataverse.request", {
    connectionId,
    method: "PATCH",
    path: `${entitySetName}(${id})`,
    body,
  });
}

export async function deleteRow(connectionId: string, entitySetName: string, id: string): Promise<void> {
  await callNative("dataverse.request", {
    connectionId,
    method: "DELETE",
    path: `${entitySetName}(${id})`,
  });
}

export interface MatchingIds {
  /** Capped at 500 — the actual set of ids UPDATE/DELETE will process this run. */
  ids: string[];
  /** The real total match count (via a separate $count=true&$top=1 call — never
   *  `/$count?$filter=`, per this project's documented OData conventions), which can be larger
   *  than `ids.length` when the WHERE clause matches more than the 500-row execution cap. */
  totalCount: number;
}

/** Resolves which records an UPDATE/DELETE's WHERE clause matches — Dataverse's Web API has no
 *  bulk "UPDATE/DELETE ... WHERE" endpoint, so every mutate statement must first find the target
 *  ids and then write them one at a time (see updateRow/deleteRow). Capped at 500 per run to
 *  bound a single execution — matches this project's existing $top convention (data-migration's
 *  own row cap options top out at 500 too). */
export async function queryMatchingIds(
  connectionId: string,
  entitySetName: string,
  primaryIdAttribute: string,
  filter: string,
): Promise<MatchingIds> {
  const [listRes, countRes] = await Promise.all([
    callNative<{ value: Record<string, unknown>[] }>("dataverse.request", {
      connectionId,
      method: "GET",
      path: `${entitySetName}?$select=${primaryIdAttribute}&$filter=${filter}&$top=500`,
    }),
    callNative<{ "@odata.count"?: number }>("dataverse.request", {
      connectionId,
      method: "GET",
      path: `${entitySetName}?$filter=${filter}&$count=true&$top=1`,
    }),
  ]);
  const ids = listRes.value.map((r) => String(r[primaryIdAttribute]));
  return { ids, totalCount: countRes["@odata.count"] ?? ids.length };
}
