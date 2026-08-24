import { describe, expect, it } from "vitest";
import { isRowDirty, valuesEqual } from "./dirtyTracking";
import type { GridRow } from "./CheckableGrid";

describe("valuesEqual — the dirty-row detection Data Edit's real 'skip unchanged rows' feature (and every grid's modified-field marker) depends on", () => {
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

function row(values: Record<string, unknown>, originalValues?: Record<string, unknown>): GridRow {
  return { id: "r1", checked: false, values, originalValues };
}

describe("isRowDirty", () => {
  it("a row with no originalValues baseline is never dirty (read-only grids never set one)", () => {
    expect(isRowDirty(row({ name: "Alpha" }))).toBe(false);
  });

  it("identical values vs. baseline is not dirty", () => {
    expect(isRowDirty(row({ name: "Alpha", score: 10 }, { name: "Alpha", score: 10 }))).toBe(false);
  });

  it("a single changed field makes the row dirty", () => {
    expect(isRowDirty(row({ name: "Beta", score: 10 }, { name: "Alpha", score: 10 }))).toBe(true);
  });

  it("null/empty-string click-in-click-out against the baseline is not dirty (uses valuesEqual)", () => {
    expect(isRowDirty(row({ name: "" }, { name: null }))).toBe(false);
  });

  it("editing a field back to its original value makes the row clean again", () => {
    expect(isRowDirty(row({ name: "Alpha" }, { name: "Alpha" }))).toBe(false);
  });
});
