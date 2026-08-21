import { describe, expect, it } from "vitest";
import { phase1Body, phase2Body, planDeferredWrite } from "./deferredWrite";
import type { ImportColumn, ImportTable } from "./types";

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
const G3 = "33333333-3333-3333-3333-333333333333";
const EXTERNAL_GUID = "99999999-9999-9999-9999-999999999999"; // not any row's own id in these fixtures

function col(key: string, checked: boolean): ImportColumn {
  return { key, checked, attributeType: "String" };
}

function table(overrides: Partial<ImportTable> & Pick<ImportTable, "rows" | "columns">): ImportTable {
  return {
    tabId: "t1",
    entityLogicalName: "contoso_thing",
    entitySetName: "contoso_things",
    primaryIdAttribute: "contoso_thingid",
    source: "query",
    isIntersect: false,
    ...overrides,
  } as ImportTable;
}

describe("planDeferredWrite — no cross-references", () => {
  it("defers nothing when no checked column's value matches another checked row's own id", () => {
    const t = table({
      columns: [
        col("contoso_thingid", true),
        col("contoso_name", true),
      ],
      rows: [
        { id: G1, checked: true, values: { contoso_thingid: G1, contoso_name: "A" } },
        { id: G2, checked: true, values: { contoso_thingid: G2, contoso_name: "B" } },
      ],
    });
    const plan = planDeferredWrite([t]);
    expect(plan.deferredRowCount).toBe(0);
    expect(plan.rows.every((r) => r.deferredColumns.length === 0)).toBe(true);
  });

  it("a GUID-looking value pointing at a record NOT in this batch is left inline, not deferred", () => {
    const t = table({
      columns: [
        col("contoso_thingid", true),
        col("contoso_parentid", true),
      ],
      rows: [{ id: G1, checked: true, values: { contoso_thingid: G1, contoso_parentid: EXTERNAL_GUID } }],
    });
    const plan = planDeferredWrite([t]);
    expect(plan.deferredRowCount).toBe(0);
    expect(phase1Body(plan.rows[0]).contoso_parentid).toBe(EXTERNAL_GUID);
  });

  it("an unchecked row's id is not a valid defer target — a reference to it stays inline", () => {
    const t = table({
      columns: [
        col("contoso_thingid", true),
        col("contoso_parentid", true),
      ],
      rows: [
        { id: G1, checked: true, values: { contoso_thingid: G1, contoso_parentid: G2 } },
        { id: G2, checked: false, values: { contoso_thingid: G2 } }, // not checked -> never created this run
      ],
    });
    const plan = planDeferredWrite([t]);
    // Only G1's row is in the plan at all (unchecked rows are skipped entirely).
    expect(plan.rows).toHaveLength(1);
    expect(plan.deferredRowCount).toBe(0);
  });

  it("a self-referencing row (its own id in its own column) is not deferred against itself", () => {
    const t = table({
      columns: [
        col("contoso_thingid", true),
        col("contoso_parentid", true),
      ],
      rows: [{ id: G1, checked: true, values: { contoso_thingid: G1, contoso_parentid: G1 } }],
    });
    const plan = planDeferredWrite([t]);
    expect(plan.deferredRowCount).toBe(0);
  });
});

describe("planDeferredWrite — forward reference within one table", () => {
  it("defers a column whose value is a later row's own id (order-independent)", () => {
    const t = table({
      columns: [
        col("contoso_thingid", true),
        col("contoso_parentid", true),
      ],
      rows: [
        { id: G1, checked: true, values: { contoso_thingid: G1, contoso_parentid: G2 } }, // references row 2, which comes after
        { id: G2, checked: true, values: { contoso_thingid: G2 } },
      ],
    });
    const plan = planDeferredWrite([t]);
    expect(plan.deferredRowCount).toBe(1);
    const row1Plan = plan.rows.find((r) => r.row.id === G1)!;
    expect(row1Plan.deferredColumns).toEqual(["contoso_parentid"]);
    expect(phase1Body(row1Plan)).not.toHaveProperty("contoso_parentid");
    expect(phase2Body(row1Plan)).toEqual({ contoso_parentid: G2 });
  });

  it("never defers the row's own primary-id column, even though it's a checked GUID column", () => {
    const t = table({
      columns: [col("contoso_thingid", true)],
      rows: [{ id: G1, checked: true, values: { contoso_thingid: G1 } }],
    });
    const plan = planDeferredWrite([t]);
    expect(plan.deferredRowCount).toBe(0);
    expect(phase1Body(plan.rows[0]).contoso_thingid).toBe(G1);
  });

  it("an unchecked column referencing another row's id is never deferred or written in either phase", () => {
    const t = table({
      columns: [
        col("contoso_thingid", true),
        col("contoso_parentid", false), // unchecked
      ],
      rows: [
        { id: G1, checked: true, values: { contoso_thingid: G1, contoso_parentid: G2 } },
        { id: G2, checked: true, values: { contoso_thingid: G2 } },
      ],
    });
    const plan = planDeferredWrite([t]);
    expect(plan.deferredRowCount).toBe(0);
    const row1 = plan.rows.find((r) => r.row.id === G1)!;
    expect(phase1Body(row1)).not.toHaveProperty("contoso_parentid");
    expect(phase2Body(row1)).not.toHaveProperty("contoso_parentid");
  });
});

describe("planDeferredWrite — cyclic references (A -> B, B -> A)", () => {
  it("resolves a same-table cycle for free: both sides deferred, both backfilled", () => {
    const t = table({
      columns: [
        col("contoso_thingid", true),
        col("contoso_partnerid", true),
      ],
      rows: [
        { id: G1, checked: true, values: { contoso_thingid: G1, contoso_partnerid: G2 } },
        { id: G2, checked: true, values: { contoso_thingid: G2, contoso_partnerid: G1 } },
      ],
    });
    const plan = planDeferredWrite([t]);
    expect(plan.deferredRowCount).toBe(2);
    const row1 = plan.rows.find((r) => r.row.id === G1)!;
    const row2 = plan.rows.find((r) => r.row.id === G2)!;
    expect(phase1Body(row1)).not.toHaveProperty("contoso_partnerid");
    expect(phase1Body(row2)).not.toHaveProperty("contoso_partnerid");
    expect(phase2Body(row1)).toEqual({ contoso_partnerid: G2 });
    expect(phase2Body(row2)).toEqual({ contoso_partnerid: G1 });
  });

  it("resolves a cross-table cycle (table A's row references table B's row and vice versa)", () => {
    const tableA = table({
      tabId: "a",
      entityLogicalName: "contoso_a",
      primaryIdAttribute: "contoso_aid",
      columns: [
        col("contoso_aid", true),
        col("contoso_bid", true),
      ],
      rows: [{ id: G1, checked: true, values: { contoso_aid: G1, contoso_bid: G3 } }],
    });
    const tableB = table({
      tabId: "b",
      entityLogicalName: "contoso_b",
      primaryIdAttribute: "contoso_bid",
      columns: [
        col("contoso_bid", true),
        col("contoso_aid", true),
      ],
      rows: [{ id: G3, checked: true, values: { contoso_bid: G3, contoso_aid: G1 } }],
    });
    const plan = planDeferredWrite([tableA, tableB]);
    expect(plan.deferredRowCount).toBe(2);
  });
});

describe("planDeferredWrite — intersect tables are excluded entirely", () => {
  it("an intersect table's rows never appear in the plan", () => {
    const intersect = table({ isIntersect: true, columns: [col("x", true)], rows: [{ id: G1, checked: true, values: {} }] });
    const plan = planDeferredWrite([intersect]);
    expect(plan.rows).toHaveLength(0);
  });
});

describe("phase1Body / phase2Body", () => {
  it("phase1Body includes only checked, non-deferred columns", () => {
    const t = table({
      columns: [
        col("contoso_thingid", true),
        col("contoso_name", true),
        col("contoso_unchecked", false),
      ],
      rows: [{ id: G1, checked: true, values: { contoso_thingid: G1, contoso_name: "A", contoso_unchecked: "nope" } }],
    });
    const plan = planDeferredWrite([t]);
    const body = phase1Body(plan.rows[0]);
    expect(body).toEqual({ contoso_thingid: G1, contoso_name: "A" });
  });
});
