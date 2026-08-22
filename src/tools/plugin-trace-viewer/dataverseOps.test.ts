import { describe, expect, it } from "vitest";
import { buildFilterClauses } from "./dataverseOps";
import { DEFAULT_FILTERS } from "./types";

describe("buildFilterClauses — the OData $filter clause list fetchTraceLogs builds every query from", () => {
  it("empty filters (all defaults) produce no clauses at all", () => {
    expect(buildFilterClauses(DEFAULT_FILTERS)).toEqual([]);
  });

  it("typeName uses a trimmed contains() clause", () => {
    expect(buildFilterClauses({ ...DEFAULT_FILTERS, typeName: "  MyPlugin  " })).toEqual([
      "contains(typename,'MyPlugin')",
    ]);
  });

  it("messageName uses a trimmed contains() clause", () => {
    expect(buildFilterClauses({ ...DEFAULT_FILTERS, messageName: "Update" })).toEqual([
      "contains(messagename,'Update')",
    ]);
  });

  it("primaryEntity uses a trimmed contains() clause", () => {
    expect(buildFilterClauses({ ...DEFAULT_FILTERS, primaryEntity: "account" })).toEqual([
      "contains(primaryentity,'account')",
    ]);
  });

  it("a whitespace-only text filter is treated as empty — no clause emitted", () => {
    expect(buildFilterClauses({ ...DEFAULT_FILTERS, typeName: "   " })).toEqual([]);
  });

  it("onlyErrors emits the exact exceptiondetails ne null clause", () => {
    expect(buildFilterClauses({ ...DEFAULT_FILTERS, onlyErrors: true })).toEqual(["exceptiondetails ne null"]);
  });

  it("onlyErrors=false emits nothing", () => {
    expect(buildFilterClauses({ ...DEFAULT_FILTERS, onlyErrors: false })).toEqual([]);
  });

  it("from converts the local datetime-local value to a real ISO instant in a ge clause", () => {
    const clauses = buildFilterClauses({ ...DEFAULT_FILTERS, from: "2026-01-01T00:00" });
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatch(/^createdon ge \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("to converts the local datetime-local value to a real ISO instant in a le clause", () => {
    const clauses = buildFilterClauses({ ...DEFAULT_FILTERS, to: "2026-01-01T00:00" });
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatch(/^createdon le \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("every filter combined produces all clauses, in a fixed order, joined by the caller with 'and'", () => {
    const clauses = buildFilterClauses({
      typeName: "MyPlugin",
      messageName: "Create",
      primaryEntity: "contact",
      onlyErrors: true,
      from: "2026-01-01T00:00",
      to: "2026-01-02T00:00",
      top: 50,
    });
    expect(clauses).toEqual([
      "contains(typename,'MyPlugin')",
      "contains(messagename,'Create')",
      "contains(primaryentity,'contact')",
      "exceptiondetails ne null",
      expect.stringMatching(/^createdon ge /),
      expect.stringMatching(/^createdon le /),
    ]);
  });

  it("a single-quote in a text filter is escaped, not left to break the OData string literal", () => {
    const clauses = buildFilterClauses({ ...DEFAULT_FILTERS, typeName: "O'Brien.Plugin" });
    expect(clauses[0]).toBe("contains(typename,'O''Brien.Plugin')");
  });
});
