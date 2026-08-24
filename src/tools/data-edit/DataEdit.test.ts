// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { replaceSelectColumns } from "./DataEdit";

describe("replaceSelectColumns", () => {
  it("replaces a bare * with the checked column list", () => {
    expect(replaceSelectColumns("SELECT * FROM account", ["name", "revenue"])).toBe("SELECT name, revenue FROM account");
  });

  it("preserves a TOP n clause and everything after FROM", () => {
    expect(replaceSelectColumns("SELECT TOP 5 * FROM account WHERE statecode = 0", ["name"])).toBe(
      "SELECT TOP 5 name FROM account WHERE statecode = 0",
    );
  });

  it("no-ops when there are no checked columns", () => {
    const sql = "SELECT * FROM account";
    expect(replaceSelectColumns(sql, [])).toBe(sql);
  });
});
