import {
  FUNCTION_OPERATORS,
  VALUELESS_OPERATORS,
  type Condition,
  type ConditionGroup,
  type LogicOp,
  type OrderClause,
  type ValueType,
} from "./types";

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ConditionWarning {
  conditionId: string;
  message: string;
}

/** Formats a raw input value into an OData v4 literal for the given type.
 *  Dataverse Web API (OData v4) does NOT quote GUIDs or dates — only strings are quoted. */
function formatLiteral(valueType: ValueType, raw: string): string {
  const value = raw.trim();
  switch (valueType) {
    case "string":
      return `'${value.replace(/'/g, "''")}'`;
    case "number":
      return value;
    case "boolean":
      return value === "true" ? "true" : "false";
    case "guid":
      return value;
    case "date":
      // <input type="datetime-local"> yields "YYYY-MM-DDTHH:mm" with no seconds/timezone.
      return value.length === 16 ? `${value}:00Z` : value;
  }
}

function renderCondition(c: Condition): string | null {
  if (!c.field.trim()) return null;

  if (VALUELESS_OPERATORS.includes(c.operator)) {
    return c.operator === "isnull" ? `${c.field} eq null` : `${c.field} ne null`;
  }

  if (!c.value.trim()) return null;

  if (FUNCTION_OPERATORS.includes(c.operator)) {
    const lit = formatLiteral("string", c.value);
    if (c.operator === "not-contains") return `not contains(${c.field},${lit})`;
    return `${c.operator}(${c.field},${lit})`;
  }

  const lit = formatLiteral(c.valueType, c.value);
  return `${c.field} ${c.operator} ${lit}`;
}

function renderGroup(group: ConditionGroup): string | null {
  const parts = group.conditions.map(renderCondition).filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const joined = parts.join(group.logic === "and" ? " and " : " or ");
  return parts.length > 1 ? `(${joined})` : joined;
}

export function buildFilter(groups: ConditionGroup[], topLogic: LogicOp): string {
  const parts = groups.map(renderGroup).filter((p): p is string => p !== null);
  if (parts.length === 0) return "";
  return parts.join(topLogic === "and" ? " and " : " or ");
}

export function buildOrderBy(orders: OrderClause[]): string {
  return orders
    .filter((o) => o.field.trim())
    .map((o) => (o.descending ? `${o.field.trim()} desc` : o.field.trim()))
    .join(",");
}

export function validateConditions(groups: ConditionGroup[]): ConditionWarning[] {
  const warnings: ConditionWarning[] = [];
  for (const group of groups) {
    for (const c of group.conditions) {
      if (!c.field.trim()) continue;
      if (c.valueType === "guid" && c.value.trim() && !GUID_RE.test(c.value.trim())) {
        warnings.push({ conditionId: c.id, message: `"${c.field}" 的值不是有效的 GUID 格式` });
      }
      if (c.valueType === "number" && c.value.trim() && Number.isNaN(Number(c.value.trim()))) {
        warnings.push({ conditionId: c.id, message: `"${c.field}" 的值不是有效数字` });
      }
    }
  }
  return warnings;
}
