import { callNative } from "../../native/bridge";

/** Solution export/import can legitimately run longer than the bridge's default 30s — see
 *  DataverseApiClient.cs's matching HttpClient.Timeout bump. */
const LONG_TIMEOUT_MS = 180_000;

const ENTITY_COMPONENT_TYPE = 1;

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

export interface UnmanagedSolution {
  solutionid: string;
  uniquename: string;
  friendlyname: string;
}

/** Existing unmanaged solutions only — v1 deliberately doesn't auto-create a solution or
 *  publisher, the user picks one they already use. */
export async function fetchUnmanagedSolutions(connectionId: string): Promise<UnmanagedSolution[]> {
  const res = await fetchDataverse<{ value: UnmanagedSolution[] }>(
    connectionId,
    "solutions?$filter=isvisible eq true and ismanaged eq false&$select=uniquename,friendlyname,solutionid&$orderby=friendlyname",
  );
  return res.value;
}

export interface SolutionEntity {
  logicalName: string;
  displayName: string;
}

/** Entity-type components (ComponentType=1) already in the solution — `objectid` on those rows
 *  *is* the entity's MetadataId, so EntityDefinitions can be keyed by it directly instead of
 *  needing a LogicalName round-trip. One request per component (Promise.all) rather than a
 *  single OR-chained $filter — solutions worth editing ribbons on are rarely hundreds of tables,
 *  and this keeps the query trivial to reason about. */
export async function fetchSolutionEntities(connectionId: string, solutionId: string): Promise<SolutionEntity[]> {
  const components = await fetchDataverse<{ value: { objectid: string }[] }>(
    connectionId,
    `solutioncomponents?$select=objectid&$filter=_solutionid_value eq ${solutionId} and componenttype eq ${ENTITY_COMPONENT_TYPE}`,
  );

  const entities = await Promise.all(
    components.value.map(async (c): Promise<SolutionEntity | null> => {
      try {
        const meta = await fetchDataverse<{
          LogicalName: string;
          DisplayName?: { UserLocalizedLabel?: { Label: string } | null } | null;
        }>(connectionId, `EntityDefinitions(${c.objectid})?$select=LogicalName,DisplayName`);
        return {
          logicalName: meta.LogicalName,
          displayName: meta.DisplayName?.UserLocalizedLabel?.Label ?? meta.LogicalName,
        };
      } catch {
        return null; // a stale/orphaned solutioncomponent row shouldn't break the whole list
      }
    }),
  );

  return entities
    .filter((e): e is SolutionEntity => e !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function exportSolutionZip(connectionId: string, solutionUniqueName: string): Promise<string> {
  const res = await callNative<{ ExportSolutionFile: string }>(
    "dataverse.request",
    {
      connectionId,
      method: "POST",
      path: "ExportSolution",
      body: { SolutionName: solutionUniqueName, Managed: false },
    },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
  return res.ExportSolutionFile;
}

/** Re-imports the (edited) unmanaged solution zip. Generates the ImportJobId client-side so the
 *  caller can poll for real completion via waitForImportJobCompletion even if this call's own
 *  timeout fires while the import keeps running server-side — see the timeout-swallowing logic
 *  below. OverwriteUnmanagedCustomizations:true matters concretely for this tool: every "Save"
 *  re-imports the same solution, and without it a second/later save could silently no-op instead
 *  of applying. */
export async function importSolutionZip(connectionId: string, zipBase64: string): Promise<string> {
  const importJobId = crypto.randomUUID();
  try {
    await callNative(
      "dataverse.request",
      {
        connectionId,
        method: "POST",
        path: "ImportSolution",
        body: {
          CustomizationFile: zipBase64,
          ImportJobId: importJobId,
          OverwriteUnmanagedCustomizations: true,
          PublishWorkflows: false,
        },
      },
      { timeoutMs: LONG_TIMEOUT_MS },
    );
  } catch (err) {
    const isBridgeTimeout = err instanceof Error && err.message.includes("超时");
    if (!isBridgeTimeout) throw err;
    // The import keeps running server-side regardless — waitForImportJobCompletion below is
    // the real source of truth, so a client-side timeout alone isn't treated as failure here.
  }
  return importJobId;
}

export interface ImportJobStatus {
  progress: number;
  completedon: string | null;
  data: string | null;
}

export async function pollImportJob(connectionId: string, importJobId: string): Promise<ImportJobStatus> {
  return fetchDataverse<ImportJobStatus>(
    connectionId,
    `importjobs(${importJobId})?$select=progress,completedon,data`,
  );
}

export async function waitForImportJobCompletion(
  connectionId: string,
  importJobId: string,
  { pollIntervalMs = 3000, maxWaitMs = 300_000 }: { pollIntervalMs?: number; maxWaitMs?: number } = {},
): Promise<ImportJobStatus> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await pollImportJob(connectionId, importJobId);
    if (status.completedon) return status;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("等待导入完成超时（5 分钟），请去 Solutions 的导入历史里手动确认结果。");
}

/** Retrieves the *effective* (merged system + all customizations) ribbon for a table — distinct
 *  from exportSolutionZip+readRibbonDiffXml, which only ever sees this table's own diff layer.
 *  `RibbonLocationFilters'All'` (value 7) per Microsoft's Web API enum reference — pulls Form,
 *  HomepageGrid, and SubGrid ribbons all in one call rather than three. Returns the raw base64
 *  `CompressedEntityXml`; callers decompress via effectiveRibbon.ts's decompressRibbonXml. */
export async function fetchEffectiveRibbonCompressed(connectionId: string, entityLogicalName: string): Promise<string> {
  const res = await callNative<{ CompressedEntityXml: string }>(
    "dataverse.request",
    {
      connectionId,
      method: "GET",
      path: `RetrieveEntityRibbon(EntityName='${entityLogicalName}',RibbonLocationFilter=Microsoft.Dynamics.CRM.RibbonLocationFilters'All')`,
    },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
  return res.CompressedEntityXml;
}

export async function publishEntity(connectionId: string, logicalName: string): Promise<void> {
  const parameterXml = `<importexportxml><entities><entity>${logicalName}</entity></entities></importexportxml>`;
  await callNative(
    "dataverse.request",
    { connectionId, method: "POST", path: "PublishXml", body: { ParameterXml: parameterXml } },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
}
