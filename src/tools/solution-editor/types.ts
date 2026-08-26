export interface Publisher {
  publisherid: string;
  friendlyname: string;
  customizationprefix: string;
}

export interface SolutionSummary {
  solutionid: string;
  uniquename: string;
  friendlyname: string;
  version: string;
  description: string | null;
  ismanaged: boolean;
  publisherName: string;
  publisherPrefix: string;
}

/** componenttype's full option set, straight off Microsoft's current `solutioncomponent`
 *  reference page — cheap to keep complete even though only a handful get name-resolution below,
 *  since an unresolved type still needs a readable label instead of a bare number. */
export const COMPONENT_TYPE_LABELS: Record<number, string> = {
  1: "Entity（表）",
  2: "Attribute（字段）",
  3: "Relationship（关系）",
  4: "Attribute Picklist Value",
  5: "Attribute Lookup Value",
  6: "View Attribute",
  7: "Localized Label",
  8: "Relationship Extra Condition",
  9: "Option Set（全局选项集）",
  10: "Entity Relationship",
  11: "Entity Relationship Role",
  12: "Entity Relationship Relationships",
  13: "Managed Property",
  14: "Entity Key",
  16: "Privilege",
  17: "PrivilegeObjectTypeCode",
  18: "Index",
  20: "Role（安全角色）",
  21: "Role Privilege",
  22: "Display String",
  23: "Display String Map",
  24: "Form（窗体）",
  25: "Organization",
  26: "Saved Query（视图）",
  29: "Workflow（流程）",
  31: "Report",
  32: "Report Entity",
  33: "Report Category",
  34: "Report Visibility",
  35: "Attachment",
  36: "Email Template",
  37: "Contract Template",
  38: "KB Article Template",
  39: "Mail Merge Template",
  44: "Duplicate Rule",
  45: "Duplicate Rule Condition",
  46: "Entity Map",
  47: "Attribute Map",
  48: "Ribbon Command",
  49: "Ribbon Context Group",
  50: "Ribbon Customization",
  52: "Ribbon Rule",
  53: "Ribbon Tab To Command Map",
  55: "Ribbon Diff",
  59: "Saved Query Visualization（图表）",
  60: "System Form（窗体）",
  61: "Web Resource",
  62: "Site Map",
  63: "Connection Role",
  64: "Complex Control",
  65: "Hierarchy Rule",
  66: "Custom Control",
  68: "Custom Control Default Config",
  70: "Field Security Profile",
  71: "Field Permission",
  90: "Plugin Type",
  91: "Plugin Assembly",
  92: "SDK Message Processing Step",
  93: "SDK Message Processing Step Image",
  95: "Service Endpoint",
  150: "Routing Rule",
  151: "Routing Rule Item",
  152: "SLA",
  153: "SLA Item",
  154: "Convert Rule",
  155: "Convert Rule Item",
  161: "Mobile Offline Profile",
  162: "Mobile Offline Profile Item",
  165: "Similarity Rule",
  166: "Data Source Mapping",
  201: "SDKMessage",
  202: "SDKMessageFilter",
  203: "SdkMessagePair",
  204: "SdkMessageRequest",
  205: "SdkMessageRequestField",
  206: "SdkMessageResponse",
  207: "SdkMessageResponseField",
  208: "Import Map",
  210: "WebWizard",
  300: "Canvas App",
  371: "Connector",
  372: "Connector",
  380: "Environment Variable Definition",
  381: "Environment Variable Value",
  400: "AI Project Type",
  401: "AI Project",
  402: "AI Configuration",
  430: "Entity Analytics Configuration",
  431: "Attribute Image Configuration",
  432: "Entity Image Configuration",
};

export const ENTITY_COMPONENT_TYPE = 1;
export const ATTRIBUTE_COMPONENT_TYPE = 2;
export const SYSTEM_FORM_COMPONENT_TYPE = 60;

/** componenttype values that are really *sub*-components of a specific table (a field, a
 *  relationship) rather than standalone objects — Dataverse's solutioncomponents list still gives
 *  each of these its own row/type, but showing them as top-level tree groups (with unresolvable
 *  GUIDs as labels, since none of them are in COMPONENT_NAME_RESOLVERS) doesn't match how
 *  make.powerapps actually presents them: nested under their owning table's Columns/Relationships
 *  pages instead. This tool doesn't correlate each row back to its owning table id (no cheap,
 *  confirmed Web API way to do that from just the row), so it takes the simpler route of nesting
 *  a live "字段" page under every Entity node (fetchEntityFields, not scoped to solutioncomponents)
 *  and excluding these types from the flat top-level grouping entirely — see SolutionEditor.tsx. */
export const ENTITY_SUBCOMPONENT_TYPES = new Set([2, 3, 10, 11, 12]);

/** componenttype → {entitySet, nameField} for the ordinary (non-metadata) component types this
 *  tool resolves a friendly name for — deliberately a short, high-confidence list rather than
 *  every type in COMPONENT_TYPE_LABELS. `pluginassemblies`/`plugintypes`/`sdkmessageprocessingsteps`
 *  match what `plugin-registration/dataverseOps.ts` already queries in this same codebase; the
 *  rest are well-known Dataverse entity set names. Entity(1) itself isn't here — it needs
 *  EntityDefinitions, not a regular entity query, and gets special-cased in dataverseOps.ts.
 *  Anything not in this map just shows its type label + raw GUID, which is an accepted v1
 *  limitation, not a bug — see the Solution 编辑器 plan. */
export const COMPONENT_NAME_RESOLVERS: Record<number, { entitySet: string; nameField: string }> = {
  20: { entitySet: "roles", nameField: "name" },
  26: { entitySet: "savedqueries", nameField: "name" },
  29: { entitySet: "workflows", nameField: "name" },
  // 60 (System Form) is NOT here — it's special-cased in fetchSolutionComponents instead, since it
  // also needs `objecttypecode` (the owning table) to nest under that table's tree node, not just
  // a name (see SolutionComponentRow.ownerEntityLogicalName below).
  61: { entitySet: "webresourceset", nameField: "name" },
  63: { entitySet: "connectionroles", nameField: "name" },
  70: { entitySet: "fieldsecurityprofiles", nameField: "name" },
  90: { entitySet: "plugintypes", nameField: "friendlyname" },
  91: { entitySet: "pluginassemblies", nameField: "name" },
  92: { entitySet: "sdkmessageprocessingsteps", nameField: "name" },
  300: { entitySet: "canvasapps", nameField: "name" },
};

export interface SolutionComponentRow {
  solutioncomponentid: string;
  componenttype: number;
  objectid: string;
  /** Resolved friendly name, or null when this component's type isn't in COMPONENT_NAME_RESOLVERS
   *  (or the lookup itself failed — a stale/orphaned solutioncomponent row shouldn't break the
   *  rest of the list, same tolerance ribbon-workbench's fetchSolutionEntities already uses). */
  name: string | null;
  /** Entity(1) rows only — the table's LogicalName, needed to list/create its fields. Every other
   *  componenttype leaves this undefined; the field panel only ever renders for Entity rows. */
  logicalName?: string;
  /** Entity(1) rows only — `solutioncomponent.rootcomponentbehavior`: 0 = "Include Subcomponents"
   *  (every current/future field/relationship/form/... is implicitly part of the solution;
   *  Dataverse doesn't create an individual child solutioncomponent row for each one), 1 = "Do Not
   *  Include Subcomponents", 2 = "Include As Shell Only". 1/2 both mean only what's explicitly
   *  listed as its own solutioncomponent row actually belongs to this solution — SolutionEditor.tsx
   *  uses this to decide whether the Columns panel should show the table's *entire* live field
   *  list (behavior 0/undefined — the old, always-on behavior) or just the ones with their own
   *  Attribute(2) row (Bugs/8.25.md #4: this tool used to always show every field a table has,
   *  standard OOB fields included, even for a solution that only actually added a handful). */
  rootComponentBehavior?: number;
  /** System Form(60) rows only — the form's owning table (from `systemform.objecttypecode`), so
   *  SolutionEditor.tsx can nest it under that table's tree node instead of an unrelated flat
   *  "System Form" group with no indication of which table it belongs to (Bugs/8.25.md #4,
   *  matching how make.powerapps nests a table's forms under the table itself). Undefined when the
   *  lookup failed (stale/orphaned row) — falls back to the flat top-level grouping so the row
   *  doesn't just disappear. */
  ownerEntityLogicalName?: string;
}

/** The basic column types this tool builds a plain AttributeMetadata body for via
 *  buildAttributeBody — v1's original 8, plus MultiSelectPicklist/BigInt added in v2. Lookup
 *  fields are NOT part of this union: they need a relationship (RelationshipDefinitions deep
 *  insert), not a plain Attributes POST, so they're a separate NewColumnDialog code path built on
 *  createLookupColumn/buildOneToManyRelationshipBody instead. Global-choice-backed Picklist
 *  columns also stay outside this union for the same reason (buildGlobalChoiceAttributeBody takes
 *  a GlobalOptionSet id, not an inline Options list) — "Picklist" here always means a *local*
 *  choice. */
export type BasicColumnType = "String" | "Memo" | "Integer" | "Decimal" | "Money" | "Boolean" | "DateTime" | "Picklist" | "MultiSelectPicklist" | "BigInt";

export const COLUMN_TYPE_LABELS: Record<BasicColumnType, string> = {
  String: "单行文本",
  Memo: "多行文本",
  Integer: "整数",
  Decimal: "小数",
  Money: "货币",
  Boolean: "是/否",
  DateTime: "日期时间",
  Picklist: "选项（本地）",
  MultiSelectPicklist: "选项（本地，多选）",
  BigInt: "长整数（BigInt）",
};

export interface ColumnFieldMeta {
  /** The attribute's own MetadataId — matched against an Attribute(2) solutioncomponent row's
   *  `objectid` to decide whether this field is actually part of the solution (see
   *  SolutionComponentRow.rootComponentBehavior and SolutionEditor.tsx's field-list filtering). */
  metadataId: string;
  logicalName: string;
  displayName: string;
  attributeType: string;
  isPrimaryName: boolean;
  isCustomAttribute: boolean;
  required: boolean;
}

/** The "Table properties" card make.powerapps shows on a table's own overview page — basic
 *  metadata only, deliberately not the field list (that's its own "Columns" page, see
 *  ColumnFieldMeta above and SolutionEditor.tsx's entity-columns view). */
export interface EntityBasicInfo {
  logicalName: string;
  displayName: string;
  displayCollectionName: string;
  description: string | null;
  primaryNameAttribute: string;
  ownershipType: string;
  isCustomEntity: boolean;
  entitySetName: string;
  modifiedOn: string | null;
}
