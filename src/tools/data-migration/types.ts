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

// --- Visual $filter / $orderby builder (source-query side only — no link-entity/relation
// support, since this tool only ever queries one table). Mirrors the OData query shape FetchXML
// → OData already documents (`$select`/`$filter`/`$orderby`), scoped down to what a single-table
// source query needs. ---

export type LogicOp = "and" | "or";

export type Operator =
  | "eq"
  | "ne"
  | "gt"
  | "ge"
  | "lt"
  | "le"
  | "contains"
  | "not-contains"
  | "startswith"
  | "endswith"
  | "isnull"
  | "isnotnull";

export type ValueType = "string" | "number" | "boolean" | "guid" | "date";

export interface Condition {
  id: string;
  field: string;
  operator: Operator;
  valueType: ValueType;
  value: string;
}

export interface ConditionGroup {
  id: string;
  logic: LogicOp;
  conditions: Condition[];
}

export interface OrderClause {
  id: string;
  field: string;
  descending: boolean;
}

export const FUNCTION_OPERATORS: Operator[] = ["contains", "not-contains", "startswith", "endswith"];

export const VALUELESS_OPERATORS: Operator[] = ["isnull", "isnotnull"];

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "等于 (eq)",
  ne: "不等于 (ne)",
  gt: "大于 (gt)",
  ge: "大于等于 (ge)",
  lt: "小于 (lt)",
  le: "小于等于 (le)",
  contains: "包含 (contains)",
  "not-contains": "不包含 (not contains)",
  startswith: "以…开头 (startswith)",
  endswith: "以…结尾 (endswith)",
  isnull: "为空 (is null)",
  isnotnull: "不为空 (is not null)",
};

export const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  string: "文本 String",
  number: "数字 Number",
  boolean: "布尔 Boolean",
  guid: "GUID / 查找列",
  date: "日期时间 DateTime",
};

export function newCondition(): Condition {
  return { id: crypto.randomUUID(), field: "", operator: "eq", valueType: "string", value: "" };
}

export function newConditionGroup(): ConditionGroup {
  return { id: crypto.randomUUID(), logic: "and", conditions: [newCondition()] };
}

export function newOrderClause(): OrderClause {
  return { id: crypto.randomUUID(), field: "", descending: false };
}
