import { describe, expect, it } from "vitest";
import { isSystemAuditField, sortColumnsForDisplay } from "./metadataService";

describe("isSystemAuditField", () => {
  it("recognizes the standard audit/framework columns", () => {
    for (const f of ["createdon", "createdby", "modifiedon", "modifiedby", "ownerid", "statecode", "statuscode", "versionnumber"]) {
      expect(isSystemAuditField(f)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isSystemAuditField("CreatedOn")).toBe(true);
  });

  it("does not flag an ordinary business column, even a well-known one like account.name", () => {
    expect(isSystemAuditField("name")).toBe(false);
    expect(isSystemAuditField("contoso_customfield")).toBe(false);
  });
});

describe("sortColumnsForDisplay", () => {
  it("puts the primary key first even if the default view doesn't mention it", () => {
    const result = sortColumnsForDisplay(["name", "contoso_thingid", "createdon"], "contoso_thingid", ["name"]);
    expect(result[0]).toBe("contoso_thingid");
  });

  it("orders default-view columns next, in the view's own order", () => {
    const result = sortColumnsForDisplay(["createdon", "contoso_thingid", "statuscode", "name"], "contoso_thingid", ["statuscode", "name"]);
    expect(result).toEqual(["contoso_thingid", "statuscode", "name", "createdon"]);
  });

  it("falls back to alphabetical order for columns not on the default view", () => {
    const result = sortColumnsForDisplay(["zeta", "contoso_thingid", "alpha"], "contoso_thingid", []);
    expect(result).toEqual(["contoso_thingid", "alpha", "zeta"]);
  });

  it("matches case-insensitively but preserves the caller's original casing in the output", () => {
    const result = sortColumnsForDisplay(["Contoso_ThingId", "Name"], "contoso_thingid", ["name"]);
    expect(result).toEqual(["Contoso_ThingId", "Name"]);
  });

  it("handles a primary key that isn't in the column list at all (no crash, just skipped)", () => {
    const result = sortColumnsForDisplay(["name", "createdon"], "contoso_thingid", ["name"]);
    expect(result).toEqual(["name", "createdon"]);
  });

  it("a default-view name that doesn't exist in the column list is silently ignored", () => {
    const result = sortColumnsForDisplay(["name"], "contoso_thingid", ["nonexistent", "name"]);
    expect(result).toEqual(["name"]);
  });
});
