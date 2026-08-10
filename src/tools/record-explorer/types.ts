export interface RecordSnapshot {
  entityLogicalName: string;
  id: string;
  primaryName: string;
  /** Raw field values only — no FormattedValue conversion, same as every other tool in this
   *  project. Lookup fields are keyed by their plain attribute logical name (not `_x_value`),
   *  the underscore/`_value` unwrapping happens once in dataverseOps.ts. */
  fields: Record<string, unknown>;
}

export interface ParentGroup {
  entityLogicalName: string;
  records: RecordSnapshot[];
}

/** A level-2 parent record plus a breadcrumb back to the level-1 record it was reached
 *  through — Level 1/2 are displayed as two flat, independently-filterable sections rather
 *  than a nested tree (avoids "keep an unmatched ancestor visible just to reach a matching
 *  descendant" complexity). */
export interface Level2Record {
  record: RecordSnapshot;
  via: { entityLogicalName: string; primaryName: string };
}

export interface ParentGroupLevel2 {
  entityLogicalName: string;
  items: Level2Record[];
}

export interface ChildGroup {
  entityLogicalName: string;
  relationshipSchemaName: string;
  rows: RecordSnapshot[];
  truncated: boolean;
}

export interface RecordGraph {
  current: RecordSnapshot;
  level1: ParentGroup[];
  level2: ParentGroupLevel2[];
  children: ChildGroup[];
}

/** Lookup attributes never worth following "up" — pure record-administration lookups present
 *  on nearly every Dataverse entity. Custom lookups are never filtered by this list regardless
 *  of name. */
export const ADMIN_LOOKUP_BLACKLIST = new Set([
  "ownerid",
  "owninguser",
  "owningteam",
  "owningbusinessunit",
  "createdby",
  "modifiedby",
  "createdonbehalfby",
  "modifiedonbehalfby",
]);

/** Child (1:N) relationships never worth following "down" by exact ReferencingEntity name —
 *  Dataverse platform housekeeping tables present on nearly every entity. Concrete activity
 *  types are excluded in favor of the single unified `activitypointer` relationship so the
 *  same records don't show up under several tabs. Custom relationships are never filtered by
 *  this list. Grounded in a real query against contoso-datamaster's `quote` entity (56 relationships,
 *  9 custom, the rest almost entirely covered by this list) — edit here if a future entity/org
 *  needs adjustment. */
export const CHILD_ENTITY_BLACKLIST = new Set([
  "annotation",
  "asyncoperation",
  "bulkdeletefailure",
  "connection",
  "duplicaterecord",
  "mailboxtrackingfolder",
  "principalobjectattributeaccess",
  "principalobjectaccess",
  "processsession",
  "sharepointdocument",
  "sharepointdocumentlocation",
  "syncerror",
  "userentityinstancedata",
  "activityparty",
  "workflowlog",
  "postfollow",
  "ratingvalue",
  "slakpiinstance",
  "socialactivity",
  "chat",
  "playbookinstance",
  "recurringappointmentmaster",
  "email",
  "phonecall",
  "task",
  "appointment",
  "fax",
  "letter",
  "serviceappointment",
]);

/** Prefix-based platform noise — bundled first-party solutions (Forms Pro, LinkedIn Sales
 *  Navigator, Power Pages/portals, Omnichannel) that relate to nearly every entity. */
export const CHILD_ENTITY_PREFIX_BLACKLIST = ["msfp_", "li_", "adx_", "mspp_", "msdyn_oc"];

/** Fields excluded from fuzzy-match text scanning only (still displayed, still followed if a
 *  lookup) — low-signal audit metadata that would otherwise dominate false-positive matches. */
export const FIELD_MATCH_BLACKLIST = new Set([
  "createdon",
  "modifiedon",
  "overriddencreatedon",
  "versionnumber",
  "timezoneruleversionnumber",
  "importsequencenumber",
  "utcconversiontimezonecode",
  ...ADMIN_LOOKUP_BLACKLIST,
]);

export function isChildRelationshipRelevant(referencingEntity: string, isCustomRelationship: boolean): boolean {
  if (isCustomRelationship) return true;
  const name = referencingEntity.toLowerCase();
  if (CHILD_ENTITY_BLACKLIST.has(name)) return false;
  return !CHILD_ENTITY_PREFIX_BLACKLIST.some((prefix) => name.startsWith(prefix));
}

/** Parses a pasted Dynamics 365 record URL's `etn`/`id` query params. Returns null for anything
 *  that isn't a recognizable record URL (e.g. a bare GUID) — callers fall back to the manually
 *  entered entity name field in that case. */
export function parseRecordUrl(input: string): { entityLogicalName: string; id: string } | null {
  const etnMatch = input.match(/[?&]etn=([a-zA-Z_][a-zA-Z0-9_]*)/);
  const idMatch = input.match(/[?&]id=(\{?[0-9a-fA-F-]{36}\}?)/) ?? input.match(/([0-9a-fA-F-]{36})/);
  if (!etnMatch || !idMatch) return null;
  return { entityLogicalName: etnMatch[1], id: idMatch[1].replace(/[{}]/g, "") };
}

const GUID_RE = /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/;

export function extractGuid(input: string): string | null {
  const trimmed = input.trim();
  if (GUID_RE.test(trimmed)) return trimmed.replace(/[{}]/g, "");
  const match = trimmed.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  return match ? match[1] : null;
}
