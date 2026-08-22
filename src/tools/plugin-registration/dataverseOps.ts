import { callNative } from "../../native/bridge";
import { getBindNavigationProperty } from "../../native/navProperty";
import { withSelectRetry } from "../../native/withSelectRetry";
import type { PluginAssembly, PluginStep, PluginStepImage, PluginType } from "./types";

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

async function postDataverse<T>(connectionId: string, path: string, body: Record<string, unknown>): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "POST", path, body });
}

async function patchDataverse(connectionId: string, path: string, body: Record<string, unknown>): Promise<void> {
  await callNative("dataverse.request", { connectionId, method: "PATCH", path, body });
}

async function deleteDataverse(connectionId: string, path: string): Promise<void> {
  await callNative("dataverse.request", { connectionId, method: "DELETE", path });
}

export async function fetchAssemblies(connectionId: string): Promise<PluginAssembly[]> {
  const res = await fetchDataverse<{ value: PluginAssembly[] }>(
    connectionId,
    "pluginassemblies?$select=pluginassemblyid,name,version,ismanaged&$orderby=name",
  );
  return res.value;
}

export async function fetchPluginTypes(connectionId: string, assemblyId: string): Promise<PluginType[]> {
  const res = await fetchDataverse<{ value: PluginType[] }>(
    connectionId,
    `plugintypes?$select=plugintypeid,typename,friendlyname,name&$filter=_pluginassemblyid_value eq ${assemblyId}&$orderby=typename`,
  );
  return res.value;
}

export async function fetchSteps(connectionId: string, pluginTypeId: string): Promise<PluginStep[]> {
  const res = await fetchDataverse<{ value: PluginStep[] }>(
    connectionId,
    `sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode,rank,statecode,statuscode` +
      `&$filter=_eventhandler_value eq ${pluginTypeId}&$orderby=name` +
      `&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)`,
  );
  return res.value;
}

/** Web API's default page size (5000) — the same cap this codebase's own record-merge
 *  countMatchingCapped doc comment documents Dataverse silently applying to $count once the real
 *  total reaches it. Confirmed live: this org alone already has ≥5000 sdkmessageprocessingsteps
 *  rows (mostly Microsoft's own built-in ones), so a single unpaginated GET here was silently
 *  truncating fetchAllSteps to just the first page — a freshly registered step could be
 *  completely invisible to the tree's own search dropdown depending on where its name happened
 *  to sort. Follows @odata.nextLink until the real result set is exhausted. */
async function fetchAllPages<T>(connectionId: string, path: string): Promise<T[]> {
  const out: T[] = [];
  const apiVersionSegment = "/api/data/v9.2/";
  let nextPath: string | null = path;
  while (nextPath) {
    const res: { value: T[]; "@odata.nextLink"?: string } = await fetchDataverse(connectionId, nextPath);
    out.push(...res.value);
    const next = res["@odata.nextLink"];
    const idx = next ? next.indexOf(apiVersionSegment) : -1;
    nextPath = idx >= 0 ? next!.slice(idx + apiVersionSegment.length) : null;
  }
  return out;
}

export interface PluginTypeFlat extends PluginType {
  _pluginassemblyid_value: string;
}

/** Every plugin type org-wide in a single query, carrying its parent assembly id. Used only by
 *  the tree's search dropdown, which needs to match names across the whole org — fetching this
 *  once beats cascading a per-assembly fetchPluginTypes call for every assembly on screen. */
export async function fetchAllPluginTypes(connectionId: string): Promise<PluginTypeFlat[]> {
  return fetchAllPages<PluginTypeFlat>(
    connectionId,
    "plugintypes?$select=plugintypeid,typename,friendlyname,name,_pluginassemblyid_value&$orderby=typename",
  );
}

export interface PluginStepFlat extends PluginStep {
  _eventhandler_value: string;
}

/** Every step org-wide in a single query, carrying its parent plugin type id — same rationale
 *  as fetchAllPluginTypes, for the search dropdown. */
export async function fetchAllSteps(connectionId: string): Promise<PluginStepFlat[]> {
  return fetchAllPages<PluginStepFlat>(
    connectionId,
    "sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode,rank,statecode,statuscode,_eventhandler_value" +
      "&$orderby=name&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)",
  );
}

export async function fetchImages(connectionId: string, stepId: string): Promise<PluginStepImage[]> {
  const res = await fetchDataverse<{ value: PluginStepImage[] }>(
    connectionId,
    `sdkmessageprocessingstepimages?$select=sdkmessageprocessingstepimageid,name,entityalias,imagetype` +
      `&$filter=_sdkmessageprocessingstepid_value eq ${stepId}`,
  );
  return res.value;
}

export async function fetchRecordDetail(connectionId: string, collection: string, id: string): Promise<unknown> {
  return fetchDataverse<unknown>(connectionId, `${collection}(${id})`);
}

/** Targeted (not the generic unfiltered fetchRecordDetail) — this is the single source for both
 *  the Step detail table and the edit dialog's pre-fill, so message/entity are resolved to
 *  readable names via $expand instead of showing raw GUIDs, while still carrying the raw
 *  `_eventhandler_value`/`_..._value` fields the existing cascade-delete/enable-toggle logic
 *  reads via lookupValue(). */
export interface StepDetail {
  sdkmessageprocessingstepid: string;
  name: string;
  stage: number;
  mode: number;
  rank: number;
  statecode: number;
  statuscode: number;
  filteringattributes: string | null;
  configuration: string | null;
  supporteddeployment: number;
  sdkmessageid?: { name: string } | null;
  sdkmessagefilterid?: { primaryobjecttypecode: string } | null;
  _eventhandler_value?: string | null;
  _sdkmessageprocessingstepsecureconfigid_value?: string | null;
}

const STEP_DETAIL_FIELDS = [
  "name",
  "stage",
  "mode",
  "rank",
  "statecode",
  "statuscode",
  "filteringattributes",
  "configuration",
  "supporteddeployment",
  // Lookup fields — $select requires the `_..._value` form, not the bare attribute name (a
  // bare `eventhandler` 400s with "Could not find a property named 'eventhandler'").
  "_eventhandler_value",
  "_sdkmessageprocessingstepsecureconfigid_value",
];

export async function fetchStepDetail(connectionId: string, stepId: string): Promise<StepDetail> {
  return withSelectRetry(STEP_DETAIL_FIELDS, (fields) =>
    fetchDataverse<StepDetail>(
      connectionId,
      `sdkmessageprocessingsteps(${stepId})?$select=${fields.join(",")}` +
        `&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)`,
    ),
  );
}

export interface ImageDetail {
  sdkmessageprocessingstepimageid: string;
  name: string;
  entityalias: string;
  imagetype: number;
  messagepropertyname: string;
  // Real Web API logical name is "attributes" — confirmed against a live org (an earlier
  // "attributes1" guess 400'd with "Invalid property 'attributes1' was found in entity
  // 'Microsoft.Dynamics.CRM.sdkmessageprocessingstepimage'").
  attributes: string | null;
  _sdkmessageprocessingstepid_value?: string | null;
}

const IMAGE_DETAIL_FIELDS = [
  "name",
  "entityalias",
  "imagetype",
  "messagepropertyname",
  "attributes",
  // Lookup to the parent step — same `_..._value` requirement as StepDetail's eventhandler.
  "_sdkmessageprocessingstepid_value",
];

export async function fetchImageDetail(connectionId: string, imageId: string): Promise<ImageDetail> {
  return withSelectRetry(IMAGE_DETAIL_FIELDS, (fields) =>
    fetchDataverse<ImageDetail>(connectionId, `sdkmessageprocessingstepimages(${imageId})?$select=${fields.join(",")}`),
  );
}

export interface SdkMessage {
  sdkmessageid: string;
  name: string;
}

export interface SdkMessageFilter {
  sdkmessagefilterid: string;
  primaryobjecttypecode: string;
}

export interface EntityAttribute {
  LogicalName: string;
}

/** All SDK messages, sorted by name. There's only ever a few hundred of these org-wide and no
 *  server-side text search is worth adding — the step-register dialog filters client-side. */
export async function fetchMessages(connectionId: string): Promise<SdkMessage[]> {
  const res = await fetchDataverse<{ value: SdkMessage[] }>(
    connectionId,
    "sdkmessages?$select=sdkmessageid,name&$orderby=name",
  );
  return res.value;
}

/** Primary entities a message can target. Empty result means an org-level message (no
 *  sdkmessagefilterid on the step). */
export async function fetchMessageFilters(connectionId: string, messageId: string): Promise<SdkMessageFilter[]> {
  const res = await fetchDataverse<{ value: SdkMessageFilter[] }>(
    connectionId,
    `sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode&$filter=_sdkmessageid_value eq ${messageId}&$orderby=primaryobjecttypecode`,
  );
  return res.value;
}

export async function fetchEntityAttributes(connectionId: string, entityLogicalName: string): Promise<string[]> {
  const res = await fetchDataverse<{ value: EntityAttribute[] }>(
    connectionId,
    `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes?$select=LogicalName`,
  );
  return res.value.map((a) => a.LogicalName).sort();
}

export interface RegisterStepInput {
  pluginTypeId: string;
  pluginTypeName: string;
  messageId: string;
  messageName: string;
  filterId: string | null;
  primaryEntity: string | null;
  stage: number;
  mode: number;
  rank: number;
  filteringAttributes: string;
  unsecureConfig: string;
  /** Written to sdkmessageprocessingstepsecureconfigs' own "secureconfig" attribute — confirmed
   *  against a live org (an earlier "value" guess 400'd with "Invalid property 'value' was found
   *  in entity 'Microsoft.Dynamics.CRM.sdkmessageprocessingstepsecureconfig'"). */
  secureConfig: string;
  deployment: number;
}

export async function registerStep(connectionId: string, input: RegisterStepInput): Promise<PluginStep> {
  const [sdkMessageNav, sdkMessageFilterNav, eventHandlerNav, secureConfigNav] = await Promise.all([
    getBindNavigationProperty(connectionId, "sdkmessageprocessingstep", "sdkmessageid"),
    getBindNavigationProperty(connectionId, "sdkmessageprocessingstep", "sdkmessagefilterid"),
    getBindNavigationProperty(connectionId, "sdkmessageprocessingstep", "eventhandler", "plugintype"),
    getBindNavigationProperty(connectionId, "sdkmessageprocessingstep", "sdkmessageprocessingstepsecureconfigid"),
  ]);

  let secureConfigId: string | null = null;
  if (input.secureConfig.trim()) {
    const secureConfigRecord = await postDataverse<{ sdkmessageprocessingstepsecureconfigid: string }>(
      connectionId,
      "sdkmessageprocessingstepsecureconfigs",
      { secureconfig: input.secureConfig },
    );
    secureConfigId = secureConfigRecord.sdkmessageprocessingstepsecureconfigid;
  }

  const payload: Record<string, unknown> = {
    name: `${input.messageName}: ${input.primaryEntity ?? "any entity"} ${input.pluginTypeName}`,
    [`${sdkMessageNav}@odata.bind`]: `/sdkmessages(${input.messageId})`,
    [`${eventHandlerNav}@odata.bind`]: `/plugintypes(${input.pluginTypeId})`,
    stage: input.stage,
    mode: input.mode,
    rank: input.rank,
    filteringattributes: input.filteringAttributes,
    configuration: input.unsecureConfig,
    supporteddeployment: input.deployment,
  };
  if (input.filterId) {
    payload[`${sdkMessageFilterNav}@odata.bind`] = `/sdkmessagefilters(${input.filterId})`;
  }
  if (secureConfigId) {
    payload[`${secureConfigNav}@odata.bind`] = `/sdkmessageprocessingstepsecureconfigs(${secureConfigId})`;
  }

  return postDataverse<PluginStep>(connectionId, "sdkmessageprocessingsteps", payload);
}

export interface RegisterImageInput {
  stepId: string;
  alias: string;
  imageType: number;
  messagePropertyName: string;
  attributes: string;
}

export async function registerImage(connectionId: string, input: RegisterImageInput): Promise<PluginStepImage> {
  const stepNav = await getBindNavigationProperty(
    connectionId,
    "sdkmessageprocessingstepimage",
    "sdkmessageprocessingstepid",
  );
  return postDataverse<PluginStepImage>(connectionId, "sdkmessageprocessingstepimages", {
    name: input.alias,
    entityalias: input.alias,
    imagetype: input.imageType,
    messagepropertyname: input.messagePropertyName,
    attributes: input.attributes,
    [`${stepNav}@odata.bind`]: `/sdkmessageprocessingsteps(${input.stepId})`,
  });
}

export interface UpdateStepInput {
  name: string;
  stage: number;
  mode: number;
  rank: number;
  filteringAttributes: string;
  unsecureConfig: string;
  /** Empty string = leave the existing secure config record untouched (its value is never
   *  re-fetched/pre-filled into the edit form). Non-empty either updates the existing secure
   *  config record or creates+binds a new one if the step didn't have one yet. */
  secureConfig: string;
  deployment: number;
}

/** Editing an existing Step is scoped to its configuration — message/primary entity binding is
 *  left alone (Dataverse allows changing it via PATCH, but re-pointing a step at a different
 *  message/entity is unusual enough that delete-and-recreate is the clearer, safer path). */
export async function updateStep(connectionId: string, stepId: string, input: UpdateStepInput): Promise<void> {
  await patchDataverse(connectionId, `sdkmessageprocessingsteps(${stepId})`, {
    name: input.name,
    stage: input.stage,
    mode: input.mode,
    rank: input.rank,
    filteringattributes: input.filteringAttributes,
    configuration: input.unsecureConfig,
    supporteddeployment: input.deployment,
  });

  if (!input.secureConfig.trim()) return;

  const existing = await fetchDataverse<{ _sdkmessageprocessingstepsecureconfigid_value?: string | null }>(
    connectionId,
    `sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepsecureconfigid`,
  );
  const existingId = existing._sdkmessageprocessingstepsecureconfigid_value;
  if (existingId) {
    await patchDataverse(connectionId, `sdkmessageprocessingstepsecureconfigs(${existingId})`, {
      secureconfig: input.secureConfig,
    });
  } else {
    const secureConfigNav = await getBindNavigationProperty(
      connectionId,
      "sdkmessageprocessingstep",
      "sdkmessageprocessingstepsecureconfigid",
    );
    const created = await postDataverse<{ sdkmessageprocessingstepsecureconfigid: string }>(
      connectionId,
      "sdkmessageprocessingstepsecureconfigs",
      { secureconfig: input.secureConfig },
    );
    await patchDataverse(connectionId, `sdkmessageprocessingsteps(${stepId})`, {
      [`${secureConfigNav}@odata.bind`]: `/sdkmessageprocessingstepsecureconfigs(${created.sdkmessageprocessingstepsecureconfigid})`,
    });
  }
}

export interface UpdateImageInput {
  alias: string;
  imageType: number;
  messagePropertyName: string;
  attributes: string;
}

/** sdkmessageprocessingstepimages rejects PATCH outright — confirmed against a live org: even a
 *  single-field, content-unrelated PATCH (just `entityalias` to its own unchanged value) 400s
 *  with a vague "An unexpected error occurred" (0x80040216). Dataverse doesn't support updating
 *  an existing image in place; the real Plugin Registration Tool works around the same platform
 *  limitation by deleting and re-registering. Delete-then-create (not create-then-delete): a step
 *  can't hold two images of the same imagetype at once, so creating the replacement first would
 *  itself 400 while the old one still exists. */
export async function updateImage(connectionId: string, imageId: string, stepId: string, input: UpdateImageInput): Promise<PluginStepImage> {
  await deleteImage(connectionId, imageId);
  return registerImage(connectionId, {
    stepId,
    alias: input.alias,
    imageType: input.imageType,
    messagePropertyName: input.messagePropertyName,
    attributes: input.attributes,
  });
}

export async function setStepEnabled(connectionId: string, stepId: string, enabled: boolean): Promise<void> {
  await patchDataverse(connectionId, `sdkmessageprocessingsteps(${stepId})`, {
    statecode: enabled ? 0 : 1,
    statuscode: enabled ? 1 : 2,
  });
}

export async function deleteImage(connectionId: string, imageId: string): Promise<void> {
  await deleteDataverse(connectionId, `sdkmessageprocessingstepimages(${imageId})`);
}

export interface AssemblyInspectionResult {
  name: string;
  version: string;
  culture: string;
  publicKeyToken: string;
  contentBase64: string;
  pluginTypes: { typeName: string; friendlyName: string }[];
}

export async function pickPluginDll(): Promise<{ filePath: string | null; fileName: string | null }> {
  return callNative("dialog.pickFile");
}

export async function inspectAssembly(filePath: string): Promise<AssemblyInspectionResult> {
  return callNative<AssemblyInspectionResult>("plugin.inspectAssembly", { filePath });
}

function registerTypesPayload(assemblyId: string, t: { typeName: string; friendlyName: string }) {
  return {
    typename: t.typeName,
    name: t.typeName,
    friendlyname: t.friendlyName || t.typeName,
    "pluginassemblyid@odata.bind": `/pluginassemblies(${assemblyId})`,
  };
}

export async function registerAssembly(
  connectionId: string,
  inspection: AssemblyInspectionResult,
  selectedTypeNames: Set<string>,
): Promise<PluginAssembly> {
  const assembly = await postDataverse<PluginAssembly>(connectionId, "pluginassemblies", {
    name: inspection.name,
    version: inspection.version,
    culture: inspection.culture,
    publickeytoken: inspection.publicKeyToken,
    content: inspection.contentBase64,
    isolationmode: 2,
    sourcetype: 0,
  });

  const selected = inspection.pluginTypes.filter((t) => selectedTypeNames.has(t.typeName));
  await Promise.all(
    selected.map((t) => postDataverse(connectionId, "plugintypes", registerTypesPayload(assembly.pluginassemblyid, t))),
  );

  return assembly;
}

/** Re-uploads the DLL content and adds any newly-discovered, selected types. Never removes
 *  types missing from the new DLL — v1 scope explicitly leaves that to a manual follow-up,
 *  since a type could still have steps depending on it. */
export async function updateAssembly(
  connectionId: string,
  assemblyId: string,
  inspection: AssemblyInspectionResult,
  selectedTypeNames: Set<string>,
): Promise<void> {
  await patchDataverse(connectionId, `pluginassemblies(${assemblyId})`, {
    content: inspection.contentBase64,
    version: inspection.version,
    culture: inspection.culture,
    publickeytoken: inspection.publicKeyToken,
  });

  const existing = await fetchPluginTypes(connectionId, assemblyId);
  const existingNames = new Set(existing.map((t) => t.typename));
  const newTypes = inspection.pluginTypes.filter(
    (t) => selectedTypeNames.has(t.typeName) && !existingNames.has(t.typeName),
  );
  await Promise.all(newTypes.map((t) => postDataverse(connectionId, "plugintypes", registerTypesPayload(assemblyId, t))));
}

export async function deleteStepCascade(connectionId: string, stepId: string): Promise<void> {
  const [images, stepDetail] = await Promise.all([
    fetchImages(connectionId, stepId),
    fetchDataverse<{ _sdkmessageprocessingstepsecureconfigid_value?: string | null }>(
      connectionId,
      `sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepsecureconfigid`,
    ).catch(() => null),
  ]);
  await Promise.all(images.map((img) => deleteImage(connectionId, img.sdkmessageprocessingstepimageid)));
  await deleteDataverse(connectionId, `sdkmessageprocessingsteps(${stepId})`);

  const secureConfigId = stepDetail?._sdkmessageprocessingstepsecureconfigid_value;
  if (secureConfigId) {
    await deleteDataverse(connectionId, `sdkmessageprocessingstepsecureconfigs(${secureConfigId})`).catch(() => {
      // Best-effort cleanup — a missing/already-removed secure config shouldn't block the step delete above.
    });
  }
}

export async function deleteTypeCascade(connectionId: string, pluginTypeId: string): Promise<void> {
  const steps = await fetchSteps(connectionId, pluginTypeId);
  // Sequential, not Promise.all — each step's own cascade already fans out internally, and
  // running many of those in parallel multiplies concurrent requests without much real benefit.
  for (const step of steps) {
    await deleteStepCascade(connectionId, step.sdkmessageprocessingstepid);
  }
  await deleteDataverse(connectionId, `plugintypes(${pluginTypeId})`);
}

/** Not wired to any UI button — deleting a whole assembly cascades through every type/step/image
 *  under it, which is too easy to trigger by accident from a tree view. Kept here in case a
 *  more deliberate flow (e.g. a confirmation dialog that names every affected step) is added
 *  later; delete the assembly's types individually via deleteTypeCascade in the meantime. */
export async function deleteAssemblyCascade(connectionId: string, assemblyId: string): Promise<void> {
  const types = await fetchPluginTypes(connectionId, assemblyId);
  for (const type of types) {
    await deleteTypeCascade(connectionId, type.plugintypeid);
  }
  await deleteDataverse(connectionId, `pluginassemblies(${assemblyId})`);
}
