// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { replaceSelectColumns, valuesEqual } from "./DataEdit";

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

describe("valuesEqual — the dirty-row detection Data Edit's real 'skip unchanged rows' feature depends on", () => {
  it("identical primitive values are equal", () => {
    expect(valuesEqual("Alpha", "Alpha")).toBe(true);
    expect(valuesEqual(100, 100)).toBe(true);
    expect(valuesEqual(true, true)).toBe(true);
  });

  it("different primitive values are not equal", () => {
    expect(valuesEqual("Alpha", "Beta")).toBe(false);
    expect(valuesEqual(100, 200)).toBe(false);
    expect(valuesEqual(true, false)).toBe(false);
  });

  it("null and undefined are treated as equal to each other", () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual(undefined, null)).toBe(true);
  });

  it("null/undefined and an empty string are treated as equal — a click-in-click-out on a null cell must not look like a real edit", () => {
    expect(valuesEqual(null, "")).toBe(true);
    expect(valuesEqual("", null)).toBe(true);
    expect(valuesEqual(undefined, "")).toBe(true);
  });

  it("a real value is never equal to null/empty", () => {
    expect(valuesEqual("Alpha", null)).toBe(false);
    expect(valuesEqual(null, "Alpha")).toBe(false);
    expect(valuesEqual(0, null)).toBe(false); // 0 is a real, meaningful value — not "empty"
  });
});
