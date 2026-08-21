import { isLookupAttributeType, isOptionSetAttributeType } from "../native/metadataService";
import type { GridColumn } from "./CheckableGrid";

/** Normalizes a raw Dataverse `AttributeType` string (see metadataService.ts) down to the handful
 *  of shapes CheckableGrid's sort/filter UI actually needs to distinguish. Unrecognized/missing
 *  types fall back to "string" — the original plain-text behavior, so a column with no
 *  `attributeType` set (columns predate this field on some call sites) still sorts/filters, just
 *  without the type-specific niceties. */
export type ColumnKind = "string" | "number" | "date" | "boolean" | "optionset" | "lookup";

const NUMBER_ATTRIBUTE_TYPES = new Set(["Integer", "BigInt", "Decimal", "Double", "Money"]);

export function classifyColumnKind(attributeType: string | undefined): ColumnKind {
  if (!attributeType) return "string";
  if (isLookupAttributeType(attributeType)) return "lookup";
  if (isOptionSetAttributeType(attributeType)) return "optionset";
  if (attributeType === "DateTime") return "date";
  if (attributeType === "Boolean") return "boolean";
  if (NUMBER_ATTRIBUTE_TYPES.has(attributeType)) return "number";
  return "string";
}

export function sortLabels(kind: ColumnKind): { asc: string; desc: string } {
  if (kind === "number") return { asc: "Smaller to larger", desc: "Larger to smaller" };
  if (kind === "date") return { asc: "Older to newer", desc: "Newer to older" };
  return { asc: "A to Z", desc: "Z to A" };
}

// ---------------------------------------------------------------------------------------------
// Filter operators
// ---------------------------------------------------------------------------------------------

export type FilterOperator =
  | "equals"
  | "not-equals"
  | "contains-data"
  | "not-contains-data"
  | "contains"
  | "not-contains"
  | "begins-with"
  | "not-begins-with"
  | "ends-with"
  | "not-ends-with"
  | "greater-than"
  | "greater-equal"
  | "less-than"
  | "less-equal"
  | "on"
  | "on-or-after"
  | "on-or-before"
  | "today"
  | "yesterday"
  | "tomorrow"
  | "this-week"
  | "this-month"
  | "this-year";

export interface FilterOperatorOption {
  value: FilterOperator;
  label: string;
  /** False for self-contained conditions (`contains data`, `today`, `this month`, ...) that need
   *  no value widget at all - the operator alone fully determines the match. */
  needsValue: boolean;
}

const STRING_OPERATORS: FilterOperatorOption[] = [
  { value: "equals", label: "Equals", needsValue: true },
  { value: "not-equals", label: "Does not equal", needsValue: true },
  { value: "contains-data", label: "Contains data", needsValue: false },
  { value: "not-contains-data", label: "Does not contain data", needsValue: false },
  { value: "contains", label: "Contains", needsValue: true },
  { value: "not-contains", label: "Does not contain", needsValue: true },
  { value: "begins-with", label: "Begins with", needsValue: true },
  { value: "not-begins-with", label: "Does not begin with", needsValue: true },
  { value: "ends-with", label: "Ends with", needsValue: true },
  { value: "not-ends-with", label: "Does not end with", needsValue: true },
];

const NUMBER_OPERATORS: FilterOperatorOption[] = [
  { value: "equals", label: "Equals", needsValue: true },
  { value: "not-equals", label: "Does not equal", needsValue: true },
  { value: "contains-data", label: "Contains data", needsValue: false },
  { value: "not-contains-data", label: "Does not contain data", needsValue: false },
  { value: "greater-than", label: "Greater than", needsValue: true },
  { value: "greater-equal", label: "Greater than or equal to", needsValue: true },
  { value: "less-than", label: "Less than", needsValue: true },
  { value: "less-equal", label: "Less than or equal to", needsValue: true },
];

// Dataverse's own quick-filter also has "This fiscal period"/"This fiscal year" etc, deliberately
// left out here - those depend on the org's FiscalYearSettings (start month, annual/semiannual/
// quarterly/monthly periods), which nothing in this app fetches today. Faking it as "this month"
// would silently give wrong answers for anyone whose fiscal year doesn't start in January; leaving
// it out is more honest than a guess dressed up as a real feature.
const DATE_OPERATORS: FilterOperatorOption[] = [
  { value: "on", label: "On", needsValue: true },
  { value: "on-or-after", label: "On or after", needsValue: true },
  { value: "on-or-before", label: "On or before", needsValue: true },
  { value: "today", label: "Today", needsValue: false },
  { value: "yesterday", label: "Yesterday", needsValue: false },
  { value: "tomorrow", label: "Tomorrow", needsValue: false },
  { value: "this-week", label: "This week", needsValue: false },
  { value: "this-month", label: "This month", needsValue: false },
  { value: "this-year", label: "This year", needsValue: false },
];

// OptionSet/Lookup/Boolean columns only ever showed an "Equals"-style condition box in the
// reference screenshots (the value widget itself is what changes - checkboxes/search/select) -
// there's no evidence of a fuller operator list for these like the text/number ones above, so
// this stays deliberately minimal rather than inventing conditions never seen in practice.
const CHOICE_OPERATORS: FilterOperatorOption[] = [
  { value: "equals", label: "Equals", needsValue: true },
  { value: "not-equals", label: "Does not equal", needsValue: true },
];

export function operatorsForKind(kind: ColumnKind): FilterOperatorOption[] {
  switch (kind) {
    case "number":
      return NUMBER_OPERATORS;
    case "date":
      return DATE_OPERATORS;
    case "optionset":
    case "lookup":
    case "boolean":
      return CHOICE_OPERATORS;
    default:
      return STRING_OPERATORS;
  }
}

// ---------------------------------------------------------------------------------------------
// Filter value + matching
// ---------------------------------------------------------------------------------------------

export interface GridColumnFilter {
  operator: FilterOperator;
  /** Single value: text/number as typed, a date-input's "YYYY-MM-DD", or a picked Lookup's raw
   *  GUID / a picked Boolean's "true"/"false". Unused for OptionSet (see `values` instead) and
   *  for operators with `needsValue: false`. */
  value?: string;
  /** OptionSet only: the raw (numeric, stringified) option values checked in the multi-select
   *  list - "equals" matches any of them (an OR set), same as Dataverse's own choice-column
   *  filter. */
  values?: string[];
  /** Display-only label for whatever `value` resolved to (a picked Lookup record's primary
   *  name) - never used for matching, only so the popover can show something readable instead of
   *  a raw GUID when reopened. */
  label?: string;
}

/** Parses a `<input type="date">` value ("YYYY-MM-DD") as a LOCAL calendar date. `new
 *  Date("YYYY-MM-DD")` parses as UTC midnight, which is off by a day in every timezone ahead of
 *  UTC (mainland China included) once compared against a row's local-time date - this avoids
 *  that trap by building the Date from its y/m/d components directly. */
function parseDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function parseRowDate(rawValue: unknown): Date | null {
  if (rawValue == null || rawValue === "") return null;
  const d = new Date(String(rawValue));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function matchesString(rawValue: unknown, filter: GridColumnFilter): boolean {
  const raw = rawValue == null ? "" : String(rawValue);
  if (filter.operator === "contains-data") return raw !== "";
  if (filter.operator === "not-contains-data") return raw === "";
  const rawLower = raw.toLowerCase();
  const valLower = (filter.value ?? "").toLowerCase();
  switch (filter.operator) {
    case "equals":
      return rawLower === valLower;
    case "not-equals":
      return rawLower !== valLower;
    case "contains":
      return rawLower.includes(valLower);
    case "not-contains":
      return !rawLower.includes(valLower);
    case "begins-with":
      return rawLower.startsWith(valLower);
    case "not-begins-with":
      return !rawLower.startsWith(valLower);
    case "ends-with":
      return rawLower.endsWith(valLower);
    case "not-ends-with":
      return !rawLower.endsWith(valLower);
    default:
      return false;
  }
}

function matchesNumber(rawValue: unknown, filter: GridColumnFilter): boolean {
  const hasValue = rawValue !== null && rawValue !== undefined && rawValue !== "";
  if (filter.operator === "contains-data") return hasValue;
  if (filter.operator === "not-contains-data") return !hasValue;
  if (!hasValue) return false;
  const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
  const filterNum = Number(filter.value);
  if (Number.isNaN(num) || Number.isNaN(filterNum)) return false;
  switch (filter.operator) {
    case "equals":
      return num === filterNum;
    case "not-equals":
      return num !== filterNum;
    case "greater-than":
      return num > filterNum;
    case "greater-equal":
      return num >= filterNum;
    case "less-than":
      return num < filterNum;
    case "less-equal":
      return num <= filterNum;
    default:
      return false;
  }
}

function matchesDate(rawValue: unknown, filter: GridColumnFilter): boolean {
  const rowDate = parseRowDate(rawValue);
  if (!rowDate) return false;
  const rowDay = startOfDay(rowDate);
  const today = startOfDay(new Date());

  switch (filter.operator) {
    case "on": {
      const target = filter.value ? parseDateInputValue(filter.value) : null;
      return target !== null && rowDay === startOfDay(target);
    }
    case "on-or-after": {
      const target = filter.value ? parseDateInputValue(filter.value) : null;
      return target !== null && rowDay >= startOfDay(target);
    }
    case "on-or-before": {
      const target = filter.value ? parseDateInputValue(filter.value) : null;
      return target !== null && rowDay <= startOfDay(target);
    }
    case "today":
      return rowDay === today;
    case "yesterday":
      return rowDay === today - 86400000;
    case "tomorrow":
      return rowDay === today + 86400000;
    case "this-week": {
      const now = new Date();
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()));
      return rowDay >= start && rowDay < start + 7 * 86400000;
    }
    case "this-month": {
      const now = new Date();
      return rowDate.getFullYear() === now.getFullYear() && rowDate.getMonth() === now.getMonth();
    }
    case "this-year":
      return rowDate.getFullYear() === new Date().getFullYear();
    default:
      return false;
  }
}

/** OptionSet: `filter.values` is an OR-set of raw (stringified) option values checked in the
 *  multi-select list. Lookup/Boolean: `filter.value` is the single raw GUID / "true"/"false" to
 *  compare against, case-insensitively (Dataverse GUIDs are consistently lowercase in practice,
 *  but this doesn't rely on that). */
function matchesChoice(rawValue: unknown, filter: GridColumnFilter, multi: boolean): boolean {
  const raw = rawValue == null ? "" : String(rawValue);
  const isMatch = multi ? (filter.values ?? []).includes(raw) : raw.toLowerCase() === (filter.value ?? "").toLowerCase();
  return filter.operator === "not-equals" ? !isMatch : isMatch;
}

export function matchesFilter(rawValue: unknown, kind: ColumnKind, filter: GridColumnFilter): boolean {
  switch (kind) {
    case "number":
      return matchesNumber(rawValue, filter);
    case "date":
      return matchesDate(rawValue, filter);
    case "optionset":
      return matchesChoice(rawValue, filter, true);
    case "lookup":
    case "boolean":
      return matchesChoice(rawValue, filter, false);
    default:
      return matchesString(rawValue, filter);
  }
}

// ---------------------------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------------------------

/** OptionSet columns store the raw (numeric) option value in `row.values`, same as everywhere
 *  else in this app - sorting by that number would order rows by whichever integer a publisher
 *  happened to assign an option, not by what the user actually reads. Resolves to the option's
 *  label text (via the column's own `options` list, already fetched for the "select" cell
 *  editor) so sort order matches what's on screen; every other kind sorts by its raw value
 *  as-is. */
export function sortValueFor(rawValue: unknown, column: GridColumn, kind: ColumnKind): unknown {
  if (kind === "optionset" && column.options) {
    const found = column.options.find((o) => o.value === String(rawValue));
    if (found) return found.label;
  }
  return rawValue;
}

export function compareForSort(a: unknown, b: unknown, kind: ColumnKind, direction: "asc" | "desc"): number {
  let result: number;
  if (kind === "number") {
    const an = a === null || a === undefined || a === "" ? null : Number(a);
    const bn = b === null || b === undefined || b === "" ? null : Number(b);
    result = an === null && bn === null ? 0 : an === null ? -1 : bn === null ? 1 : an - bn;
  } else if (kind === "date") {
    const ad = parseRowDate(a);
    const bd = parseRowDate(b);
    result = ad === null && bd === null ? 0 : ad === null ? -1 : bd === null ? 1 : ad.getTime() - bd.getTime();
  } else {
    const as = a === null || a === undefined ? "" : String(a);
    const bs = b === null || b === undefined ? "" : String(b);
    result = as.localeCompare(bs);
  }
  return direction === "asc" ? result : -result;
}
