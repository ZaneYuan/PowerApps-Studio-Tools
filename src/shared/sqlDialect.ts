import { MSSQL, SQLDialect, type SQLDialectSpec } from "@codemirror/lang-sql";

// lang-sql's MSSQL dialect lists LEFT/RIGHT as built-in functions (T-SQL's string functions), which
// overrides their keyword highlighting in LEFT/RIGHT JOIN.
const TSQL_SPEC: SQLDialectSpec = {
  ...MSSQL.spec,
  builtin: (MSSQL.spec.builtin ?? "")
    .split(" ")
    .filter((word) => word !== "left" && word !== "right")
    .join(" "),
};

export const TSQL = SQLDialect.define(TSQL_SPEC);

const dialectCache = new Map<string, SQLDialect>();

/** TSQL minus every keyword/built-in/type word that is also one of `tables`. lang-sql only
 *  recognizes `table alias` in FROM/JOIN when the table name tokenizes as an identifier, so a
 *  Dataverse table sharing its name with a T-SQL word (`product` is a built-in function, `role` a
 *  keyword) left its alias with no column completion (Requirements/9.23 #4). */
export function tsqlForTables(tables: string[]): SQLDialect {
  const names = new Set(tables.map((t) => t.toLowerCase()));
  const without = (words: string | undefined) => (words ?? "").split(" ").filter((w) => !names.has(w.toLowerCase())).join(" ");
  const spec: SQLDialectSpec = { ...TSQL_SPEC, keywords: without(TSQL_SPEC.keywords), builtin: without(TSQL_SPEC.builtin), types: without(TSQL_SPEC.types) };
  const key = `${spec.keywords}|${spec.builtin}|${spec.types}`;
  let dialect = dialectCache.get(key);
  if (!dialect) {
    dialect = SQLDialect.define(spec);
    dialectCache.set(key, dialect);
  }
  return dialect;
}
