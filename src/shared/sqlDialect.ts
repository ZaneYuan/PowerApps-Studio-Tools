import { MSSQL, SQLDialect } from "@codemirror/lang-sql";

// lang-sql's MSSQL dialect lists LEFT/RIGHT as built-in functions (T-SQL's string functions), which
// overrides their keyword highlighting in LEFT/RIGHT JOIN.
export const TSQL = SQLDialect.define({
  ...MSSQL.spec,
  builtin: (MSSQL.spec.builtin ?? "")
    .split(" ")
    .filter((word) => word !== "left" && word !== "right")
    .join(" "),
});
