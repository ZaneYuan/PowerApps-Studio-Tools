import type { LabelValue } from "../metadata-browser/types";

export interface AttributeInfo {
  LogicalName: string;
  AttributeType: string;
  IsPrimaryId: boolean;
  DisplayName: LabelValue | null;
}

/** Only scalar column types are migratable in v1 — Lookup/Owner/Customer/PartyList are
 *  deliberately excluded (see AttributeInfo filtering in dataverseOps.ts): their values are
 *  GUIDs pointing at records in the *source* environment that almost certainly don't exist
 *  in the target, so copying them verbatim would just produce dangling references. */
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
