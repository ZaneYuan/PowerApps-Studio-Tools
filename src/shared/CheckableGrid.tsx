import { memo, useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import AttributePicker from "./AttributePicker";
import LookupPickerModal from "./LookupPickerModal";

// Matches this grid's actual rendered row height closely enough for @tanstack/react-virtual's
// scroll-position math — every cell uses the same py-1.5 padding and whitespace-nowrap (no
// wrapping, so no row is taller than another), so a fixed estimate is accurate rather than a
// rough approximation, and there's no need for the library's (pricier) dynamic remeasurement.
const ROW_HEIGHT_PX = 33;

export interface GridColumn {
  key: string;
  checked: boolean;
  /** When true, a checked row's cell for this column renders an input/select instead of plain
   *  text — the caller owns what the edited value means (e.g. converting a Picklist option back
   *  to a number before writing); this component only ever hands back the raw string a native
   *  `<input>`/`<select>` produced (a picked Lookup record's id, in "lookup"'s case). */
  editable?: boolean;
  editKind?: "text" | "select" | "lookup";
  /** Required when editKind is "select" — `value` is always a string (native `<option>` values
   *  always are), even for a numeric-backed Picklist option; the caller converts back. */
  options?: { value: string; label: string }[];
  /** Drag-resized column width in px — unset until the user drags this column's resize handle,
   *  at which point it renders at its natural (whitespace-nowrap) width same as before. */
  width?: number;
}

export interface GridRow {
  id: string;
  checked: boolean;
  values: Record<string, unknown>;
}

const inputCls =
  "w-full min-w-24 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

/** One row, split out and `memo`-wrapped so a scroll tick that re-renders the parent grid (see
 *  the virtualizer below — *every* scroll event re-renders it, vertical or horizontal, whether or
 *  not the visible row range actually changed) doesn't force React to recreate and re-diff every
 *  cell of every row that's already correctly rendered. Cheap on a narrow table; on a wide one
 *  (a product-class entity easily has 150-280 attributes) recreating ~35 rows × 200 columns of
 *  cells from scratch on every scroll frame was enough sustained allocation to make the whole
 *  machine feel like it was thrashing, not just the tab — see bugs & requirements/8.20.md. Only
 *  actually skips work when its own props are referentially stable, so every callback below is
 *  its own `useCallback` rather than an inline arrow recreated per render. */
const GridRowView = memo(function GridRowView({
  row,
  checkedColumns,
  onEditCell,
  onToggleRow,
  onOpenLookupEditor,
  connectionId,
  entityLogicalName,
}: {
  row: GridRow;
  checkedColumns: GridColumn[];
  onEditCell?: (rowId: string, columnKey: string, value: string) => void;
  onToggleRow: (id: string) => void;
  onOpenLookupEditor: (rowId: string, columnKey: string) => void;
  connectionId?: string;
  entityLogicalName?: string;
}) {
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-3 py-1.5">
        <input type="checkbox" checked={row.checked} onChange={() => onToggleRow(row.id)} />
      </td>
      {checkedColumns.map((c) => {
        const rawValue = row.values[c.key];
        const displayValue = typeof rawValue === "object" ? JSON.stringify(rawValue) : String(rawValue ?? "");
        return (
          <td
            key={c.key}
            className="whitespace-nowrap px-3 py-1.5 font-mono text-xs"
            style={c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : undefined}
          >
            {c.editable && c.editKind === "select" ? (
              <select value={String(rawValue ?? "")} onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)} className={inputCls}>
                <option value="" />
                {c.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : c.editable && c.editKind === "lookup" ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={String(rawValue ?? "")}
                  onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                  className={`${inputCls} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => onOpenLookupEditor(row.id, c.key)}
                  title="搜索并选择记录"
                  disabled={!connectionId || !entityLogicalName}
                  className="shrink-0 rounded border border-gray-300 px-1 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  🔍
                </button>
              </div>
            ) : c.editable ? (
              <input
                type="text"
                value={String(rawValue ?? "")}
                onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                className={inputCls}
              />
            ) : (
              <span className="block overflow-hidden text-ellipsis" title={displayValue}>
                {displayValue}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
});

/** The shared "query a table, review it as a row/column-checkbox grid" surface every write tool
 *  in this app builds on (data-migration's multi-table Tabs, data-copy's single editable table).
 *  Purely controlled — holds no state of its own, so two tools using two different underlying
 *  row shapes (a plain read-only migration row vs. an editable copy-source row) can still share
 *  one implementation instead of two copies that quietly drift apart over time. */
export default function CheckableGrid({
  columns,
  rows,
  onColumnsChange,
  onRowsChange,
  onEditCell,
  columnsLabel = "列（勾选）",
  renderColumnBadge,
  connectionId,
  entityLogicalName,
}: {
  columns: GridColumn[];
  rows: GridRow[];
  onColumnsChange: (columns: GridColumn[]) => void;
  onRowsChange: (rows: GridRow[]) => void;
  /** Only needed when at least one column is `editable` — omit for a read-only grid. */
  onEditCell?: (rowId: string, columnKey: string, value: string) => void;
  columnsLabel?: string;
  renderColumnBadge?: (column: GridColumn) => ReactNode;
  /** Only needed when at least one column is `editKind: "lookup"` — the row's own table and the
   *  connection to search it against, passed straight through to `LookupPickerModal`. */
  connectionId?: string;
  entityLogicalName?: string;
}) {
  // Memoized on `columns` alone (not recomputed on every render) — a wide entity (product-class
  // tables routinely have 150-280 attributes) turned this into a real, visible cost once a
  // scroll container had anything actually subscribed to its scroll events (the row virtualizer
  // below): every scroll tick, *including a purely horizontal drag that never changes which rows
  // are visible*, re-ran this filter and — worse — handed AttributePicker brand-new array/Set
  // object references, which broke its own internal useMemo and forced it to rebuild and re-diff
  // its full (150-280 item) checkbox list on every single tick. A several-thousand-row table with
  // few columns never showed this (the recompute is cheap when there are only a handful of
  // columns); a few-dozen-row table with hundreds of columns stalled on every drag — column count,
  // not row count, was the real variable (see bugs & requirements/8.20.md).
  const checkedColumns = useMemo(() => columns.filter((c) => c.checked), [columns]);
  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  const checkedColumnKeys = useMemo(() => new Set(checkedColumns.map((c) => c.key)), [checkedColumns]);
  const allRowsChecked = rows.length > 0 && rows.every((r) => r.checked);
  const checkedRowCount = rows.filter((r) => r.checked).length;
  const [lookupEditorCell, setLookupEditorCell] = useState<{ rowId: string; columnKey: string } | null>(null);

  // A plain `rows.map(...)` over everything used to be fine when cells were read-only text, but
  // once item 6/8.18 gave every editable cell a real <input>/<select> (plus the resize/lookup
  // machinery above), a several-thousand-row import (a real one: 4192 rows, see bugs &
  // requirements/8.19.md #6) rendered tens of thousands of live form elements in one React commit
  // — tens of seconds of an unresponsive tab. Row virtualization keeps the same scrollable
  // <table>/<tbody> (column alignment needs real in-flow <tr>s — an absolutely-positioned <tr>
  // breaks table layout, so this uses the "spacer <tr> before/after the visible slice" technique
  // rather than transform-positioning every row) but only ever mounts the rows actually in or
  // near the viewport.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 15,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const topSpacerHeight = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const bottomSpacerHeight = virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  // useCallback (not a plain function declaration) so these stay referentially stable across a
  // scroll-driven re-render too — otherwise AttributePicker still can't bail out via React.memo
  // even after the arrays/Set above are stabilized, since onToggle/onToggleAll would still look
  // "changed" every tick.
  const toggleColumn = useCallback((key: string) => onColumnsChange(columns.map((c) => (c.key === key ? { ...c, checked: !c.checked } : c))), [columns, onColumnsChange]);
  const toggleAllColumns = useCallback((selectAll: boolean) => onColumnsChange(columns.map((c) => ({ ...c, checked: selectAll }))), [columns, onColumnsChange]);
  const renderBadge = useCallback(
    (key: string) => {
      const column = columns.find((c) => c.key === key);
      return column && renderColumnBadge?.(column);
    },
    [columns, renderColumnBadge],
  );
  const toggleRow = useCallback((id: string) => onRowsChange(rows.map((r) => (r.id === id ? { ...r, checked: !r.checked } : r))), [rows, onRowsChange]);
  function toggleAllRows() {
    const next = !allRowsChecked;
    onRowsChange(rows.map((r) => ({ ...r, checked: next })));
  }
  const openLookupEditor = useCallback((rowId: string, columnKey: string) => setLookupEditorCell({ rowId, columnKey }), []);

  /** Drag-to-resize a column header — same "record start position/width, track via window-level
   *  mousemove/mouseup" pattern already used by Plugin Registration's tree/detail split (see
   *  01-开发进度.md's 2026-08-11 entry), reimplemented here since that one lives in a different
   *  component with a single fixed splitter rather than N independently resizable columns. */
  function startResize(e: ReactMouseEvent<HTMLDivElement>, key: string) {
    e.preventDefault();
    const th = e.currentTarget.parentElement;
    const startWidth = th?.getBoundingClientRect().width ?? 140;
    const startX = e.clientX;
    function onMouseMove(ev: MouseEvent) {
      const next = Math.max(60, startWidth + (ev.clientX - startX));
      onColumnsChange(columns.map((c) => (c.key === key ? { ...c, width: next } : c)));
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <div className="space-y-3">
      <AttributePicker
        label={columnsLabel}
        options={columnKeys}
        selected={checkedColumnKeys}
        onToggle={toggleColumn}
        onToggleAll={toggleAllColumns}
        renderBadge={renderBadge}
      />

      <div ref={scrollRef} className="max-h-[45vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="inline-block min-w-full align-top">
          <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
            共 {rows.length} 行，已选 {checkedRowCount} 行
          </div>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-[29px] z-10 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">
                  <input type="checkbox" checked={allRowsChecked} onChange={toggleAllRows} />
                </th>
                {checkedColumns.map((c) => (
                  <th
                    key={c.key}
                    className="relative whitespace-nowrap px-3 py-2 pr-4 font-mono"
                    style={c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : undefined}
                  >
                    <span className="block overflow-hidden text-ellipsis" title={c.key}>
                      {c.key}
                    </span>
                    <div
                      onMouseDown={(e) => startResize(e, c.key)}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400 dark:hover:bg-blue-500"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topSpacerHeight > 0 && (
                <tr style={{ height: topSpacerHeight }} aria-hidden="true">
                  <td colSpan={checkedColumns.length + 1} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <GridRowView
                    key={row.id}
                    row={row}
                    checkedColumns={checkedColumns}
                    onEditCell={onEditCell}
                    onToggleRow={toggleRow}
                    onOpenLookupEditor={openLookupEditor}
                    connectionId={connectionId}
                    entityLogicalName={entityLogicalName}
                  />
                );
              })}
              {bottomSpacerHeight > 0 && (
                <tr style={{ height: bottomSpacerHeight }} aria-hidden="true">
                  <td colSpan={checkedColumns.length + 1} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {lookupEditorCell && connectionId && entityLogicalName && (
        <LookupPickerModal
          connectionId={connectionId}
          entityLogicalName={entityLogicalName}
          attributeLogicalName={lookupEditorCell.columnKey}
          multiValue={false}
          onPick={(value) => {
            onEditCell?.(lookupEditorCell.rowId, lookupEditorCell.columnKey, value);
            setLookupEditorCell(null);
          }}
          onClose={() => setLookupEditorCell(null)}
        />
      )}
    </div>
  );
}
