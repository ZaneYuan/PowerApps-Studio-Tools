import { useMemo, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { labelOf } from "../metadata-browser/types";
import { fetchEntityMeta, fetchScalarAttributes, importRow, queryRows } from "./dataverseOps";
import type { AttributeInfo, EntityMeta, RowImportStatus } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

const TOP_OPTIONS = [25, 50, 100, 250, 500];

const STATUS_LABELS: Record<RowImportStatus["state"], string> = {
  pending: "",
  importing: "导入中…",
  success: "✅ 成功",
  error: "❌ 失败",
};

export default function DataMigration() {
  const { activeConnectionId, connections } = useActiveConnection();

  const [entityName, setEntityName] = useState("");
  const [entityMeta, setEntityMeta] = useState<EntityMeta | null>(null);
  const [attributes, setAttributes] = useState<AttributeInfo[] | null>(null);
  const [columnsError, setColumnsError] = useState<string | null>(null);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());

  const [filter, setFilter] = useState("");
  const [top, setTop] = useState(50);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  const [targetConnectionId, setTargetConnectionId] = useState<string>("");
  const [importStatuses, setImportStatuses] = useState<Record<string, RowImportStatus>>({});
  const [importing, setImporting] = useState(false);

  async function handleLoadColumns() {
    if (!activeConnectionId || !entityName.trim()) return;
    setColumnsLoading(true);
    setColumnsError(null);
    setEntityMeta(null);
    setAttributes(null);
    setRows(null);
    setImportStatuses({});
    try {
      const name = entityName.trim();
      const [meta, attrs] = await Promise.all([
        fetchEntityMeta(activeConnectionId, name),
        fetchScalarAttributes(activeConnectionId, name),
      ]);
      setEntityMeta(meta);
      setAttributes(attrs);
      setSelectedColumns(new Set(attrs.filter((a) => a.IsPrimaryId).map((a) => a.LogicalName)));
    } catch (err) {
      setColumnsError(err instanceof Error ? err.message : String(err));
    } finally {
      setColumnsLoading(false);
    }
  }

  function toggleColumn(logicalName: string) {
    setSelectedColumns((s) => {
      const next = new Set(s);
      if (next.has(logicalName)) next.delete(logicalName);
      else next.add(logicalName);
      return next;
    });
  }

  async function handleQuery() {
    if (!activeConnectionId || !entityMeta) return;
    setQueryLoading(true);
    setQueryError(null);
    setRows(null);
    setSelectedRowIds(new Set());
    setImportStatuses({});
    try {
      const data = await queryRows(
        activeConnectionId,
        entityMeta.entitySetName,
        entityMeta.primaryIdAttribute,
        Array.from(selectedColumns),
        filter,
        top,
      );
      setRows(data);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueryLoading(false);
    }
  }

  function rowId(row: Record<string, unknown>): string {
    return String(row[entityMeta!.primaryIdAttribute]);
  }

  function toggleRow(id: string) {
    setSelectedRowIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllRows() {
    if (!rows) return;
    setSelectedRowIds((s) => (s.size === rows.length ? new Set() : new Set(rows.map(rowId))));
  }

  async function handleImport() {
    if (!entityMeta || !targetConnectionId || selectedRowIds.size === 0) return;
    setImporting(true);
    const columns = Array.from(selectedColumns);
    const targetRows = (rows ?? []).filter((r) => selectedRowIds.has(rowId(r)));

    for (const row of targetRows) {
      const id = rowId(row);
      setImportStatuses((s) => ({ ...s, [id]: { state: "importing" } }));
      try {
        await importRow(targetConnectionId, entityMeta.entitySetName, row, columns);
        setImportStatuses((s) => ({ ...s, [id]: { state: "success" } }));
      } catch (err) {
        setImportStatuses((s) => ({
          ...s,
          [id]: { state: "error", error: err instanceof Error ? err.message : String(err) },
        }));
      }
    }
    setImporting(false);
  }

  const summary = useMemo(() => {
    const values = Object.values(importStatuses);
    if (values.length === 0) return null;
    const success = values.filter((v) => v.state === "success").length;
    const error = values.filter((v) => v.state === "error").length;
    return { success, error, total: values.length };
  }, [importStatuses]);

  const displayColumns = entityMeta ? [entityMeta.primaryIdAttribute, ...Array.from(selectedColumns).filter((c) => c !== entityMeta.primaryIdAttribute)] : [];

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  if (!activeConnectionId) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        请先在左侧侧边栏顶部选择一个"当前连接"（数据来源），没有连接的话先去"我的连接"里添加。
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        从当前连接查询一张表的数据，勾选行 + 列（含主键 ID，用于保留原始记录 id），导入到任意一个已保存的连接。只支持标量字段——Lookup / Owner /
        Customer 等关联类型字段不在可选列表里（跨环境的关联记录 id 通常对不上，v1 不处理）。
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">源实体 (entity logical name)</label>
          <input
            type="text"
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            placeholder="account"
            className={`${inputCls} w-48`}
          />
        </div>
        <button
          onClick={handleLoadColumns}
          disabled={!entityName.trim() || columnsLoading}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {columnsLoading ? "加载中…" : "加载字段"}
        </button>
        {entityMeta && (
          <span className="text-xs text-gray-400">
            EntitySetName: <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">{entityMeta.entitySetName}</code>
          </span>
        )}
      </div>

      {columnsError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {columnsError}
        </p>
      )}

      {attributes && (
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            要迁移的列（勾选，主键默认已勾选）
          </div>
          <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto text-xs">
            {attributes.map((a) => (
              <label key={a.LogicalName} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selectedColumns.has(a.LogicalName)}
                  onChange={() => toggleColumn(a.LogicalName)}
                  disabled={a.IsPrimaryId}
                />
                <span className="font-mono">{a.LogicalName}</span>
                {a.IsPrimaryId && <span className="text-gray-400">(ID)</span>}
                <span className="text-gray-400">{labelOf(a.DisplayName, "")}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {entityMeta && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">$filter（可选，原始 OData 表达式）</label>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="statecode eq 0"
              className={`${inputCls} w-full font-mono`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">最多取</label>
            <select value={top} onChange={(e) => setTop(Number(e.target.value))} className={inputCls}>
              {TOP_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} 条
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleQuery}
            disabled={selectedColumns.size === 0 || queryLoading}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {queryLoading ? "查询中…" : "查询"}
          </button>
        </div>
      )}

      {queryError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {queryError}
        </p>
      )}

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 text-xs dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">
              查到 {rows.length} 行，已选 {selectedRowIds.size} 行 → 目标连接：
            </span>
            <select
              value={targetConnectionId}
              onChange={(e) => setTargetConnectionId(e.target.value)}
              className={inputCls}
            >
              <option value="">选择目标连接…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleImport}
              disabled={!targetConnectionId || selectedRowIds.size === 0 || importing}
              className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {importing ? "导入中…" : `导入选中的 ${selectedRowIds.size} 行`}
            </button>
            {summary && (
              <span className="text-gray-500 dark:text-gray-400">
                本次结果：成功 {summary.success} / 失败 {summary.error}（共 {summary.total}）
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedRowIds.size === rows.length}
                      onChange={toggleAllRows}
                    />
                  </th>
                  {displayColumns.map((c) => (
                    <th key={c} className="px-3 py-2 font-mono">
                      {c}
                    </th>
                  ))}
                  <th className="px-3 py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = rowId(row);
                  const status = importStatuses[id];
                  return (
                    <tr key={id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={selectedRowIds.has(id)} onChange={() => toggleRow(id)} />
                      </td>
                      {displayColumns.map((c) => (
                        <td key={c} className="px-3 py-1.5 font-mono text-xs">
                          {typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c] ?? "")}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-xs">
                        {status && (
                          <span title={status.error}>{STATUS_LABELS[status.state]}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
