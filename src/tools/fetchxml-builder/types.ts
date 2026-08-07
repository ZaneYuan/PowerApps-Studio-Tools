export type ConditionOperator =
  | "eq"
  | "ne"
  | "gt"
  | "ge"
  | "lt"
  | "le"
  | "like"
  | "not-like"
  | "null"
  | "not-null"
  | "in"
  | "not-in";

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "等于 (eq)",
  ne: "不等于 (ne)",
  gt: "大于 (gt)",
  ge: "大于等于 (ge)",
  lt: "小于 (lt)",
  le: "小于等于 (le)",
  like: "模糊匹配 (like，值里自己写 %)",
  "not-like": "不匹配 (not-like)",
  null: "为空 (null)",
  "not-null": "不为空 (not-null)",
  in: "属于列表 (in，逗号分隔多个值)",
  "not-in": "不属于列表 (not-in，逗号分隔多个值)",
};

export const VALUELESS_OPERATORS: ConditionOperator[] = ["null", "not-null"];
export const MULTI_VALUE_OPERATORS: ConditionOperator[] = ["in", "not-in"];

export type FilterType = "and" | "or";
export type LinkType = "inner" | "outer";

export interface Condition {
  id: string;
  attribute: string;
  operator: ConditionOperator;
  /** Raw text. For in/not-in this is a comma-separated list. */
  value: string;
}

export interface FilterGroup {
  id: string;
  type: FilterType;
  conditions: Condition[];
  groups: FilterGroup[];
}

export interface OrderClause {
  id: string;
  attribute: string;
  descending: boolean;
}

export interface LinkEntity {
  id: string;
  name: string;
  from: string;
  to: string;
  alias: string;
  linkType: LinkType;
  /** Comma-separated attribute list; empty means no <attribute> elements are emitted. */
  attributes: string;
  filter: FilterGroup;
  links: LinkEntity[];
}

export interface FetchXmlQuery {
  entityName: string;
  attributes: string;
  allAttributes: boolean;
  distinct: boolean;
  top: string;
  orders: OrderClause[];
  filter: FilterGroup;
  links: LinkEntity[];
}

export function newCondition(): Condition {
  return { id: crypto.randomUUID(), attribute: "", operator: "eq", value: "" };
}

export function newFilterGroup(type: FilterType = "and"): FilterGroup {
  return { id: crypto.randomUUID(), type, conditions: [], groups: [] };
}

export function newOrderClause(): OrderClause {
  return { id: crypto.randomUUID(), attribute: "", descending: false };
}

export function newLinkEntity(): LinkEntity {
  return {
    id: crypto.randomUUID(),
    name: "",
    from: "",
    to: "",
    alias: "",
    linkType: "inner",
    attributes: "",
    filter: newFilterGroup(),
    links: [],
  };
}

export function newQuery(): FetchXmlQuery {
  return {
    entityName: "",
    attributes: "",
    allAttributes: false,
    distinct: false,
    top: "",
    orders: [],
    filter: newFilterGroup(),
    links: [],
  };
}
