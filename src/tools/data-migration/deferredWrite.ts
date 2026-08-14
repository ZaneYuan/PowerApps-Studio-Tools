import type { ImportRow, ImportTable } from "./types";

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface DeferredRowPlan {
  table: ImportTable;
  row: ImportRow;
  /** Checked column logical names excluded from the first write — each references another
   *  checked row's own primary key somewhere else in this same batch, so the target doesn't
   *  exist yet at phase-1 time. Backfilled once every checked row across every table exists. */
  deferredColumns: string[];
}

export interface DeferredWritePlan {
  /** Every checked row in every non-intersect table, in table order — intersect entities have no
   *  single-row primary key to defer/backfill against and are handled separately by the caller
   *  via the relationship's $ref associate endpoint. */
  rows: DeferredRowPlan[];
  /** How many rows have at least one deferred column — for the confirm-dialog summary. */
  deferredRowCount: number;
}

/** Builds the two-phase write plan: phase 1 writes every checked row's checked columns *except*
 *  any column whose value is exactly another checked row's own primary key somewhere in this
 *  batch (that target doesn't exist yet); phase 2 backfills just those deferred columns once
 *  every row from phase 1 exists. No ordering, no cycle detection — deferring unconditionally
 *  makes a cyclic pair of tables (A references B, B references A) resolve for free: both rows
 *  get created with the cross-reference blank in phase 1, then both get backfilled in phase 2.
 *
 *  Only a GUID that's genuinely one of *this batch's own* checked rows' primary keys gets
 *  deferred — a Lookup pointing at an unrelated table, or at a GUID that isn't among the rows
 *  being imported here (an already-existing target record), is left as a normal field and
 *  written inline in phase 1, exactly as-is. */
export function planDeferredWrite(tables: ImportTable[]): DeferredWritePlan {
  const writableTables = tables.filter((t) => !t.isIntersect);

  // guid (lowercased) -> the checked row that owns it as its own primary key. Unchecked rows
  // don't count — this run never creates them, so a reference to one must not be deferred (the
  // backfill would target a record that was never written).
  const creators = new Map<string, ImportRow>();
  for (const table of writableTables) {
    for (const row of table.rows) {
      if (row.checked) creators.set(row.id.toLowerCase(), row);
    }
  }

  const rows: DeferredRowPlan[] = [];
  let deferredRowCount = 0;
  for (const table of writableTables) {
    const checkedColumns = new Set(table.columns.filter((c) => c.checked).map((c) => c.key.toLowerCase()));
    for (const row of table.rows) {
      if (!row.checked) continue;
      const deferredColumns: string[] = [];
      for (const [col, value] of Object.entries(row.values)) {
        const lower = col.toLowerCase();
        if (!checkedColumns.has(lower) || lower === table.primaryIdAttribute.toLowerCase()) continue;
        if (typeof value !== "string" || !GUID_RE.test(value)) continue;
        const creatorRow = creators.get(value.toLowerCase());
        if (creatorRow && creatorRow !== row) deferredColumns.push(col);
      }
      rows.push({ table, row, deferredColumns });
      if (deferredColumns.length > 0) deferredRowCount++;
    }
  }
  return { rows, deferredRowCount };
}

/** The checked-column values to write for one row, minus whichever ones this plan deferred. */
export function phase1Body(plan: DeferredRowPlan): Record<string, unknown> {
  const deferred = new Set(plan.deferredColumns.map((c) => c.toLowerCase()));
  const checkedColumns = new Set(plan.table.columns.filter((c) => c.checked).map((c) => c.key.toLowerCase()));
  const body: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(plan.row.values)) {
    const lower = col.toLowerCase();
    if (!checkedColumns.has(lower) || deferred.has(lower)) continue;
    body[col] = value;
  }
  return body;
}

/** Just the deferred columns' values — the phase-2 backfill body. */
export function phase2Body(plan: DeferredRowPlan): Record<string, unknown> {
  const deferred = new Set(plan.deferredColumns.map((c) => c.toLowerCase()));
  const body: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(plan.row.values)) {
    if (deferred.has(col.toLowerCase())) body[col] = value;
  }
  return body;
}
