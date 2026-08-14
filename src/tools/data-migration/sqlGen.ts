// Numeric Dataverse attribute types whose value should render as a bare (unquoted) SQL literal.
// Boolean gets its own branch (renders as bare 0/1, but isn't a "number" type). Everything else —
// String/Memo/Uniqueidentifier (including Lookup GUIDs, already unwrapped to a plain id string by
// dataverseOps.ts's queryRows)/DateTime/EntityName, and anything not found in the map — defaults
// to a quoted string literal, which is always a safe choice (an unquoted GUID or ISO date string
// would parse as a SQL identifier/expression, not a literal).
const NUMERIC_ATTRIBUTE_TYPES = new Set(["Integer", "BigInt", "Decimal", "Double", "Money", "Picklist", "State", "Status"]);

/** Renders one cell value as a T-SQL literal that SQL4CDS's own parser (translate.ts's
 *  literalToJsValue) will read back as the same value — same literal conventions this app
 *  already uses elsewhere: bare 0/1 for Boolean (T-SQL has no boolean literal), `N'...'` for
 *  strings (matches what a user typing CJK data into SQL4CDS by hand already has to write — see
 *  translate.ts's isStringLiteral, which treats var_string the same as a plain quoted string). */
function formatSqlLiteral(value: unknown, attributeType: string | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (attributeType === "Boolean") return value ? "1" : "0";
  if (attributeType && NUMERIC_ATTRIBUTE_TYPES.has(attributeType)) return String(value);
  return `N'${String(value).replace(/'/g, "''")}'`;
}

/** Builds one multi-row `INSERT INTO ... VALUES (...), (...);` statement — the exact shape
 *  SQL4CDS's INSERT parser expects (one array of literal tuples per statement) — from queried
 *  Data Migration rows, so a filtered/selected result set can be copied straight into SQL4CDS
 *  and run against any connection, not just imported directly through this tool's own API path. */
export function buildInsertSql(
  entityLogicalName: string,
  columns: string[],
  attributeTypeByLogicalName: Map<string, string>,
  rows: Record<string, unknown>[],
): string {
  const valueTuples = rows.map((row) => {
    const values = columns.map((col) => formatSqlLiteral(row[col], attributeTypeByLogicalName.get(col.toLowerCase())));
    return `  (${values.join(", ")})`;
  });
  return `INSERT INTO ${entityLogicalName} (${columns.join(", ")}) VALUES\n${valueTuples.join(",\n")};`;
}
