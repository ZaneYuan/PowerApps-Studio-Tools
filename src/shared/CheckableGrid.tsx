import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import AttributePicker from "./AttributePicker";
import LookupPickerModal from "./LookupPickerModal";

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
  const checkedColumns = columns.filter((c) => c.checked);
  const allRowsChecked = rows.length > 0 && rows.every((r) => r.checked);
  const checkedRowCount = rows.filter((r) => r.checked).length;
  const [lookupEditorCell, setLookupEditorCell] = useState<{ rowId: string; columnKey: string } | null>(null);

  function toggleColumn(key: string) {
    onColumnsChange(columns.map((c) => (c.key === key ? { ...c, checked: !c.checked } : c)));
  }
  function toggleRow(id: string) {
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, checked: !r.checked } : r)));
  }
  function toggleAllRows() {
    const next = !allRowsChecked;
    onRowsChange(rows.map((r) => ({ ...r, checked: next })));
  }

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
        options={columns.map((c) => c.key)}
        selected={new Set(checkedColumns.map((c) => c.key))}
        onToggle={toggleColumn}
        renderBadge={(key) => {
          const column = columns.find((c) => c.key === key);
          return column && renderColumnBadge?.(column);
        }}
      />

      <div className="max-h-[45vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
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
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-1.5">
                    <input type="checkbox" checked={row.checked} onChange={() => toggleRow(row.id)} />
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
                          <select
                            value={String(rawValue ?? "")}
                            onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                            className={inputCls}
                          >
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
                              onClick={() => setLookupEditorCell({ rowId: row.id, columnKey: c.key })}
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
              ))}
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
