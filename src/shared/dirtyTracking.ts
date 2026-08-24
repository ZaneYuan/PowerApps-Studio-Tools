import type { GridRow } from "./CheckableGrid";

/** A null source cell renders as `""` in the grid's text/lookup `<input>` (CheckableGrid always
 *  does `String(rawValue ?? "")`), so a user who clicks in and clicks back out without really
 *  changing anything can still produce `""` where the original had `null`. Treat those as equal
 *  so that isn't mistaken for a real edit — everything else compares strictly. Shared by every
 *  tool that tracks a row's edits against its originally-loaded baseline (Data Edit's own
 *  "update only what actually changed" write path, and CheckableGrid's per-field modified marker
 *  / the tab-level unsaved-changes indicator every grid-based write tool now shares). */
export function valuesEqual(a: unknown, b: unknown): boolean {
  const na = a ?? null;
  const nb = b ?? null;
  if (na === nb) return true;
  if ((na === null || na === "") && (nb === null || nb === "")) return true;
  return false;
}

/** True once at least one of `row`'s values actually differs from its `originalValues` baseline
 *  — the same "did this row change" question Data Edit's write path already asked, generalized so
 *  CheckableGrid's per-field marker and every tool's unsaved-changes badge/tab-close warning can
 *  ask it too. A row with no `originalValues` (a read-only grid that never set one, e.g. SQL4CDS'
 *  own query-result display) is never dirty — there's no baseline to compare against. */
export function isRowDirty(row: GridRow): boolean {
  if (!row.originalValues) return false;
  const original = row.originalValues;
  return Object.keys(original).some((key) => !valuesEqual(row.values[key], original[key]));
}

/** Which of `columnKeys` actually differ from `row`'s baseline — the fields a partial-update PATCH
 *  should include, instead of resending every checked column's current value regardless of
 *  whether that particular field changed (harmless-looking, but re-triggers plugins/workflows
 *  bound to fields nobody touched, and can clobber a value someone else changed in Dataverse
 *  since this row was queried, for a field this edit never meant to touch at all). Falls back to
 *  "all of them" when there's no baseline snapshot at all — same defensive "no snapshot, treat as
 *  changed" fallback isRowDirty's own row-level callers already use — rather than silently
 *  dropping every field into an empty body. */
export function dirtyColumnKeys(row: GridRow, columnKeys: string[]): string[] {
  if (!row.originalValues) return columnKeys;
  const original = row.originalValues;
  return columnKeys.filter((key) => !valuesEqual(row.values[key], original[key]));
}
