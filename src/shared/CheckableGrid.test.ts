import { describe, expect, it } from "vitest";
import { applyEditedLabel } from "./CheckableGrid";

describe("applyEditedLabel — keeps a Lookup cell's displayed name in sync with what onEditCell just wrote into values (Bugs/8.24.md #2 feedback)", () => {
  it("sets the label for the edited column when one is given (a lookup picked via the search modal)", () => {
    expect(applyEditedLabel(undefined, "parentaccountid", "Contoso Ltd")).toEqual({ parentaccountid: "Contoso Ltd" });
  });

  it("adds the new label alongside any other column's existing formattedValues, untouched", () => {
    expect(applyEditedLabel({ statuscode: "Active" }, "parentaccountid", "Contoso Ltd")).toEqual({
      statuscode: "Active",
      parentaccountid: "Contoso Ltd",
    });
  });

  it("overwrites a stale label for the same column with the freshly picked one", () => {
    expect(applyEditedLabel({ parentaccountid: "Old Parent" }, "parentaccountid", "New Parent")).toEqual({
      parentaccountid: "New Parent",
    });
  });

  it("clears the column's existing label when no label is given — typing/pasting a raw value directly has no resolved name to show, and the old one no longer matches", () => {
    expect(applyEditedLabel({ parentaccountid: "Contoso Ltd" }, "parentaccountid", undefined)).toEqual({});
  });

  it("clearing one column's label leaves every other column's formattedValues untouched", () => {
    expect(applyEditedLabel({ parentaccountid: "Contoso Ltd", statuscode: "Active" }, "parentaccountid", undefined)).toEqual({
      statuscode: "Active",
    });
  });

  it("no-ops cleanly when there was never any formattedValues and no label is given either", () => {
    expect(applyEditedLabel(undefined, "parentaccountid", undefined)).toEqual({});
  });
});
