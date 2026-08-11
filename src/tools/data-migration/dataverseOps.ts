import { callNative } from "../../native/bridge";
import { fetchEntityMeta as fetchSharedEntityMeta } from "../../native/metadataService";
import { buildLookupRelationshipMap } from "../../native/navProperty";
import { SCALAR_ATTRIBUTE_TYPES, type AttributeInfo, type EntityMeta } from "./types";

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

/** Real EntitySetName/PrimaryIdAttribute from the shared, cross-tool cached metadata service —
 *  unlike the naive-pluralization guess used elsewhere, this is exact and works for irregular
 *  plurals too. */
export async function fetchEntityMeta(connectionId: string, logicalName: string): Promise<EntityMeta> {
  const meta = await fetchSharedEntityMeta(connectionId, logicalName);
  return { entitySetName: meta.entitySetName, primaryIdAttribute: meta.primaryIdAttribute };
}

/** Suffixes Dataverse uses for a Lookup field's auto-maintained, read-only display-name
 *  companion attributes (e.g. `contoso_language` (Lookup) always comes with `contoso_languagename`,
 *  and often `contoso_languageyominame` for the Pinyin variant on CJK-enabled orgs). These are
 *  real rows in `EntityDefinitions/Attributes`, but they're not independently writable — the
 *  platform derives them from the Lookup's target record — so migrating them is meaningless
 *  and importing the Lookup's own GUID (see below) is all that's needed. */
const LOOKUP_LABEL_SUFFIXES = ["name", "yominame"];

function isLookupLabelField(logicalName: string, lookupLogicalNames: Set<string>): boolean {
  const lower = logicalName.toLowerCase();
  return LOOKUP_LABEL_SUFFIXES.some(
    (suffix) => lower.endsWith(suffix) && lookupLogicalNames.has(lower.slice(0, -suffix.length)),
  );
}

/** Scalar fields plus plain (non-polymorphic-by-type) Lookup fields — Owner/Customer/PartyList
 *  stay excluded (see SCALAR_ATTRIBUTE_TYPES' doc comment: their target type varies per record,
 *  which the write side can't resolve without the annotation this project's dataverse.request
 *  doesn't request). A single-target Lookup is included on the assumption that if you're
 *  choosing to migrate it, the two environments share the same reference data/GUIDs for that
 *  target entity — if they don't, the write fails per-row rather than silently corrupting data.
 *  Each Lookup's own `<name>`/`<name>yominame` companion fields are filtered back out — see
 *  isLookupLabelField's doc comment. */
export async function fetchMigratableAttributes(connectionId: string, logicalName: string): Promise<AttributeInfo[]> {
  const res = await fetchDataverse<{ value: AttributeInfo[] }>(
    connectionId,
    `EntityDefinitions(LogicalName='${logicalName}')/Attributes?$select=LogicalName,AttributeType,IsPrimaryId,DisplayName`,
  );
  const lookupLogicalNames = new Set(
    res.value.filter((a) => a.AttributeType === "Lookup").map((a) => a.LogicalName.toLowerCase()),
  );
  return res.value
    .filter((a) => a.IsPrimaryId || SCALAR_ATTRIBUTE_TYPES.has(a.AttributeType) || a.AttributeType === "Lookup")
    .filter((a) => !isLookupLabelField(a.LogicalName, lookupLogicalNames))
    .sort((a, b) => {
      if (a.IsPrimaryId !== b.IsPrimaryId) return a.IsPrimaryId ? -1 : 1;
      return a.LogicalName.localeCompare(b.LogicalName);
    });
}

export async function queryRows(
  connectionId: string,
  entitySetName: string,
  primaryIdAttribute: string,
  columns: string[],
  lookupColumns: Set<string>,
  filter: string,
  top: number,
): Promise<Record<string, unknown>[]> {
  // Primary id is always fetched (even if not selected for import) — it's the only stable
  // React/table key we have for each row.
  // Lookup columns can only be $select-ed via the `_logicalname_value` form — selecting the
  // bare logical name 400s with "Could not find a property named '<name>'".
  const selectCols = Array.from(new Set([primaryIdAttribute, ...columns])).map((c) =>
    lookupColumns.has(c) ? `_${c}_value` : c,
  );
  const params = [`$select=${selectCols.join(",")}`, `$top=${top}`];
  if (filter.trim()) params.push(`$filter=${filter.trim()}`);

  const res = await fetchDataverse<{ value: Record<string, unknown>[] }>(
    connectionId,
    `${entitySetName}?${params.join("&")}`,
  );
  // Lookup columns come back as `_logicalname_value` — unwrap to the plain attribute name so
  // `row[col]` works uniformly for both scalar and lookup columns everywhere downstream
  // (the table renderer, importRow's payload building, row identity via primaryIdAttribute).
  return res.value.map((row) => {
    const unwrapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.includes("@")) continue;
      const plain = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -"_value".length) : key;
      unwrapped[plain] = value;
    }
    return unwrapped;
  });
}

/** Writes one row to the target as an upsert: PATCH `{entitySet}({id})` with the source row's
 *  own id — Dataverse creates the record with that id if it doesn't exist yet, or updates just
 *  the fields in the payload if it does. The id is always the URL key now, never a payload
 *  field (previously it only got preserved if the user separately checked an "include primary
 *  id" column — that's gone, matching-by-id is no longer optional). Lookup-type columns are
 *  translated to `{navProp}@odata.bind` against the *target* connection's own schema (falls
 *  back to a plain field write if the column isn't a recognized single-target lookup there —
 *  covers both "not actually a lookup" and "polymorphic, can't disambiguate"). */
export async function importRow(
  targetConnectionId: string,
  entityLogicalName: string,
  entitySetName: string,
  primaryIdAttribute: string,
  row: Record<string, unknown>,
  selectedColumns: string[],
): Promise<void> {
  const lookupMap = await buildLookupRelationshipMap(targetConnectionId, entityLogicalName);

  const body: Record<string, unknown> = {};
  for (const col of selectedColumns) {
    if (col === primaryIdAttribute) continue;
    const value = row[col] ?? null;
    const candidates = lookupMap.get(col.toLowerCase());
    if (candidates && candidates.length === 1) {
      if (value === null) continue;
      const targetMeta = await fetchEntityMeta(targetConnectionId, candidates[0].ReferencedEntity);
      body[`${candidates[0].ReferencingEntityNavigationPropertyName}@odata.bind`] = `/${targetMeta.entitySetName}(${value})`;
    } else {
      body[col] = value;
    }
  }

  const id = row[primaryIdAttribute];
  await callNative("dataverse.request", {
    connectionId: targetConnectionId,
    method: "PATCH",
    path: `${entitySetName}(${id})`,
    body,
  });
}
