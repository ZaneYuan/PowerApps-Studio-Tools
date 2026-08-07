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

export const FUNCTION_OPERATORS: Operator[] = [
  "contains",
  "not-contains",
  "startswith",
  "endswith",
];

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
