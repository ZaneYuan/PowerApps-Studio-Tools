import type { ImportTable } from "./types";

/** One tab's content: a column checklist (which fields get written) plus a row table (which
 *  records get written) — the same "row checkbox grid" interaction the tool's very first version
 *  had, just now fed by either a live query or a parsed SQL file instead of only a live query. */
export default function ImportTableView({ table, onChange }: { table: ImportTable; onChange: (next: ImportTable) => void }) {
  const checkedColumns = table.columns.filter((c) => c.checked);
  const allRowsChecked = table.rows.length > 0 && table.rows.every((r) => r.checked);

  function toggleColumn(logicalName: string) {
    onChange({
      ...table,
      columns: table.columns.map((c) => (c.logicalName === logicalName ? { ...c, checked: !c.checked } : c)),
    });
  }

  function toggleRow(id: string) {
    onChange({ ...table, rows: table.rows.map((r) => (r.id === id ? { ...r, checked: !r.checked } : r)) });
  }

  function toggleAllRows() {
    const next = !allRowsChecked;
    onChange({ ...table, rows: table.rows.map((r) => ({ ...r, checked: next })) });
  }

  const checkedRowCount = table.rows.filter((r) => r.checked).length;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">要迁移的列（勾选）</div>
        <div className="flex max-h-28 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-gray-200 p-2 text-xs dark:border-gray-800">
          {table.columns.map((c) => (
            <label key={c.logicalName} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={c.checked} onChange={() => toggleColumn(c.logicalName)} />
              <span className="font-mono">{c.logicalName}</span>
              {c.attributeType === "Lookup" && <span className="text-purple-500 dark:text-purple-400">(Lookup)</span>}
            </label>
          ))}
        </div>
      </div>

      <div className="max-h-[45vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
          共 {table.rows.length} 行，已选 {checkedRowCount} 行
        </div>
        <table className="w-full text-left text-sm">
          <thead className="sticky top-[29px] z-10 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">
                <input type="checkbox" checked={allRowsChecked} onChange={toggleAllRows} />
              </th>
              {checkedColumns.map((c) => (
                <th key={c.logicalName} className="whitespace-nowrap px-3 py-2 font-mono">
                  {c.logicalName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={row.checked} onChange={() => toggleRow(row.id)} />
                </td>
                {checkedColumns.map((c) => (
                  <td key={c.logicalName} className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                    {typeof row.values[c.logicalName] === "object"
                      ? JSON.stringify(row.values[c.logicalName])
                      : String(row.values[c.logicalName] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
