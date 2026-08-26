import { describe, expect, it } from "vitest";
import { convertEditedCellValue } from "./gridColumns";
import type { GridColumn } from "./CheckableGrid";

describe("convertEditedCellValue — date", () => {
  it("a DateOnly field gets the bare YYYY-MM-DD literal (Edm.Date), not a full ISO datetime", () => {
    // Confirmed live (Bugs/8.25.md #3): a DateOnly field 400'd with "Cannot convert the literal
    // '2026-05-01T00:00:00.000Z' to the expected type 'Edm.Date'" when sent the ISO form.
    const column: GridColumn = { key: "bupa_effectivefrom", checked: true, editKind: "date", dateFormat: "DateOnly" };
    expect(convertEditedCellValue(column, "2026-05-01")).toBe("2026-05-01");
  });

  it("a DateAndTime field still gets a full UTC-midnight ISO string", () => {
    const column: GridColumn = { key: "createdon", checked: true, editKind: "date", dateFormat: "DateAndTime" };
    expect(convertEditedCellValue(column, "2026-05-01")).toBe("2026-05-01T00:00:00.000Z");
  });

  it("falls back to the ISO string when Format wasn't fetched (dateFormat undefined)", () => {
    const column: GridColumn = { key: "somedate", checked: true, editKind: "date" };
    expect(convertEditedCellValue(column, "2026-05-01")).toBe("2026-05-01T00:00:00.000Z");
  });

  it("an empty date value is always null, regardless of dateFormat", () => {
    const column: GridColumn = { key: "bupa_effectivefrom", checked: true, editKind: "date", dateFormat: "DateOnly" };
    expect(convertEditedCellValue(column, "")).toBeNull();
  });
});
