import type { ManyToManyInfo } from "../../native/metadataService";
import type { GridColumn, GridRow } from "../../shared/CheckableGrid";

export interface ImportColumn extends GridColumn {
  attributeType: string;
}

/** No extra fields needed beyond the shared grid's own row shape — `id` doubles as this row's
 *  own primary-key value (a real existing GUID for a query-sourced row, or the literal from an
 *  uploaded SQL file's INSERT for a sql-insert-sourced row). */
export type ImportRow = GridRow;

export type ImportTableSource = "query" | "sql-insert";

export interface ImportTable {
  /** Unique key for the tab strip — the same entity can appear more than once (two different
   *  SELECTs against it, or a query tab alongside a SQL-import tab), so this isn't just the
   *  entity's logical name. */
  tabId: string;
  entityLogicalName: string;
  entitySetName: string;
  primaryIdAttribute: string;
  source: ImportTableSource;
  columns: ImportColumn[];
  rows: ImportRow[];
  /** Detected via fetchManyToManyInfo — an intersect entity has no single-row primary key to
   *  PATCH/upsert, so it's excluded from the two-phase deferred-write plan entirely and handled
   *  via the relationship's $ref associate endpoint instead (see writeOps.ts). */
  isIntersect: boolean;
  manyToManyInfo?: ManyToManyInfo;
}
