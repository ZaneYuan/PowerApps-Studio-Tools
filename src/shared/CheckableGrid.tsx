import { memo, useCallback, useMemo, useRef, useState, type FocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import AttributePicker from "./AttributePicker";
import LookupPickerModal from "./LookupPickerModal";
import ColumnFilterPopover from "./ColumnFilterPopover";
import { classifyColumnKind, compareForSort, matchesFilter, sortLabels, sortValueFor, type GridColumnFilter } from "./gridFilter";
import { valuesEqual } from "./dirtyTracking";

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
  /** "select" (Picklist/State/Status, single value) and "multiselect" (MultiSelectPicklist, a
   *  comma-separated value list) both need `options`. "number"/"date"/"boolean" are native
   *  `<input type="number"|"date">`/`<select>` widgets with no options list of their own — the
   *  caller converts their raw string back to a real number/ISO datetime/boolean, same spirit as
   *  "select"'s own Picklist-code conversion. PartyList and any attribute type this app doesn't
   *  recognize have no editor at all (see gridColumns.ts's buildEditableGridColumns) and stay
   *  plain read-only text regardless of `editable`. */
  editKind?: "text" | "select" | "multiselect" | "lookup" | "number" | "date" | "boolean";
  /** Required when editKind is "select" or "multiselect" — `value` is always a string (native
   *  `<option>` values always are), even for a numeric-backed option; the caller converts back. */
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
  /** Only set when `editKind === "date"` and the real Format is known (see
   *  metadataService.ts's `fetchDateTimeFormat`) — "DateOnly" fields are `Edm.Date` over the Web
   *  API (a bare `YYYY-MM-DD` literal) while "DateAndTime" fields are `Edm.DateTimeOffset` (a full
   *  ISO datetime); gridColumns.ts's `convertEditedCellValue` needs this to serialize an edit into
   *  the shape the field's actual type expects instead of always sending a full ISO string (which
   *  400s against a DateOnly field — Bugs/8.25.md #3). Undefined falls back to the previous
   *  ISO-string behavior, so a caller that hasn't fetched Format yet degrades exactly as before. */
  dateFormat?: "DateOnly" | "DateAndTime";
}

export interface GridRow {
  id: string;
  checked: boolean;
  values: Record<string, unknown>;
  /** Snapshot of `values` exactly as originally loaded (a query result, a parsed SQL INSERT, ...)
   *  — never mutated once set (every edit replaces `values` wholesale via spread, same convention
   *  Data Edit's own dirty-row detection already relied on before this became shared). Drives the
   *  per-field "modified" marker below and every caller's own isRowDirty(row)-based unsaved-
   *  changes tracking (see shared/dirtyTracking.ts). Omit entirely for a read-only grid with no
   *  "modified" concept — no baseline means no cell is ever marked dirty. */
  originalValues?: Record<string, unknown>;
  /** Human-readable label for a Lookup (or any FormattedValue-annotated) column, keyed by column
   *  `key` — from the OData `...@OData.Community.Display.V1.FormattedValue` annotation a caller
   *  requested via `includeFormattedValues: true` (see native/odata.ts's
   *  unwrapODataRowWithFormatting). `values[key]` itself stays the raw value (a GUID, an option
   *  code) that's actually submitted; this is purely a display-only side channel. Omit when the
   *  caller never requested annotations — cells just fall back to showing the raw value, same as
   *  before this existed. */
  formattedValues?: Record<string, string>;
}

/** Applies an `onEditCell` edit's optional resolved `label` (see that prop's own doc comment
 *  below) to a row's `formattedValues` — every tool's own `handleEditCell` calls this so the rule
 *  ("set it when given, clear any stale entry for that column when not") lives in one place
 *  instead of being reimplemented per tool. Never mutates the input. */
export function applyEditedLabel(
  formattedValues: Record<string, string> | undefined,
  columnKey: string,
  label: string | undefined,
): Record<string, string> {
  const next = { ...formattedValues };
  if (label) next[columnKey] = label;
  else delete next[columnKey];
  return next;
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
 *  its own `useCallback` rather than an inline arrow recreated per render.
 *
 *  memo alone wasn't the whole story, though: real usage on a product-class table (150-280
 *  editable columns, so up to that many live `<input>`/`<select>` elements per row) kept stuttering
 *  on plain vertical scroll even once every re-render here was confirmed (via a temporary
 *  `console.count`, since removed) to be legitimately skipped — the cost wasn't React re-rendering these cells, it was the
 *  browser having to keep that many real form controls laid out and painted at once, scaling
 *  directly with *checked column count* regardless of row count (a 5000-row/20-column table never
 *  stuttered; a 37-row/165-column one did). Standard fix, same one every serious data-grid uses
 *  (Excel Online, Google Sheets, AG Grid): an editable cell is a plain `<span>` until clicked, and
 *  only the *one* cell currently being edited (`activeColumnKey`) actually mounts a real control —
 *  so the live-control count is bounded by 1, not by rows × checked columns. */
const GridRowView = memo(function GridRowView({
  row,
  visibleColumns,
  leftSpacerWidth,
  rightSpacerWidth,
  activeColumnKey,
  onEditCell,
  onToggleRow,
  onActivateCell,
  onDeactivateCell,
  onOpenLookupEditor,
  connectionId,
  entityLogicalName,
  showRowCheckbox,
}: {
  row: GridRow;
  /** Only the columns currently in (or near) the horizontal viewport — see the column virtualizer
   *  in CheckableGrid below. Windowed the same way displayRows windows which *rows* mount, for the
   *  same reason: a product-class entity's 150-280 columns all mounting as real `<td>`s regardless
   *  of horizontal scroll position was the dominant remaining cost after click-to-edit bounded the
   *  live-form-control count — DOM node count for a fixed-layout wide table scales with *mounted*
   *  cells, not with what's visually inside the scroll port. */
  visibleColumns: GridColumn[];
  /** Width (px) of the off-screen columns to the left/right of `visibleColumns`, rendered as a
   *  single filler `<td>` each — the same "spacer before/after the visible slice" technique the
   *  vertical row virtualizer already uses, just turned 90 degrees. */
  leftSpacerWidth: number;
  rightSpacerWidth: number;
  /** The key of this row's own cell currently in edit mode, or null — computed by the caller as
   *  a plain string (not the raw `{rowId, columnKey}` selection object) specifically so a click
   *  that activates/deactivates a cell in some *other* row doesn't change this prop's value at
   *  all, and `memo` correctly leaves every other row alone. */
  activeColumnKey: string | null;
  /** See the same-named prop's own doc comment on the default-exported CheckableGrid below for
   *  what the optional `label` argument means. */
  onEditCell?: (rowId: string, columnKey: string, value: string, label?: string) => void;
  onToggleRow: (id: string) => void;
  onActivateCell: (rowId: string, columnKey: string) => void;
  onDeactivateCell: (rowId: string, columnKey: string) => void;
  onOpenLookupEditor: (rowId: string, columnKey: string) => void;
  connectionId?: string;
  entityLogicalName?: string;
  showRowCheckbox: boolean;
}) {
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      {showRowCheckbox && (
        <td className="px-3 py-1.5" style={{ width: CHECKBOX_COLUMN_WIDTH_PX }}>
          <input type="checkbox" checked={row.checked} onChange={() => onToggleRow(row.id)} />
        </td>
      )}
      {leftSpacerWidth > 0 && <td aria-hidden="true" style={{ width: leftSpacerWidth }} />}
      {visibleColumns.map((c) => {
        const rawValue = row.values[c.key];
        // A Picklist's stored value is its numeric option code, not the human label — the old
        // always-on `<select>` resolved this for free (the browser matches `value` to the
        // matching `<option>`'s text), but the inactive span below renders plain text and has to
        // do that lookup itself, or every unclicked Picklist cell in the grid would show a bare
        // code number instead of its label. "select" and "lookup" both fall back to the row's own
        // `formattedValues` (the FormattedValue OData annotation, when the caller requested it via
        // includeFormattedValues) before giving up and showing the raw code/GUID — for "select"
        // that's a safety net for an option this app's own metadata lookup didn't resolve; for
        // "lookup" it's the only source of a human name at all, since a Lookup's raw value is just
        // the target record's GUID with nothing else to look it up against client-side.
        const displayValue =
          c.editKind === "select"
            ? (c.options?.find((o) => o.value === String(rawValue ?? ""))?.label ?? row.formattedValues?.[c.key] ?? String(rawValue ?? ""))
            : c.editKind === "lookup"
              ? (row.formattedValues?.[c.key] ?? String(rawValue ?? ""))
              : c.editKind === "multiselect"
                ? // Dataverse's Web API returns a MultiSelectPicklist as a comma-separated string of
                  // numeric codes, same convention as Picklist's single code — resolve each to its
                  // label the same way, joined back with ", " for display.
                  String(rawValue ?? "")
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                    .map((v) => c.options?.find((o) => o.value === v)?.label ?? v)
                    .join(", ")
                : typeof rawValue === "object"
                  ? JSON.stringify(rawValue)
                  : String(rawValue ?? "");
        const width = c.width ?? DEFAULT_COLUMN_WIDTH_PX;
        // A baseline-tracking row (originalValues set — see GridRow's own doc comment) flags any
        // checked/unchecked field the user has actually edited away from what was originally
        // loaded — a read-only grid that never sets originalValues just never marks anything.
        const isFieldModified = row.originalValues != null && !valuesEqual(rawValue, row.originalValues[c.key]);
        return (
          <td
            key={c.key}
            className="relative whitespace-nowrap overflow-hidden px-3 py-1.5 font-mono text-xs"
            style={{ width, minWidth: width, maxWidth: width }}
          >
            {isFieldModified && (
              <span
                className="pointer-events-none absolute right-0.5 top-0.5 text-[10px] leading-none text-amber-500 dark:text-amber-400"
                title={`该字段已修改（原值：${row.originalValues?.[c.key] == null || row.originalValues[c.key] === "" ? "(空)" : String(row.originalValues[c.key])}）`}
              >
                ❗
              </span>
            )}
            {!c.editable ? (
              <span className="block overflow-hidden text-ellipsis" title={displayValue}>
                {displayValue}
              </span>
            ) : activeColumnKey !== c.key ? (
              // Not the active cell — a plain, cheap span standing in for the real control (see
              // the block comment above GridRowView). Click activates it; the value shown is
              // exactly what the real control would've shown, so there's no visible flash when it
              // swaps in.
              <span
                onClick={() => onActivateCell(row.id, c.key)}
                className="block cursor-text overflow-hidden text-ellipsis rounded px-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                title={displayValue}
              >
                {displayValue || " "}
              </span>
            ) : c.editKind === "select" ? (
              <select
                autoFocus
                value={String(rawValue ?? "")}
                onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                onBlur={() => onDeactivateCell(row.id, c.key)}
                className={inputCls}
              >
                <option value="" />
                {c.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : c.editKind === "lookup" ? (
              // Blur lives on the wrapping div (not the text input) and checks `relatedTarget` —
              // same "ignore a blur that's just focus moving to a sibling inside this same widget"
              // technique as GridHeader's own `handleMenuBlur` — so clicking 🔍 doesn't itself
              // deactivate the cell out from under the click.
              <div onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && onDeactivateCell(row.id, c.key)} className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={String(rawValue ?? "")}
                  onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                  className={`${inputCls} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => onOpenLookupEditor(row.id, c.key)}
                  title="搜索并选择记录"
                  aria-label="搜索并选择记录"
                  disabled={!connectionId || !entityLogicalName}
                  className="shrink-0 rounded border border-gray-300 px-1 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  🔍
                </button>
              </div>
            ) : c.editKind === "multiselect" ? (
              // A native multi-select: ctrl/cmd-click (or shift-click for a range) toggles
              // options, same interaction every OS trains users on for a multi-select list. The
              // selected values join back into the same comma-separated-codes string Dataverse's
              // Web API expects to receive on write, mirroring the shape it returns on read.
              <select
                autoFocus
                multiple
                value={String(rawValue ?? "")
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean)}
                onChange={(e) =>
                  onEditCell?.(row.id, c.key, Array.from(e.target.selectedOptions, (o) => o.value).join(","))
                }
                onBlur={() => onDeactivateCell(row.id, c.key)}
                className={`${inputCls} h-24`}
              >
                {c.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : c.editKind === "boolean" ? (
              <select
                autoFocus
                value={String(rawValue ?? "")}
                onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                onBlur={() => onDeactivateCell(row.id, c.key)}
                className={inputCls}
              >
                <option value="" />
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            ) : c.editKind === "number" ? (
              <input
                autoFocus
                type="number"
                value={String(rawValue ?? "")}
                onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                onBlur={() => onDeactivateCell(row.id, c.key)}
                className={inputCls}
              />
            ) : c.editKind === "date" ? (
              <input
                autoFocus
                type="date"
                // Best-effort: Dataverse can report a DateTime value in the org's local time zone
                // or as UTC depending on the attribute's DateTimeBehavior (Date Only/User Local/
                // Time-Zone Independent), which this app doesn't fetch anywhere — slicing the
                // first 10 chars of whatever ISO-ish string comes back is right for the common
                // "Date Only" case and close enough (may be off by the local UTC offset right
                // around midnight) for the other two, same honest scope limit as this grid's date
                // *filter* already documents for fiscal-period conditions.
                value={String(rawValue ?? "").slice(0, 10)}
                onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                onBlur={() => onDeactivateCell(row.id, c.key)}
                className={inputCls}
              />
            ) : (
              <input
                autoFocus
                type="text"
                value={String(rawValue ?? "")}
                onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                onBlur={() => onDeactivateCell(row.id, c.key)}
                className={inputCls}
              />
            )}
          </td>
        );
      })}
      {rightSpacerWidth > 0 && <td aria-hidden="true" style={{ width: rightSpacerWidth }} />}
    </tr>
  );
});

/** The header row, split out and `memo`-wrapped for the same reason as `GridRowView` above — its
 *  content (the column list/widths) has nothing to do with which rows are scrolled into view, but
 *  living inline in CheckableGrid's own render meant it got recreated (all 150-280 `<th>`s, each
 *  with its own resize-handle closure) on every one of the re-renders vertical scrolling causes,
 *  same as the rows did before they were split out — see bugs & requirements/8.19.md #6. */
const GridHeader = memo(function GridHeader({
  visibleColumns,
  leftSpacerWidth,
  rightSpacerWidth,
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
  showRowCheckbox,
}: {
  /** Same horizontally-windowed slice GridRowView renders — see its own doc comment. The header
   *  and every row share one column virtualizer instance (CheckableGrid below), so they always
   *  agree on exactly which columns are "in view" within a given render/scroll frame; that's what
   *  keeps header and body cells aligned under `table-layout: fixed` despite neither side ever
   *  rendering the full column list. */
  visibleColumns: GridColumn[];
  leftSpacerWidth: number;
  rightSpacerWidth: number;
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
  showRowCheckbox: boolean;
}) {
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
        {showRowCheckbox && (
          <th className="px-3 py-2" style={{ width: CHECKBOX_COLUMN_WIDTH_PX }}>
            <input type="checkbox" checked={allRowsChecked} onChange={onToggleAllRows} />
          </th>
        )}
        {leftSpacerWidth > 0 && <th aria-hidden="true" style={{ width: leftSpacerWidth }} />}
        {visibleColumns.map((c) => {
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
                  aria-label={`列 ${c.key} 的排序/筛选菜单`}
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
        {rightSpacerWidth > 0 && <th aria-hidden="true" style={{ width: rightSpacerWidth }} />}
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
  showRowCheckbox = true,
}: {
  columns: GridColumn[];
  rows: GridRow[];
  onColumnsChange: (columns: GridColumn[]) => void;
  onRowsChange: (rows: GridRow[]) => void;
  /** Only needed when at least one column is `editable` — omit for a read-only grid. */
  /** `label` is only ever passed for a "lookup" cell edited via the 🔍 search-and-pick modal
   *  (LookupPickerModal's own `onPick` already resolves the picked record's display name for
   *  free) — the caller should store it as that row's new `formattedValues[columnKey]` so the
   *  cell shows the picked record's name immediately instead of falling back to its raw GUID
   *  until the next full reload. Absent for every other edit path (typing/pasting a raw GUID
   *  directly, any other editKind) — the caller should then *clear* any existing
   *  `formattedValues[columnKey]` for that field rather than leaving it as-is, since a stale
   *  label from before the edit would now be paired with a different raw value and show a name
   *  that doesn't match what's actually about to be submitted. */
  onEditCell?: (rowId: string, columnKey: string, value: string, label?: string) => void;
  columnsLabel?: string;
  renderColumnBadge?: (column: GridColumn) => ReactNode;
  /** Only needed when at least one column is `editKind: "lookup"` — the row's own table and the
   *  connection to search it against, passed straight through to `LookupPickerModal`. */
  connectionId?: string;
  entityLogicalName?: string;
  /** Set to false for a plain query-result display with no "select rows for a bulk action"
   *  concept (e.g. SQL4CDS/FetchXML Builder's SELECT results) — hides the row/select-all checkbox
   *  column but keeps every other CheckableGrid feature (sort, Filter by, column show/hide,
   *  per-type cell editors when `editable` is set). Every existing caller that imports/copies/
   *  migrates rows keeps the checkbox (default true) — this is purely additive. */
  showRowCheckbox?: boolean;
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
  const checkedRowCount = rows.filter((r) => r.checked).length;
  const [lookupEditorCell, setLookupEditorCell] = useState<{ rowId: string; columnKey: string } | null>(null);
  // Which single cell (if any) is currently showing a real editor instead of its cheap span — see
  // the click-to-edit block comment above GridRowView. Deliberately not per-row state: a click
  // activating a cell in row B must be able to deactivate whatever was active in row A too, and
  // one shared piece of state is the simplest way to guarantee "at most one real control at a
  // time" without the two rows needing to coordinate directly.
  const [activeCell, setActiveCell] = useState<{ rowId: string; columnKey: string } | null>(null);

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

  // Row virtualization alone bounds *mounted rows*, but every mounted row still rendered all of
  // `checkedColumns` regardless of horizontal scroll position — on a product-class entity (150-280
  // columns) that's still thousands of real <td>s laid out and painted at once, scaling with column
  // count independent of how many are actually inside the horizontal scroll port. Same spacer-cell
  // technique as the row virtualizer above, turned 90 degrees: only mount the columns in/near the
  // horizontal viewport, with one filler <td>/<th> on each side standing in for the rest.
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: checkedColumns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => checkedColumns[index]?.width ?? DEFAULT_COLUMN_WIDTH_PX,
    overscan: 4,
  });
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const leftColumnSpacerWidth = virtualColumns.length > 0 ? virtualColumns[0].start : 0;
  const rightColumnSpacerWidth =
    virtualColumns.length > 0 ? columnVirtualizer.getTotalSize() - virtualColumns[virtualColumns.length - 1].end : 0;
  const visibleColumns = useMemo(() => virtualColumns.map((vc) => checkedColumns[vc.index]), [virtualColumns, checkedColumns]);

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
  const activateCell = useCallback((rowId: string, columnKey: string) => setActiveCell({ rowId, columnKey }), []);
  // Guarded by a functional update that only clears the cell it was called for — a blur firing
  // for the *previously* active cell must not clobber a newer activation that already landed
  // (e.g. the DOM blur/focusout a removed input emits can arrive after the click that activated
  // a different cell already updated state), so this only ever nulls out a match to itself.
  const deactivateCell = useCallback(
    (rowId: string, columnKey: string) =>
      setActiveCell((prev) => (prev?.rowId === rowId && prev?.columnKey === columnKey ? null : prev)),
    [],
  );
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
                共 {rows.length} 行（筛选后 {displayRows.length} 行）
                {showRowCheckbox && <>，已选 {checkedRowCount} 行</>}
              </>
            ) : (
              <>
                共 {rows.length} 行
                {showRowCheckbox && <>，已选 {checkedRowCount} 行</>}
              </>
            )}
          </div>
          <table className="w-full table-fixed text-left text-sm">
            <GridHeader
              visibleColumns={visibleColumns}
              leftSpacerWidth={leftColumnSpacerWidth}
              rightSpacerWidth={rightColumnSpacerWidth}
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
              showRowCheckbox={showRowCheckbox}
            />
            <tbody>
              {topSpacerHeight > 0 && (
                <tr style={{ height: topSpacerHeight }} aria-hidden="true">
                  {/* Deliberately oversized: with column virtualization a normal row now has up to
                   *  checkedColumns.length + 3 cells (checkbox + 2 spacers + visible columns), and
                   *  a colSpan longer than the table's actual column tracks is simply clamped by
                   *  the browser — safer than trying to keep this in exact lockstep with whatever
                   *  the column window happens to be on a given render. */}
                  <td colSpan={checkedColumns.length + (showRowCheckbox ? 3 : 2)} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = displayRows[virtualRow.index];
                // A plain string (or null), not the raw `activeCell` object — so a row that isn't
                // the active one keeps getting the exact same `null` value across renders, and
                // `memo` can actually tell "nothing changed for me" apart from "some other row's
                // active cell changed".
                const activeColumnKey = activeCell?.rowId === row.id ? activeCell.columnKey : null;
                return (
                  <GridRowView
                    key={row.id}
                    row={row}
                    visibleColumns={visibleColumns}
                    leftSpacerWidth={leftColumnSpacerWidth}
                    rightSpacerWidth={rightColumnSpacerWidth}
                    activeColumnKey={activeColumnKey}
                    onEditCell={onEditCell}
                    onToggleRow={toggleRow}
                    onActivateCell={activateCell}
                    onDeactivateCell={deactivateCell}
                    onOpenLookupEditor={openLookupEditor}
                    connectionId={connectionId}
                    entityLogicalName={entityLogicalName}
                    showRowCheckbox={showRowCheckbox}
                  />
                );
              })}
              {bottomSpacerHeight > 0 && (
                <tr style={{ height: bottomSpacerHeight }} aria-hidden="true">
                  <td colSpan={checkedColumns.length + (showRowCheckbox ? 3 : 2)} />
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
          onPick={(value, label) => {
            onEditCell?.(lookupEditorCell.rowId, lookupEditorCell.columnKey, value, label || undefined);
            setLookupEditorCell(null);
          }}
          onClose={() => setLookupEditorCell(null)}
        />
      )}
    </div>
  );
}
