import { callNative } from "../../native/bridge";
import { SCALAR_ATTRIBUTE_TYPES, type AttributeInfo, type EntityMeta } from "./types";

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

/** Real EntitySetName/PrimaryIdAttribute from metadata — unlike the naive-pluralization guess
 *  used by SQL4CDS/FetchXML Builder, this is exact and works for irregular plurals too. */
export async function fetchEntityMeta(connectionId: string, logicalName: string): Promise<EntityMeta> {
  const res = await fetchDataverse<{ EntitySetName: string; PrimaryIdAttribute: string }>(
    connectionId,
    `EntityDefinitions(LogicalName='${logicalName}')?$select=EntitySetName,PrimaryIdAttribute`,
  );
  return { entitySetName: res.EntitySetName, primaryIdAttribute: res.PrimaryIdAttribute };
}

export async function fetchScalarAttributes(connectionId: string, logicalName: string): Promise<AttributeInfo[]> {
  const res = await fetchDataverse<{ value: AttributeInfo[] }>(
    connectionId,
    `EntityDefinitions(LogicalName='${logicalName}')/Attributes?$select=LogicalName,AttributeType,IsPrimaryId,DisplayName`,
  );
  return res.value
    .filter((a) => a.IsPrimaryId || SCALAR_ATTRIBUTE_TYPES.has(a.AttributeType))
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
  filter: string,
  top: number,
): Promise<Record<string, unknown>[]> {
  // Primary id is always fetched (even if not selected for import) — it's the only stable
  // React/table key we have for each row.
  const selectCols = Array.from(new Set([primaryIdAttribute, ...columns]));
  const params = [`$select=${selectCols.join(",")}`, `$top=${top}`];
  if (filter.trim()) params.push(`$filter=${filter.trim()}`);

  const res = await fetchDataverse<{ value: Record<string, unknown>[] }>(
    connectionId,
    `${entitySetName}?${params.join("&")}`,
  );
  return res.value;
}

export async function importRow(
  targetConnectionId: string,
  entitySetName: string,
  row: Record<string, unknown>,
  selectedColumns: string[],
): Promise<void> {
  const body: Record<string, unknown> = {};
  for (const col of selectedColumns) {
    body[col] = row[col] ?? null;
  }
  // Including the primary id attribute in the create payload is what makes Dataverse honor
  // it as the new record's id instead of generating one — this is how "preserve the source
  // record's GUID" is implemented, not a separate API.
  await callNative("dataverse.request", {
    connectionId: targetConnectionId,
    method: "POST",
    path: entitySetName,
    body,
  });
}
