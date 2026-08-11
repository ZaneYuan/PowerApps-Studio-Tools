import type { LabelValue } from "../metadata-browser/types";

export interface AttributeInfo {
  LogicalName: string;
  AttributeType: string;
  IsPrimaryId: boolean;
  DisplayName: LabelValue | null;
}

/** Plain scalar column types. Single-target Lookup is migratable too (added separately in
 *  dataverseOps.ts's filter — resolved against the *target* environment's own schema at import
 *  time, not copied as a raw GUID). Polymorphic reference types (Owner/Customer/PartyList) stay
 *  excluded — the write side can't tell which target entity a given GUID belongs to. */
export const SCALAR_ATTRIBUTE_TYPES = new Set([
  "String",
  "Memo",
  "Integer",
  "BigInt",
  "Decimal",
  "Double",
  "Money",
  "Boolean",
  "DateTime",
  "Picklist",
  "State",
  "Status",
  "Uniqueidentifier",
  "EntityName",
]);

export interface EntityMeta {
  entitySetName: string;
  primaryIdAttribute: string;
}

export type RowImportState = "pending" | "importing" | "success" | "error";

export interface RowImportStatus {
  state: RowImportState;
  error?: string;
}
