import { describe, expect, it } from "vitest";
import { buildInsertSql, insertSqlFilename } from "./sqlGen";
import { parseSql, literalToJsValue } from "./translate";

describe("buildInsertSql", () => {
  it("formats numbers bare, strings as N'...', booleans as 1/0, null as NULL", () => {
    const sql = buildInsertSql("contoso_thing", ["name", "amount", "active", "note"], [
      { name: "Acme", amount: 12699, active: true, note: null },
    ]);
    expect(sql).toBe("INSERT INTO contoso_thing (name, amount, active, note) VALUES\n  (N'Acme', 12699, 1, NULL);");
  });

  it("escapes an embedded single quote by doubling it", () => {
    const sql = buildInsertSql("contact", ["lastname"], [{ lastname: "O'Brien" }]);
    expect(sql).toContain("N'O''Brien'");
  });

  it("joins multiple rows with a comma and a trailing semicolon on the last one", () => {
    const sql = buildInsertSql("contoso_thing", ["name"], [{ name: "A" }, { name: "B" }]);
    expect(sql).toBe("INSERT INTO contoso_thing (name) VALUES\n  (N'A'),\n  (N'B');");
  });

  it("round-trips string/number/null through this app's own INSERT parser unchanged", () => {
    const original = { name: "Zoë O'Brien", amount: 12699.5, flag: null };
    const sql = buildInsertSql("contoso_thing", ["name", "amount", "flag"], [original]);
    const parsed = parseSql(sql);
    if (parsed.kind !== "insert") throw new Error(`expected insert, got ${parsed.kind}`);
    const row = parsed.rows[0];
    expect(literalToJsValue(row[0])).toBe(original.name);
    expect(literalToJsValue(row[1])).toBe(original.amount);
    expect(literalToJsValue(row[2])).toBeNull();
  });

  it("a boolean round-trips as a bare 0/1 *number*, not a JS boolean — literalToJsValue is deliberately type-agnostic; " +
    "the Boolean-specific 0/1->true/false coercion happens one layer up in writeOps.ts, which has real attribute-type " +
    "metadata to know a given column is actually a Boolean (see writeOps.ts's own Boolean-coercion comment)", () => {
    const sql = buildInsertSql("contoso_thing", ["active"], [{ active: false }]);
    const parsed = parseSql(sql);
    if (parsed.kind !== "insert") throw new Error(`expected insert, got ${parsed.kind}`);
    expect(literalToJsValue(parsed.rows[0][0])).toBe(0);
  });
});

describe("insertSqlFilename", () => {
  it("produces a sortable, filesystem-safe filename with no colons/dots in the timestamp portion", () => {
    const name = insertSqlFilename("sql4cds", "contoso_thing", new Date("2026-08-22T09:30:00.000Z"));
    expect(name).toBe("sql4cds-insert-contoso_thing-2026-08-22T09-30-00-000Z.sql");
    const withoutExtension = name.replace(/\.sql$/, "");
    expect(withoutExtension).not.toMatch(/[:.]/); // Windows filenames can't contain ':'
  });
});
