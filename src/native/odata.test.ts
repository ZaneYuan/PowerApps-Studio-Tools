import { describe, expect, it } from "vitest";
import { escapeODataString, mergeRowColumnKeys, unwrapODataRow, unwrapODataRowWithFormatting } from "./odata";

describe("mergeRowColumnKeys", () => {
  it("unions keys across every row, not just the first (Dataverse omits null attributes per row)", () => {
    const rows = [
      { id: "1", name: "A", reimbursementid: "r1" },
      { id: "2", name: "B", deductibleid: "d1" },
      { id: "3", name: "C", lumpsumid: "l1" },
    ];
    expect(mergeRowColumnKeys([], rows)).toEqual(["id", "name", "reimbursementid", "deductibleid", "lumpsumid"]);
  });

  it("puts the seed columns first, in order, then the rest of the discovered keys", () => {
    const rows = [{ name: "A", extra: 1 }];
    expect(mergeRowColumnKeys(["id", "name", "deductibleid"], rows)).toEqual(["id", "name", "deductibleid", "extra"]);
  });

  it("keeps a selected column that's null on every returned row (only reachable via the seed)", () => {
    const rows = [{ name: "A" }, { name: "B" }];
    expect(mergeRowColumnKeys(["name", "deductibleid"], rows)).toEqual(["name", "deductibleid"]);
  });

  it("returns the seed unchanged when there are no rows", () => {
    expect(mergeRowColumnKeys(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("de-duplicates a key that appears in both the seed and the rows", () => {
    expect(mergeRowColumnKeys(["name"], [{ name: "A" }])).toEqual(["name"]);
  });
});

describe("escapeODataString", () => {
  it("doubles a single quote", () => {
    expect(escapeODataString("O'Brien")).toBe("O''Brien");
  });

  it("leaves a string with no quotes untouched", () => {
    expect(escapeODataString("Alpha")).toBe("Alpha");
  });
});

describe("unwrapODataRow", () => {
  it("strips a Lookup's _..._value prefix/suffix down to the plain attribute name", () => {
    expect(unwrapODataRow({ _parentaccountid_value: "guid-1" })).toEqual({ parentaccountid: "guid-1" });
  });

  it("drops every @-annotation key entirely", () => {
    expect(
      unwrapODataRow({
        name: "Contoso",
        "_parentaccountid_value@OData.Community.Display.V1.FormattedValue": "Parent Co",
        "_parentaccountid_value@Microsoft.Dynamics.CRM.lookuplogicalname": "account",
      }),
    ).toEqual({ name: "Contoso" });
  });

  it("leaves a plain (non-lookup) field name untouched", () => {
    expect(unwrapODataRow({ name: "Contoso", revenue: 100 })).toEqual({ name: "Contoso", revenue: 100 });
  });
});

describe("unwrapODataRowWithFormatting", () => {
  it("splits a Lookup's raw GUID and its FormattedValue label into fields vs. formattedFields", () => {
    const result = unwrapODataRowWithFormatting({
      name: "Contoso",
      _parentaccountid_value: "guid-1",
      "_parentaccountid_value@OData.Community.Display.V1.FormattedValue": "Parent Co",
      "_parentaccountid_value@Microsoft.Dynamics.CRM.lookuplogicalname": "account",
    });
    expect(result.fields).toEqual({ name: "Contoso", parentaccountid: "guid-1" });
    expect(result.formattedFields).toEqual({ parentaccountid: "Parent Co" });
  });

  it("resolves an OptionSet's numeric code alongside its FormattedValue label", () => {
    const result = unwrapODataRowWithFormatting({
      statuscode: 1,
      "statuscode@OData.Community.Display.V1.FormattedValue": "Active",
    });
    expect(result.fields).toEqual({ statuscode: 1 });
    expect(result.formattedFields).toEqual({ statuscode: "Active" });
  });

  it("a field with no annotation at all just has nothing in formattedFields", () => {
    const result = unwrapODataRowWithFormatting({ name: "Contoso" });
    expect(result.fields).toEqual({ name: "Contoso" });
    expect(result.formattedFields).toEqual({});
  });

  it("ignores a non-FormattedValue annotation (e.g. lookuplogicalname) — only the display label is kept", () => {
    const result = unwrapODataRowWithFormatting({
      _ownerid_value: "guid-2",
      "_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname": "systemuser",
    });
    expect(result.fields).toEqual({ ownerid: "guid-2" });
    expect(result.formattedFields).toEqual({});
  });

  it("unwrapODataRow(row) matches unwrapODataRowWithFormatting(row).fields", () => {
    const row = {
      name: "Contoso",
      _parentaccountid_value: "guid-1",
      "_parentaccountid_value@OData.Community.Display.V1.FormattedValue": "Parent Co",
    };
    expect(unwrapODataRow(row)).toEqual(unwrapODataRowWithFormatting(row).fields);
  });
});
