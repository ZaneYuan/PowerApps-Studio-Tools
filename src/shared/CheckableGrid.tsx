import { memo, useCallback, useMemo, useRef, useState, type FocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import AttributePicker from "./AttributePicker";
import LookupPickerModal from "./LookupPickerModal";
import ColumnFilterPopover from "./ColumnFilterPopover";
import { classifyColumnKind, compareForSort, matchesFilter, sortLabels, sortValueFor, type GridColumnFilter } from "./gridFilter";

// Matches this grid's actual rendered row height closely enough for @tanstack/react-virtual's
// scroll-position math — every cell uses the same py-1.5 padding and whitespace-nowrap (no
// wrapping, so no row is taller than another), so a fixed estimate is accurate rather than a
// rough approximation, and there's no need for the library's (pricier) dynamic remeasurement.
const ROW_HEIGHT_PX = 33;

// The <table> below never set `table-layout`, so it defaulted to `auto` — which requires the
// browser to examine content across *every* row to size columns, and re-examine it whenever
// anything affecting layout changes, including the virtualizer's own spacer-<tr> height changing
// on every scroll tick. On a handful of columns this is cheap; on a product-class entity (150-280
// columns is normal) this auto-layout recalculation is a real, expensive synchronous browser cost
// that memoizing React components (see GridRowView/GridHeader below) can't touch at all — it
// happens in the layout engine, not in JS. `table-layout: fixed` makes column widths authoritative
// from each cell's own `width` style instead of content-scanning the whole table, which is also
// more correct now that resized columns already carry an explicit width — unresized ones need an
// explicit fallback too, or `fixed` layout has nothing to size them by.
const DEFAULT_COLUMN_WIDTH_PX = 160;
// `table-fixed` needs an explicit width on *every* column, including this one — without it, the
// browser's fallback distribution for un-widthed fixed-layout columns is inconsistent enough not
// to rely on for a column that's supposed to always be exactly "one checkbox wide".
const CHECKBOX_COLUMN_WIDTH_PX = 40;

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
  /** The real Dataverse `AttributeType` (fetchAttributes' `AttributeMeta.attributeType` — e.g.
   *  "String", "Picklist", "DateTime", "Lookup"), when the caller has it. Drives the header's
   *  sort labels and the "Filter by" popover's condition list / value widget (see gridFilter.ts's
   *  `classifyColumnKind`) — optional and purely additive, so columns that predate this field
   *  still render exactly as before, just without type-specific sort/filter behavior (falls back
   *  to plain string comparison). */
  attributeType?: string;
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
  // TEMP diagnostic (bugs & requirements/8.19.md #6) — remove once the wide-table scroll stutter
  // is confirmed fixed. Deliberately NOT gated behind import.meta.env.DEV: the report this is
  // chasing only reproduces against the real published desktop build (a production Vite build),
  // not `npm run dev`. One shared counter (not per-row) so it reads as a single number in DevTools
  // Console — reset it (right-click the console → Clear console, or the 🚫 icon) right before a
  // scroll drag, then read it after: this component actually executing its render body dozens of
  // times per second during the drag means memoization genuinely isn't taking effect (the bug is
  // still in React-land); a low, roughly-visible-row-count number instead means rows are correctly
  // being skipped and the remaining cost is elsewhere (browser layout, GC, something outside this
  // component entirely).
  console.count("GridRowView render");
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-3 py-1.5" style={{ width: CHECKBOX_COLUMN_WIDTH_PX }}>
        <input type="checkbox" checked={row.checked} onChange={() => onToggleRow(row.id)} />
      </td>
      {checkedColumns.map((c) => {
        const rawValue = row.values[c.key];
        const displayValue = typeof rawValue === "object" ? JSON.stringify(rawValue) : String(rawValue ?? "");
        const width = c.width ?? DEFAULT_COLUMN_WIDTH_PX;
        return (
          <td key={c.key} className="whitespace-nowrap overflow-hidden px-3 py-1.5 font-mono text-xs" style={{ width, minWidth: width, maxWidth: width }}>
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

/** The header row, split out and `memo`-wrapped for the same reason as `GridRowView` above — its
 *  content (the column list/widths) has nothing to do with which rows are scrolled into view, but
 *  living inline in CheckableGrid's own render meant it got recreated (all 150-280 `<th>`s, each
 *  with its own resize-handle closure) on every one of the re-renders vertical scrolling causes,
 *  same as the rows did before they were split out — see bugs & requirements/8.19.md #6. */
const GridHeader = memo(function GridHeader({
  checkedColumns,
  allRowsChecked,
  onToggleAllRows,
  onResizeColumn,
  sortState,
  filters,
  onSortChange,
  onApplyFilter,
  onClearFilter,
  connectionId,
  entityLogicalName,
}: {
  checkedColumns: GridColumn[];
  allRowsChecked: boolean;
  onToggleAllRows: () => void;
  onResizeColumn: (key: string, width: number) => void;
  sortState: { key: string; direction: "asc" | "desc" } | null;
  filters: Record<string, GridColumnFilter>;
  onSortChange: (key: string, direction: "asc" | "desc") => void;
  onApplyFilter: (key: string, filter: GridColumnFilter) => void;
  onClearFilter: (key: string) => void;
  connectionId?: string;
  entityLogicalName?: string;
}) {
  // TEMP diagnostic — see the matching comment on GridRowView's own counter above; same idea, so
  // a header that's *also* re-executing every scroll tick (vs. only GridRowView) narrows down
  // whether it's specifically the header, specifically the rows, or (if both stay low but the
  // stutter persists anyway) something outside React's render cycle entirely.
  console.count("GridHeader render");
  function startResize(e: ReactMouseEvent<HTMLDivElement>, key: string) {
    e.preventDefault();
    const th = e.currentTarget.parentElement;
    const startWidth = th?.getBoundingClientRect().width ?? 140;
    const startX = e.clientX;
    function onMouseMove(ev: MouseEvent) {
      onResizeColumn(key, Math.max(60, startWidth + (ev.clientX - startX)));
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  // Which column's dropdown menu / filter popover is open, plus the trigger button's own rect
  // (captured on open, same "read getBoundingClientRect once, render at fixed position" technique
  // metadata-browser/ColumnFilterPopover.tsx already uses) — at most one of each open at a time is
  // plenty for a header menu, so this stays two plain useState instead of a per-column map.
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // The wider of the two fixed-position panels this anchors (the filter popover is `w-64` =
  // 256px; the sort/filter menu itself is narrower) — clamped against it so a caret near the
  // right edge (very likely on a wide entity's 150-280-column grid, scrolled horizontally) never
  // anchors a popover partway or fully off-screen.
  const MAX_POPOVER_WIDTH_PX = 264;
  function computeAnchor(key: string) {
    const rect = triggerRefs.current[key]?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(rect.left, window.innerWidth - MAX_POPOVER_WIDTH_PX - 8);
    setAnchor({ top: rect.bottom + 4, left: Math.max(8, left) });
  }
  function handleMenuBlur(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpenMenuKey(null);
  }

  return (
    <thead className="sticky top-[29px] z-10 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
      <tr>
        <th className="px-3 py-2" style={{ width: CHECKBOX_COLUMN_WIDTH_PX }}>
          <input type="checkbox" checked={allRowsChecked} onChange={onToggleAllRows} />
        </th>
        {checkedColumns.map((c) => {
          const width = c.width ?? DEFAULT_COLUMN_WIDTH_PX;
          const kind = classifyColumnKind(c.attributeType);
          const labels = sortLabels(kind);
          const sortDirection = sortState?.key === c.key ? sortState.direction : null;
          const activeFilter = filters[c.key] ?? null;
          return (
            <th
              key={c.key}
              className="relative whitespace-nowrap px-3 py-2 pr-4 font-mono"
              style={{ width, minWidth: width, maxWidth: width }}
            >
              <div className="flex items-center gap-1">
                <span className="block flex-1 overflow-hidden text-ellipsis" title={c.key}>
                  {c.key}
                </span>
                {sortDirection && <span className="shrink-0 text-blue-500 dark:text-blue-400">{sortDirection === "asc" ? "↑" : "↓"}</span>}
                {activeFilter && (
                  <span className="shrink-0 text-blue-500 dark:text-blue-400" title="已应用筛选">
                    ⏷
                  </span>
                )}
                <button
                  ref={(el) => {
                    triggerRefs.current[c.key] = el;
                  }}
                  type="button"
                  onClick={() => {
                    if (openMenuKey === c.key) {
                      setOpenMenuKey(null);
                    } else {
                      computeAnchor(c.key);
                      setOpenMenuKey(c.key);
                      setOpenFilterKey(null);
                    }
                  }}
                  className="shrink-0 rounded px-0.5 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  ▾
                </button>
              </div>
              <div
                onMouseDown={(e) => startResize(e, c.key)}
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400 dark:hover:bg-blue-500"
              />

              {openMenuKey === c.key && (
                <div
                  tabIndex={-1}
                  onBlur={handleMenuBlur}
                  style={{ position: "fixed", top: anchor.top, left: anchor.left }}
                  className="z-50 w-44 rounded-md border border-gray-200 bg-white py-1 text-left text-xs font-normal normal-case text-gray-700 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSortChange(c.key, "asc");
                      setOpenMenuKey(null);
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    ↑ {labels.asc}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSortChange(c.key, "desc");
                      setOpenMenuKey(null);
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    ↓ {labels.desc}
                  </button>
                  <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                  <button
                    type="button"
                    onClick={() => {
                      computeAnchor(c.key);
                      setOpenMenuKey(null);
                      setOpenFilterKey(c.key);
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    ▾ Filter by
                  </button>
                  {activeFilter && (
                    <button
                      type="button"
                      onClick={() => {
                        onClearFilter(c.key);
                        setOpenMenuKey(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-800"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              )}

              {openFilterKey === c.key && (
                <ColumnFilterPopover
                  column={c}
                  kind={kind}
                  filter={activeFilter}
                  anchor={anchor}
                  onApply={(filter) => {
                    onApplyFilter(c.key, filter);
                    setOpenFilterKey(null);
                  }}
                  onClear={() => {
                    onClearFilter(c.key);
                    setOpenFilterKey(null);
                  }}
                  onClose={() => setOpenFilterKey(null)}
                  connectionId={connectionId}
                  entityLogicalName={entityLogicalName}
                />
              )}
            </th>
          );
        })}
      </tr>
    </thead>
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
  // TEMP diagnostic — the parent's own render count is *expected* to climb fast during a scroll
  // drag (the virtualizer's internal scroll-offset state lives here, so that's just it doing its
  // job) — this counter is the baseline the GridRowView/GridHeader counters should be compared
  // against, not a sign of a bug on its own.
  console.count("CheckableGrid render");
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
  const checkedRowCount = rows.filter((r) => r.checked).length;
  const [lookupEditorCell, setLookupEditorCell] = useState<{ rowId: string; columnKey: string } | null>(null);

  // Sort/filter are view-only concerns local to this component — they reorder/narrow what's
  // *displayed*, never `rows` itself (see displayRows below), so switching tables/tabs doesn't
  // need any coordination with the caller's own state. Keyed by column `key`, same as GridColumn
  // itself, so a stale filter/sort referencing a column that's since disappeared (a different
  // entity's columns, say) just silently matches nothing rather than erroring — see displayRows'
  // own column-lookup guards below.
  const [sortState, setSortState] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, GridColumnFilter>>({});
  const hasActiveFilter = Object.keys(filters).length > 0;

  const displayRows = useMemo(() => {
    let result = rows;
    const filterEntries = Object.entries(filters);
    if (filterEntries.length > 0) {
      result = result.filter((row) =>
        filterEntries.every(([key, filter]) => {
          const column = columns.find((c) => c.key === key);
          return matchesFilter(row.values[key], classifyColumnKind(column?.attributeType), filter);
        }),
      );
    }
    if (sortState) {
      const column = columns.find((c) => c.key === sortState.key);
      if (column) {
        const kind = classifyColumnKind(column.attributeType);
        const { key, direction } = sortState;
        result = [...result].sort((a, b) =>
          compareForSort(sortValueFor(a.values[key], column, kind), sortValueFor(b.values[key], column, kind), kind, direction),
        );
      }
    }
    return result;
  }, [rows, filters, sortState, columns]);
  const allRowsChecked = displayRows.length > 0 && displayRows.every((r) => r.checked);

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
    count: displayRows.length,
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
  // Only (de)selects the currently displayed (filtered) rows — a row hidden by an active filter
  // keeps whatever checked state it already had, same as Dataverse's own grid: "select all" only
  // ever means "all of what I can currently see".
  const toggleAllRows = useCallback(() => {
    const next = !allRowsChecked;
    const displayIds = new Set(displayRows.map((r) => r.id));
    onRowsChange(rows.map((r) => (displayIds.has(r.id) ? { ...r, checked: next } : r)));
  }, [allRowsChecked, displayRows, rows, onRowsChange]);
  const openLookupEditor = useCallback((rowId: string, columnKey: string) => setLookupEditorCell({ rowId, columnKey }), []);
  const resizeColumn = useCallback(
    (key: string, width: number) => onColumnsChange(columns.map((c) => (c.key === key ? { ...c, width } : c))),
    [columns, onColumnsChange],
  );
  const handleSortChange = useCallback((key: string, direction: "asc" | "desc") => setSortState({ key, direction }), []);
  const handleApplyFilter = useCallback((key: string, filter: GridColumnFilter) => setFilters((prev) => ({ ...prev, [key]: filter })), []);
  const handleClearFilter = useCallback(
    (key: string) =>
      setFilters((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }),
    [],
  );

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
            {hasActiveFilter ? (
              <>
                共 {rows.length} 行（筛选后 {displayRows.length} 行），已选 {checkedRowCount} 行
              </>
            ) : (
              <>
                共 {rows.length} 行，已选 {checkedRowCount} 行
              </>
            )}
          </div>
          <table className="w-full table-fixed text-left text-sm">
            <GridHeader
              checkedColumns={checkedColumns}
              allRowsChecked={allRowsChecked}
              onToggleAllRows={toggleAllRows}
              onResizeColumn={resizeColumn}
              sortState={sortState}
              filters={filters}
              onSortChange={handleSortChange}
              onApplyFilter={handleApplyFilter}
              onClearFilter={handleClearFilter}
              connectionId={connectionId}
              entityLogicalName={entityLogicalName}
            />
            <tbody>
              {topSpacerHeight > 0 && (
                <tr style={{ height: topSpacerHeight }} aria-hidden="true">
                  <td colSpan={checkedColumns.length + 1} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = displayRows[virtualRow.index];
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
