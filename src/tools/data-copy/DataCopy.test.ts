// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { replaceSelectColumns } from "./DataCopy";

describe("replaceSelectColumns", () => {
  it("replaces a bare * with the checked column list", () => {
    expect(replaceSelectColumns("SELECT * FROM account", ["name", "revenue"])).toBe("SELECT name, revenue FROM account");
  });

  it("replaces an explicit column list", () => {
    expect(replaceSelectColumns("SELECT name FROM account WHERE statecode = 0", ["name", "revenue"])).toBe(
      "SELECT name, revenue FROM account WHERE statecode = 0",
    );
  });

  it("preserves a TOP n clause", () => {
    expect(replaceSelectColumns("SELECT TOP 10 * FROM account", ["name"])).toBe("SELECT TOP 10 name FROM account");
  });

  it("preserves everything after FROM (WHERE/ORDER BY) untouched", () => {
    const sql = "SELECT * FROM account WHERE statecode = 0 ORDER BY name DESC";
    expect(replaceSelectColumns(sql, ["name", "revenue"])).toBe("SELECT name, revenue FROM account WHERE statecode = 0 ORDER BY name DESC");
  });

  it("matches SELECT/FROM case-insensitively", () => {
    expect(replaceSelectColumns("select * from account", ["name"])).toBe("select name from account");
  });

  it("no-ops (returns the input unchanged) when there are no checked columns", () => {
    const sql = "SELECT * FROM account";
    expect(replaceSelectColumns(sql, [])).toBe(sql);
  });

  it("no-ops on SQL that doesn't match the expected SELECT ... FROM ... shape", () => {
    const sql = "not valid sql at all";
    expect(replaceSelectColumns(sql, ["name"])).toBe(sql);
  });
});
