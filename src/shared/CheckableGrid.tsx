import type { ReactNode } from "react";
import AttributePicker from "./AttributePicker";

export interface GridColumn {
  key: string;
  checked: boolean;
  /** When true, a checked row's cell for this column renders an input/select instead of plain
   *  text — the caller owns what the edited value means (e.g. converting a Picklist option back
   *  to a number before writing); this component only ever hands back the raw string a native
   *  `<input>`/`<select>` produced. */
  editable?: boolean;
  editKind?: "text" | "select";
  /** Required when editKind is "select" — `value` is always a string (native `<option>` values
   *  always are), even for a numeric-backed Picklist option; the caller converts back. */
  options?: { value: string; label: string }[];
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
}: {
  columns: GridColumn[];
  rows: GridRow[];
  onColumnsChange: (columns: GridColumn[]) => void;
  onRowsChange: (rows: GridRow[]) => void;
  /** Only needed when at least one column is `editable` — omit for a read-only grid. */
  onEditCell?: (rowId: string, columnKey: string, value: string) => void;
  columnsLabel?: string;
  renderColumnBadge?: (column: GridColumn) => ReactNode;
}) {
  const checkedColumns = columns.filter((c) => c.checked);
  const allRowsChecked = rows.length > 0 && rows.every((r) => r.checked);
  const checkedRowCount = rows.filter((r) => r.checked).length;

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
                  <th key={c.key} className="whitespace-nowrap px-3 py-2 font-mono">
                    {c.key}
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
                  {checkedColumns.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                      {c.editable && c.editKind === "select" ? (
                        <select
                          value={String(row.values[c.key] ?? "")}
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
                      ) : c.editable ? (
                        <input
                          type="text"
                          value={String(row.values[c.key] ?? "")}
                          onChange={(e) => onEditCell?.(row.id, c.key, e.target.value)}
                          className={inputCls}
                        />
                      ) : typeof row.values[c.key] === "object" ? (
                        JSON.stringify(row.values[c.key])
                      ) : (
                        String(row.values[c.key] ?? "")
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
