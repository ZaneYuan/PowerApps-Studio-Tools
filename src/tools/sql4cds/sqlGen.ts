/** Renders one cell value as a T-SQL literal that this app's own INSERT parser
 *  (translate.ts's literalToJsValue) reads back as the exact same value — by the time a value
 *  reaches a grid row, Dataverse's Web API has already returned it JSON-typed (a real number for
 *  Integer/Money/Picklist, a real boolean, a real string for everything else including GUIDs), so
 *  `typeof` alone is enough to pick the right literal shape without a separate attribute-type
 *  lookup. `N'...'` (not a bare `'...'`) matches this tool's own INSERT samples and round-trips
 *  CJK text the same way node-sql-parser's `var_string` type already does. */
function formatSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `N'${String(value).replace(/'/g, "''")}'`;
}

/** Builds one multi-row `INSERT INTO ... VALUES (...), (...);` statement from already-fetched
 *  grid data — `columns`/`rows` are exactly whatever the caller currently has checked, so
 *  unchecking the primary key (or any other column) before generating just omits it, same as the
 *  checkboxes already control what gets written when the grid's own "create"/"import" runs. */
export function buildInsertSql(entityLogicalName: string, columns: string[], rows: Record<string, unknown>[]): string {
  const valueTuples = rows.map((row) => `  (${columns.map((c) => formatSqlLiteral(row[c])).join(", ")})`);
  return `INSERT INTO ${entityLogicalName} (${columns.join(", ")}) VALUES\n${valueTuples.join(",\n")};`;
}

/** Matches this app's other tool-prefixed download filenames (sql4CdsLogFilename,
 *  dataMigrationLogFilename) so a folder of these downloads sorts/greps the same way. */
export function insertSqlFilename(toolPrefix: string, entityLogicalName: string, generatedAt: Date): string {
  const ts = generatedAt.toISOString().replace(/[:.]/g, "-");
  return `${toolPrefix}-insert-${entityLogicalName}-${ts}.sql`;
}
