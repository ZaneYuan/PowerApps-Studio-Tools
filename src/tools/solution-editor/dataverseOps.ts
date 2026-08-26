import { callNative } from "../../native/bridge";
import {
  COMPONENT_NAME_RESOLVERS,
  ENTITY_COMPONENT_TYPE,
  SYSTEM_FORM_COMPONENT_TYPE,
  type BasicColumnType,
  type ColumnFieldMeta,
  type EntityBasicInfo,
  type Publisher,
  type SolutionComponentRow,
  type SolutionSummary,
} from "./types";

/** Metadata writes (CreateEntity / column creation) can take noticeably longer than a plain
 *  record write — same reasoning as ribbon-workbench's LONG_TIMEOUT_MS for solution export/import. */
const LONG_TIMEOUT_MS = 120_000;

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

export async function fetchSolutions(connectionId: string): Promise<SolutionSummary[]> {
  const res = await fetchDataverse<{
    value: {
      solutionid: string;
      uniquename: string;
      friendlyname: string;
      version: string;
      description: string | null;
      ismanaged: boolean;
      publisherid: { friendlyname: string; customizationprefix: string } | null;
    }[];
  }>(
    connectionId,
    "solutions?$filter=isvisible eq true" +
      "&$select=solutionid,uniquename,friendlyname,version,description,ismanaged" +
      "&$expand=publisherid($select=friendlyname,customizationprefix)" +
      "&$orderby=friendlyname",
  );
  return res.value.map((s) => ({
    solutionid: s.solutionid,
    uniquename: s.uniquename,
    friendlyname: s.friendlyname,
    version: s.version,
    description: s.description,
    ismanaged: s.ismanaged,
    publisherName: s.publisherid?.friendlyname ?? "?",
    publisherPrefix: s.publisherid?.customizationprefix ?? "",
  }));
}

export async function fetchPublishers(connectionId: string): Promise<Publisher[]> {
  const res = await fetchDataverse<{ value: Publisher[] }>(
    connectionId,
    "publishers?$select=publisherid,friendlyname,customizationprefix&$orderby=friendlyname",
  );
  return res.value;
}

export interface NewPublisherParams {
  uniqueName: string;
  friendlyName: string;
  customizationPrefix: string;
  /** Dataverse's own documented range for `customizationoptionvalueprefix` (10000–99999) —
   *  validated client-side before submitting so an obviously-invalid value fails fast instead of
   *  round-tripping to the server first. */
  customizationOptionValuePrefix: number;
  description: string;
}

export async function createPublisher(connectionId: string, params: NewPublisherParams): Promise<void> {
  if (params.customizationOptionValuePrefix < 10000 || params.customizationOptionValuePrefix > 99999) {
    throw new Error("Option Value Prefix 必须在 10000–99999 之间（Dataverse 的固定要求）。");
  }
  await callNative("dataverse.request", {
    connectionId,
    method: "POST",
    path: "publishers",
    body: {
      uniquename: params.uniqueName,
      friendlyname: params.friendlyName,
      customizationprefix: params.customizationPrefix,
      customizationoptionvalueprefix: params.customizationOptionValuePrefix,
      description: params.description || null,
    },
  });
}

/** `customizationprefix`/`customizationoptionvalueprefix` aren't included — Dataverse treats both
 *  as foundational to the publisher's identity and locks them after creation (matches
 *  make.powerapps' own publisher editor, which also only lets you change name/description on an
 *  existing publisher). */
export async function updatePublisher(connectionId: string, publisherId: string, params: { friendlyName: string; description: string }): Promise<void> {
  await callNative("dataverse.request", {
    connectionId,
    method: "PATCH",
    path: `publishers(${publisherId})`,
    body: { friendlyname: params.friendlyName, description: params.description || null },
  });
}

export async function createSolution(
  connectionId: string,
  params: { uniqueName: string; friendlyName: string; version: string; publisherId: string; description: string },
): Promise<void> {
  await callNative(
    "dataverse.request",
    {
      connectionId,
      method: "POST",
      path: "solutions",
      body: {
        uniquename: params.uniqueName,
        friendlyname: params.friendlyName,
        version: params.version || "1.0.0.0",
        description: params.description || null,
        "publisherid@odata.bind": `/publishers(${params.publisherId})`,
      },
    },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
}

/** Every component row in a solution, with a best-effort friendly name — Entity(1) rows resolve
 *  via EntityDefinitions (mirrors ribbon-workbench's fetchSolutionEntities), the handful of types
 *  in COMPONENT_NAME_RESOLVERS resolve via a plain GET, everything else comes back with
 *  `name: null` and the caller shows its type label + raw GUID instead. One request per component
 *  (Promise.all) rather than trying to batch by type — a solution worth browsing here rarely has
 *  hundreds of components, and a failed lookup only drops that one row's name, never the list. */
export async function fetchSolutionComponents(connectionId: string, solutionId: string): Promise<SolutionComponentRow[]> {
  const res = await fetchDataverse<{
    value: { solutioncomponentid: string; componenttype: number; objectid: string; rootcomponentbehavior?: number | null }[];
  }>(
    connectionId,
    `solutioncomponents?$select=solutioncomponentid,componenttype,objectid,rootcomponentbehavior&$filter=_solutionid_value eq ${solutionId}`,
  );

  return Promise.all(
    res.value.map(async (c): Promise<SolutionComponentRow> => {
      const base = { solutioncomponentid: c.solutioncomponentid, componenttype: c.componenttype, objectid: c.objectid };
      try {
        if (c.componenttype === ENTITY_COMPONENT_TYPE) {
          const meta = await fetchDataverse<{ LogicalName: string; DisplayName?: { UserLocalizedLabel?: { Label: string } | null } | null }>(
            connectionId,
            `EntityDefinitions(${c.objectid})?$select=LogicalName,DisplayName`,
          );
          return {
            ...base,
            name: meta.DisplayName?.UserLocalizedLabel?.Label ?? meta.LogicalName,
            logicalName: meta.LogicalName,
            rootComponentBehavior: c.rootcomponentbehavior ?? undefined,
          };
        }
        if (c.componenttype === SYSTEM_FORM_COMPONENT_TYPE) {
          const row = await fetchDataverse<{ name: string; objecttypecode: string }>(
            connectionId,
            `systemforms(${c.objectid})?$select=name,objecttypecode`,
          );
          return { ...base, name: row.name ?? null, ownerEntityLogicalName: row.objecttypecode };
        }
        const resolver = COMPONENT_NAME_RESOLVERS[c.componenttype];
        if (!resolver) return { ...base, name: null };
        const row = await fetchDataverse<Record<string, string>>(
          connectionId,
          `${resolver.entitySet}(${c.objectid})?$select=${resolver.nameField}`,
        );
        return { ...base, name: row[resolver.nameField] ?? null };
      } catch {
        return { ...base, name: null }; // stale/orphaned solutioncomponent row — don't break the list
      }
    }),
  );
}

/** Adds an existing table to the solution — same `AddSolutionComponent` shape ribbon-workbench
 *  would use for this (it currently only reads solutions that already contain the target entity). */
export async function addExistingTableComponent(connectionId: string, solutionUniqueName: string, entityMetadataId: string): Promise<void> {
  await callNative("dataverse.request", {
    connectionId,
    method: "POST",
    path: "AddSolutionComponent",
    body: {
      ComponentType: ENTITY_COMPONENT_TYPE,
      ComponentId: entityMetadataId,
      SolutionUniqueName: solutionUniqueName,
      AddRequiredComponents: false,
    },
  });
}

export interface PickableEntity {
  metadataId: string;
  logicalName: string;
  displayName: string;
}

export async function fetchAllEntitiesForPicker(connectionId: string): Promise<PickableEntity[]> {
  const res = await fetchDataverse<{
    value: { MetadataId: string; LogicalName: string; DisplayName?: { UserLocalizedLabel?: { Label: string } | null } | null }[];
  }>(connectionId, "EntityDefinitions?$select=MetadataId,LogicalName,DisplayName");
  return res.value
    .map((e) => ({ metadataId: e.MetadataId, logicalName: e.LogicalName, displayName: e.DisplayName?.UserLocalizedLabel?.Label ?? e.LogicalName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** `<prefix>_DisplayNameWithSpacesStripped` — a starting-point SchemaName the user can still
 *  edit before submitting, same convenience XrmToolBox-style tools offer. Only produces something
 *  useful for an ASCII display name (Dataverse SchemaNames are ASCII letters/digits/underscore
 *  only); a non-ASCII displayName (e.g. Chinese) collapses to just the bare prefix, which is a
 *  correct (if unhelpful) starting point rather than an empty/invalid string. */
export function suggestSchemaName(prefix: string, displayName: string): string {
  const cleaned = displayName.replace(/[^A-Za-z0-9]/g, "");
  return `${prefix}_${cleaned}`;
}

function label(text: string): Record<string, unknown> {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.Label",
    LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: text, LanguageCode: 1033 }],
  };
}

function requiredLevel(required: boolean): Record<string, unknown> {
  return {
    Value: required ? "ApplicationRequired" : "None",
    CanBeChanged: true,
    ManagedPropertyLogicalName: "canmodifyrequirementlevelsettings",
  };
}

export interface NewColumnParams {
  schemaName: string;
  displayName: string;
  description: string;
  required: boolean;
  /** String/Memo */
  maxLength?: number;
  /** Integer/Decimal */
  minValue?: number;
  maxValue?: number;
  /** Decimal */
  precision?: number;
  /** DateTime */
  dateFormat?: "DateOnly" | "DateAndTime";
  /** Boolean */
  trueLabel?: string;
  falseLabel?: string;
  /** Picklist — label-only, Value intentionally omitted so Dataverse auto-assigns from the
   *  publisher's option-value range (see the Solution 编辑器 plan: this avoids making the user
   *  invent numbers that might collide). */
  options?: string[];
}

/** Builds one `AttributeMetadata`-shaped body for any of the 8 basic column types — shared by
 *  createTable (the mandatory primary-name column) and createColumn (everything after), so the
 *  Label-wrapping boilerplate isn't duplicated 8 times. Shapes match Microsoft's current Web API
 *  docs examples exactly (create-update-column-definitions-using-web-api), field for field —
 *  this is the one part of this tool that's never been exercised against a live org, see the plan. */
export function buildAttributeBody(type: BasicColumnType, isPrimaryName: boolean, params: NewColumnParams): Record<string, unknown> {
  const common = {
    SchemaName: params.schemaName,
    DisplayName: label(params.displayName),
    Description: label(params.description || params.displayName),
    RequiredLevel: requiredLevel(params.required),
  };

  switch (type) {
    case "String":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        AttributeType: "String",
        AttributeTypeName: { Value: "StringType" },
        FormatName: { Value: "Text" },
        MaxLength: params.maxLength ?? 100,
        ...(isPrimaryName ? { IsPrimaryName: true } : {}),
      };
    case "Memo":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
        AttributeType: "Memo",
        AttributeTypeName: { Value: "MemoType" },
        Format: "TextArea",
        MaxLength: params.maxLength ?? 2000,
      };
    case "Integer":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
        AttributeType: "Integer",
        AttributeTypeName: { Value: "IntegerType" },
        Format: "None",
        MinValue: params.minValue ?? -2147483648,
        MaxValue: params.maxValue ?? 2147483647,
      };
    case "Decimal":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
        AttributeType: "Decimal",
        AttributeTypeName: { Value: "DecimalType" },
        MinValue: params.minValue ?? -100000000000,
        MaxValue: params.maxValue ?? 100000000000,
        Precision: params.precision ?? 2,
      };
    case "Money":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.MoneyAttributeMetadata",
        AttributeType: "Money",
        AttributeTypeName: { Value: "MoneyType" },
        PrecisionSource: 2,
      };
    case "Boolean":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
        AttributeType: "Boolean",
        AttributeTypeName: { Value: "BooleanType" },
        DefaultValue: false,
        OptionSet: {
          // Confirmed against a real Dataverse 400 (2026-08-21 integration test run): a Boolean
          // attribute's OptionSet must be the derived Microsoft.Dynamics.CRM.BooleanOptionSetMetadata
          // type, not the generic OptionSetMetadata every other OptionSet-bearing type here uses —
          // Dataverse rejects the generic type with "not assignable to the expected type
          // 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata'".
          "@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata",
          OptionSetType: "Boolean",
          TrueOption: { Value: 1, Label: label(params.trueLabel || "是") },
          FalseOption: { Value: 0, Label: label(params.falseLabel || "否") },
        },
      };
    case "DateTime":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        AttributeType: "DateTime",
        AttributeTypeName: { Value: "DateTimeType" },
        Format: params.dateFormat ?? "DateOnly",
      };
    case "Picklist":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
        AttributeType: "Picklist",
        AttributeTypeName: { Value: "PicklistType" },
        OptionSet: {
          "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
          IsGlobal: false,
          OptionSetType: "Picklist",
          Options: (params.options ?? []).map((text) => ({ Label: label(text) })),
        },
      };
    case "MultiSelectPicklist":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata",
        // Confirmed against a real Dataverse 500 (2026-08-21 integration test run — the previous
        // AttributeType: "MultiSelectPicklist" isn't a real enum value and Dataverse rejected it
        // with "Requested value 'MultiSelectPicklist' was not found") and then against Microsoft's
        // own documented worked example: a multi-select choice column's *wire* AttributeType is
        // "Virtual" and its OptionSet.OptionSetType is "Picklist" — MultiSelectPicklistType only
        // shows up in AttributeTypeName, which is the actual discriminator client tools read to
        // recognize this as multi-select rather than a real Virtual/calculated column.
        AttributeType: "Virtual",
        AttributeTypeName: { Value: "MultiSelectPicklistType" },
        OptionSet: {
          "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
          IsGlobal: false,
          OptionSetType: "Picklist",
          Options: (params.options ?? []).map((text) => ({ Label: label(text) })),
        },
      };
    case "BigInt":
      return {
        ...common,
        "@odata.type": "Microsoft.Dynamics.CRM.BigIntAttributeMetadata",
        AttributeType: "BigInt",
        AttributeTypeName: { Value: "BigIntType" },
      };
  }
}

/** Builds a Picklist column body that reuses an existing *global* choice instead of defining its
 *  own local options — `GlobalOptionSet@odata.bind` per Microsoft's own worked example ("Create a
 *  choice column by using a global option set"). No `Options` array here at all: the column
 *  inherits whatever options the global choice already has. */
export function buildGlobalChoiceAttributeBody(globalOptionSetId: string, params: NewColumnParams): Record<string, unknown> {
  return {
    SchemaName: params.schemaName,
    DisplayName: label(params.displayName),
    Description: label(params.description || params.displayName),
    RequiredLevel: requiredLevel(params.required),
    "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
    AttributeType: "Picklist",
    AttributeTypeName: { Value: "PicklistType" },
    "GlobalOptionSet@odata.bind": `/GlobalOptionSetDefinitions(${globalOptionSetId})`,
  };
}

export async function createColumnWithGlobalChoice(
  connectionId: string,
  solutionUniqueName: string,
  entityLogicalName: string,
  globalOptionSetId: string,
  params: NewColumnParams,
): Promise<void> {
  await callNative(
    "dataverse.request",
    {
      connectionId,
      solutionUniqueName,
      method: "POST",
      path: `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes`,
      body: buildGlobalChoiceAttributeBody(globalOptionSetId, params),
    },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
}

export interface NewGlobalOptionSetParams {
  name: string;
  displayName: string;
  description: string;
  options: string[];
}

/** `Value: null` on every option per Microsoft's own strong recommendation ("we recommend that you
 *  let the system assign a value") — same reasoning as the local Picklist's label-only Options
 *  above, just restated for the global case where it matters even more (a global choice's values
 *  get merged across every solution layer that touches it; a hand-picked value is far more likely
 *  to collide). */
export function buildGlobalOptionSetBody(params: NewGlobalOptionSetParams): Record<string, unknown> {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
    Name: params.name,
    DisplayName: label(params.displayName),
    Description: label(params.description || params.displayName),
    OptionSetType: "Picklist",
    IsGlobal: true,
    Options: params.options.map((text) => ({ Value: null, Label: label(text) })),
  };
}

export async function createGlobalOptionSet(connectionId: string, solutionUniqueName: string, params: NewGlobalOptionSetParams): Promise<void> {
  await callNative(
    "dataverse.request",
    { connectionId, solutionUniqueName, method: "POST", path: "GlobalOptionSetDefinitions", body: buildGlobalOptionSetBody(params) },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
}

export interface GlobalOptionSetSummary {
  metadataId: string;
  name: string;
  displayName: string;
}

/** Tight `$select` per this codebase's own established rule for metadata endpoints (see
 *  mcp-dataverse's own learned pitfall: an unscoped metadata query risks timing out) — a tenant
 *  can have hundreds of *system* global choices alone, well before counting custom ones. */
export async function fetchGlobalOptionSets(connectionId: string): Promise<GlobalOptionSetSummary[]> {
  const res = await fetchDataverse<{
    value: { MetadataId: string; Name: string; DisplayName?: { UserLocalizedLabel?: { Label: string } | null } | null }[];
  }>(connectionId, "GlobalOptionSetDefinitions?$select=MetadataId,Name,DisplayName");
  return res.value
    .map((o) => ({ metadataId: o.MetadataId, name: o.Name, displayName: o.DisplayName?.UserLocalizedLabel?.Label ?? o.Name }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface NewLookupColumnParams {
  schemaName: string;
  displayName: string;
  description: string;
  required: boolean;
  /** The table this lookup column points *to* (the "one" side / parent). */
  referencedEntity: string;
  /** The table the lookup column is added *to* (the "many" side / child) — i.e. the table
   *  currently open in the editor. */
  referencingEntity: string;
  referencedAttribute: string;
  relationshipSchemaName: string;
}

/** Builds the deep-insert `OneToManyRelationshipMetadata` + nested `Lookup` body that creates a
 *  relationship and its lookup column in one POST — shape confirmed field-for-field against
 *  Microsoft's own worked Web API example ("Create and update table relationships using the Web
 *  API" → "Create a one-to-many relationship"), not guessed.
 *
 *  CascadeConfiguration is fixed at the safe default every one of Microsoft's own SDK samples
 *  uses for a plain new lookup (`Delete: RemoveLink`, everything else `NoCascade`) — deleting the
 *  referenced ("one") record only clears this lookup on child records, it never cascades a delete
 *  onto them. This app's v2 doesn't expose cascade configuration as a UI choice at all: the other
 *  five cascade settings a relationship supports (Assign/Merge/Reparent/Share/Unshare, plus
 *  Delete's other option `Cascade`) each have real, non-obvious data-loss implications if picked
 *  wrong, and getting `Delete: Cascade` on a new lookup by way of an unfamiliar dropdown is exactly
 *  the kind of mistake a guided tool should make hard to reach by accident, not easy. */
export function buildOneToManyRelationshipBody(params: NewLookupColumnParams): Record<string, unknown> {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
    SchemaName: params.relationshipSchemaName,
    ReferencedEntity: params.referencedEntity,
    ReferencingEntity: params.referencingEntity,
    ReferencedAttribute: params.referencedAttribute,
    AssociatedMenuConfiguration: {
      Behavior: "UseCollectionName",
      Group: "Details",
      Order: 10000,
    },
    CascadeConfiguration: {
      Assign: "NoCascade",
      Delete: "RemoveLink",
      Merge: "NoCascade",
      Reparent: "NoCascade",
      Share: "NoCascade",
      Unshare: "NoCascade",
    },
    Lookup: {
      "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
      AttributeType: "Lookup",
      AttributeTypeName: { Value: "LookupType" },
      SchemaName: params.schemaName,
      DisplayName: label(params.displayName),
      Description: label(params.description || params.displayName),
      RequiredLevel: requiredLevel(params.required),
    },
  };
}

/** The referenced (parent) table's real primary id attribute — required as `ReferencedAttribute`
 *  on the relationship body above. Fetched, not assumed to be `{logicalname}id`: that convention
 *  is overwhelmingly consistent in practice but this is exactly the kind of value this codebase's
 *  own established rule says to read from metadata rather than guess (see navProperty.ts and
 *  metadataService.ts's own doc comments on the same point). */
export async function fetchEntityPrimaryIdAttribute(connectionId: string, entityLogicalName: string): Promise<string> {
  const meta = await fetchDataverse<{ PrimaryIdAttribute: string }>(
    connectionId,
    `EntityDefinitions(LogicalName='${entityLogicalName}')?$select=PrimaryIdAttribute`,
  );
  return meta.PrimaryIdAttribute;
}

export async function createLookupColumn(connectionId: string, solutionUniqueName: string, params: Omit<NewLookupColumnParams, "referencedAttribute">): Promise<void> {
  const referencedAttribute = await fetchEntityPrimaryIdAttribute(connectionId, params.referencedEntity);
  await callNative(
    "dataverse.request",
    {
      connectionId,
      solutionUniqueName,
      method: "POST",
      path: "RelationshipDefinitions",
      body: buildOneToManyRelationshipBody({ ...params, referencedAttribute }),
    },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
}

/** Publishes exactly the tables that belong to one solution, instead of `publishAll`'s org-wide
 *  republish — Dataverse's Web API has no "publish this one solution" primitive (`PublishXml` only
 *  takes an explicit component list, never a solution id), so this builds that list from the
 *  Entity-type rows the caller already has (SolutionEditor.tsx's own `entityRows`, straight from
 *  fetchSolutionComponents — no extra round-trip needed). Pure text-building split out from the
 *  network call for the same testability reason every other builder in this file is. */
export function buildPublishXmlForEntities(entityLogicalNames: string[]): string {
  const entities = entityLogicalNames.map((n) => `<entity>${n}</entity>`).join("");
  return `<importexportxml><entities>${entities}</entities></importexportxml>`;
}

export async function publishSolutionEntities(connectionId: string, entityLogicalNames: string[]): Promise<void> {
  if (entityLogicalNames.length === 0) return; // nothing to publish — same as PublishXml's own no-op for an empty list
  await callNative(
    "dataverse.request",
    { connectionId, method: "POST", path: "PublishXml", body: { ParameterXml: buildPublishXmlForEntities(entityLogicalNames) } },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
}

export interface NewTableParams {
  schemaName: string;
  displayName: string;
  displayCollectionName: string;
  description: string;
  ownershipType: "UserOwned" | "OrganizationOwned";
  primaryFieldSchemaName: string;
  primaryFieldDisplayName: string;
}

/** Response is a bare 204 with the new MetadataId only in the OData-EntityId header, per
 *  Microsoft's docs — the C# bridge now synthesizes `{ odataEntityId }` for that case (see
 *  DataverseApiClient.cs). The new table's LogicalName is derived client-side as
 *  `schemaName.toLowerCase()` rather than round-tripping a GET for it — Dataverse guarantees
 *  LogicalName is always exactly that, no other transformation. */
export async function createTable(connectionId: string, solutionUniqueName: string, params: NewTableParams): Promise<{ logicalName: string }> {
  const primaryAttribute = buildAttributeBody("String", true, {
    schemaName: params.primaryFieldSchemaName,
    displayName: params.primaryFieldDisplayName,
    description: params.primaryFieldDisplayName,
    required: false,
    maxLength: 100,
  });

  await callNative(
    "dataverse.request",
    {
      connectionId,
      solutionUniqueName,
      method: "POST",
      path: "EntityDefinitions",
      body: {
        "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
        SchemaName: params.schemaName,
        DisplayName: label(params.displayName),
        DisplayCollectionName: label(params.displayCollectionName),
        Description: label(params.description || params.displayName),
        OwnershipType: params.ownershipType,
        HasActivities: false,
        HasNotes: false,
        IsActivity: false,
        Attributes: [primaryAttribute],
      },
    },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
  return { logicalName: params.schemaName.toLowerCase() };
}

export async function createColumn(
  connectionId: string,
  solutionUniqueName: string,
  entityLogicalName: string,
  type: BasicColumnType,
  params: NewColumnParams,
): Promise<void> {
  await callNative(
    "dataverse.request",
    {
      connectionId,
      solutionUniqueName,
      method: "POST",
      path: `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes`,
      body: buildAttributeBody(type, false, params),
    },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
}

export async function fetchEntityFields(connectionId: string, entityLogicalName: string): Promise<ColumnFieldMeta[]> {
  const res = await fetchDataverse<{
    value: {
      MetadataId: string;
      LogicalName: string;
      AttributeType: string;
      AttributeTypeName?: { Value: string } | null;
      IsPrimaryName: boolean;
      IsCustomAttribute: boolean;
      DisplayName?: { UserLocalizedLabel?: { Label: string } | null } | null;
      RequiredLevel?: { Value: string } | null;
    }[];
  }>(
    connectionId,
    `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes` +
      "?$select=MetadataId,LogicalName,AttributeType,AttributeTypeName,IsPrimaryName,IsCustomAttribute,DisplayName,RequiredLevel",
  );
  return res.value
    .filter((a) => a.AttributeType !== "Virtual" || a.AttributeTypeName?.Value === "MultiSelectPicklistType")
    .map((a) => ({
      metadataId: a.MetadataId,
      logicalName: a.LogicalName,
      displayName: a.DisplayName?.UserLocalizedLabel?.Label ?? a.LogicalName,
      // A multi-select choice column's real wire AttributeType is "Virtual" (see
      // buildAttributeBody's own doc comment on why) — that's meaningless to show a user in a
      // field list, so it's normalized back to the type name this app's own create flow actually
      // calls it (matching what buildAttributeBody accepts for BasicColumnType).
      attributeType: a.AttributeTypeName?.Value === "MultiSelectPicklistType" ? "MultiSelectPicklist" : a.AttributeType,
      isPrimaryName: a.IsPrimaryName,
      isCustomAttribute: a.IsCustomAttribute,
      required: !!a.RequiredLevel && a.RequiredLevel.Value !== "None",
    }));
}

/** The handful of fields make.powerapps' own table overview page ("Table properties" card)
 *  shows — deliberately not the field list, which lives on its own "Columns" page instead (see
 *  fetchEntityFields above and SolutionEditor.tsx's entity vs entity-columns views). */
export async function fetchEntityBasicInfo(connectionId: string, entityLogicalName: string): Promise<EntityBasicInfo> {
  const meta = await fetchDataverse<{
    LogicalName: string;
    DisplayName?: { UserLocalizedLabel?: { Label: string } | null } | null;
    DisplayCollectionName?: { UserLocalizedLabel?: { Label: string } | null } | null;
    Description?: { UserLocalizedLabel?: { Label: string } | null } | null;
    PrimaryNameAttribute: string;
    OwnershipType: string;
    IsCustomEntity: boolean;
    EntitySetName: string;
    ModifiedOn: string | null;
  }>(
    connectionId,
    `EntityDefinitions(LogicalName='${entityLogicalName}')` +
      "?$select=LogicalName,DisplayName,DisplayCollectionName,Description,PrimaryNameAttribute,OwnershipType,IsCustomEntity,EntitySetName,ModifiedOn",
  );
  return {
    logicalName: meta.LogicalName,
    displayName: meta.DisplayName?.UserLocalizedLabel?.Label ?? meta.LogicalName,
    displayCollectionName: meta.DisplayCollectionName?.UserLocalizedLabel?.Label ?? meta.LogicalName,
    description: meta.Description?.UserLocalizedLabel?.Label ?? null,
    primaryNameAttribute: meta.PrimaryNameAttribute,
    ownershipType: meta.OwnershipType,
    isCustomEntity: meta.IsCustomEntity,
    entitySetName: meta.EntitySetName,
    modifiedOn: meta.ModifiedOn,
  };
}

/** Republishes every customization org-wide — Dataverse's Web API has no "publish only this one
 *  solution" primitive (PublishXml only takes an explicit component list, not a solution id); see
 *  the Solution 编辑器 plan for why this is the accepted v1 tradeoff (same semantics as XrmToolBox's
 *  own "Publish All" button). */
export async function publishAll(connectionId: string): Promise<void> {
  await callNative(
    "dataverse.request",
    { connectionId, method: "POST", path: "PublishAllXml", body: {} },
    { timeoutMs: LONG_TIMEOUT_MS },
  );
}
