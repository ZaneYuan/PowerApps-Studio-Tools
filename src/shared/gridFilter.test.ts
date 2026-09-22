import { describe, expect, it } from "vitest";
import { matchesFilter } from "./gridFilter";

describe("matchesFilter — number columns", () => {
  const notEqualsOne = { operator: "not-equals" as const, value: "1" };

  it("treats a null cell as not equal to the filter value (Bugs/9.9 #1)", () => {
    expect(matchesFilter(null, "number", notEqualsOne)).toBe(true);
    expect(matchesFilter(undefined, "number", notEqualsOne)).toBe(true);
  });

  it("still excludes cells equal to the filter value and keeps other numbers", () => {
    expect(matchesFilter(1, "number", notEqualsOne)).toBe(false);
    expect(matchesFilter(2, "number", notEqualsOne)).toBe(true);
  });

  it("keeps null cells out of comparisons other than not-equals", () => {
    expect(matchesFilter(null, "number", { operator: "equals", value: "1" })).toBe(false);
    expect(matchesFilter(null, "number", { operator: "less-than", value: "5" })).toBe(false);
  });
});
