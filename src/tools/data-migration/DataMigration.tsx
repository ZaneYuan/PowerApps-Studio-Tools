import { useCallback, useMemo, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { downloadTextFile } from "../../native/download";
import { labelOf } from "../metadata-browser/types";
import ConditionGroupsEditor from "./ConditionGroupsEditor";
import OrderClausesEditor from "./OrderClausesEditor";
import { fetchEntityMeta, fetchMigratableAttributes, importRow, queryRows } from "./dataverseOps";
import { buildFilter, buildOrderBy, validateConditions } from "./filterBuild";
import { buildImportLogText, importLogFilename, type ImportLogEntry } from "./importLog";
import { buildInsertSql } from "./sqlGen";
import { newConditionGroup, type AttributeInfo, type ConditionGroup, type EntityMeta, type LogicOp, type OrderClause, type RowImportStatus } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

const TOP_OPTIONS = [25, 50, 100, 250, 500, 1000, 2500, 5000];

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
  const [columnQuery, setColumnQuery] = useState("");
  const [showCheckedColumns, setShowCheckedColumns] = useState(true);
  const [showUncheckedColumns, setShowUncheckedColumns] = useState(true);

  const [conditionGroups, setConditionGroups] = useState<ConditionGroup[]>([newConditionGroup()]);
  const [topLogic, setTopLogic] = useState<LogicOp>("and");
  const [orders, setOrders] = useState<OrderClause[]>([]);
  const filter = useMemo(() => buildFilter(conditionGroups, topLogic), [conditionGroups, topLogic]);
  const orderBy = useMemo(() => buildOrderBy(orders), [orders]);
  const filterWarnings = useMemo(() => validateConditions(conditionGroups), [conditionGroups]);
  const [top, setTop] = useState(50);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  const [targetConnectionId, setTargetConnectionId] = useState<string>("");
  const [importStatuses, setImportStatuses] = useState<Record<string, RowImportStatus>>({});
  const [importing, setImporting] = useState(false);
  const [lastLog, setLastLog] = useState<{ filename: string; text: string } | null>(null);
  const [showSqlPreview, setShowSqlPreview] = useState(false);

  async function handleLoadColumns() {
    if (!activeConnectionId || !entityName.trim()) return;
    setColumnsLoading(true);
    setColumnsError(null);
    setEntityMeta(null);
    setAttributes(null);
    setColumnQuery("");
    setRows(null);
    setImportStatuses({});
    try {
      const name = entityName.trim();
      const [meta, attrs] = await Promise.all([
        fetchEntityMeta(activeConnectionId, name),
        fetchMigratableAttributes(activeConnectionId, name),
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
    setShowSqlPreview(false);
    try {
      const lookupColumns = new Set(
        (attributes ?? []).filter((a) => a.AttributeType === "Lookup").map((a) => a.LogicalName),
      );
      const data = await queryRows(
        activeConnectionId,
        entityMeta.entitySetName,
        entityMeta.primaryIdAttribute,
        Array.from(selectedColumns),
        lookupColumns,
        filter,
        orderBy,
        top,
      );
      setRows(data);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueryLoading(false);
    }
  }

  const rowId = useCallback(
    (row: Record<string, unknown>): string => String(row[entityMeta!.primaryIdAttribute]),
    [entityMeta],
  );

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
    const entityLogicalName = entityName.trim();
    const startedAt = new Date();
    const logEntries: ImportLogEntry[] = [];

    for (const row of targetRows) {
      const id = rowId(row);
      setImportStatuses((s) => ({ ...s, [id]: { state: "importing" } }));
      try {
        await importRow(targetConnectionId, entityLogicalName, entityMeta.entitySetName, entityMeta.primaryIdAttribute, row, columns);
        setImportStatuses((s) => ({ ...s, [id]: { state: "success" } }));
        logEntries.push({ id, state: "success" });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        setImportStatuses((s) => ({ ...s, [id]: { state: "error", error } }));
        logEntries.push({ id, state: "error", error });
      }
    }

    const finishedAt = new Date();
    const filename = importLogFilename(entityLogicalName, finishedAt);
    const text = buildImportLogText({
      startedAt,
      finishedAt,
      sourceConnectionName: connections.find((c) => c.id === activeConnectionId)?.name ?? activeConnectionId ?? "",
      targetConnectionName: connections.find((c) => c.id === targetConnectionId)?.name ?? targetConnectionId,
      entityLogicalName,
      entitySetName: entityMeta.entitySetName,
      columns,
      entries: logEntries,
    });
    setLastLog({ filename, text });
    downloadTextFile(filename, text);

    setImporting(false);
  }

  const summary = useMemo(() => {
    const values = Object.values(importStatuses);
    if (values.length === 0) return null;
    const success = values.filter((v) => v.state === "success").length;
    const error = values.filter((v) => v.state === "error").length;
    return { success, error, total: values.length };
  }, [importStatuses]);

  const displayColumns = useMemo(
    () =>
      entityMeta
        ? [entityMeta.primaryIdAttribute, ...Array.from(selectedColumns).filter((c) => c !== entityMeta.primaryIdAttribute)]
        : [],
    [entityMeta, selectedColumns],
  );

  const filteredAttributes = useMemo(() => {
    if (!attributes) return [];
    const q = columnQuery.trim().toLowerCase();
    return attributes.filter((a) => {
      if (q && !a.LogicalName.toLowerCase().includes(q) && !labelOf(a.DisplayName, "").toLowerCase().includes(q)) {
        return false;
      }
      return selectedColumns.has(a.LogicalName) ? showCheckedColumns : showUncheckedColumns;
    });
  }, [attributes, columnQuery, selectedColumns, showCheckedColumns, showUncheckedColumns]);

  // SQL4CDS's INSERT parser needs each column's real Dataverse attribute type to know whether a
  // value should render as a bare number/0-1 or a quoted string literal — see sqlGen.ts.
  const attributeTypeByLogicalName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of attributes ?? []) map.set(a.LogicalName.toLowerCase(), a.AttributeType);
    return map;
  }, [attributes]);

  const generatedSql = useMemo(() => {
    if (!entityMeta || !rows || selectedRowIds.size === 0) return "";
    const targetRows = rows.filter((r) => selectedRowIds.has(rowId(r)));
    return buildInsertSql(entityName.trim(), displayColumns, attributeTypeByLogicalName, targetRows);
  }, [entityMeta, rows, selectedRowIds, displayColumns, attributeTypeByLogicalName, entityName, rowId]);

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
        请先在左侧侧边栏顶部选择一个"我的连接"（数据来源），没有连接的话先去"我的连接"里添加。
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        从当前连接查询一张表的数据，勾选行 + 列，导入到任意一个已保存的连接。**默认按 GUID 匹配更新导入**：目标环境已存在同 ID
        记录就只更新勾选的字段，不存在就用这个 ID 新建一条——主键 ID 始终用于匹配，不用单独勾选。支持标量字段和单目标 Lookup
        字段（按目标连接自己的 schema 解析 `@odata.bind`）——Owner / Customer / PartyList 等多态关联字段仍不支持。选 Lookup
        字段的前提是两边环境这个字段指向的记录 ID 一致，不一致会在写入这一行时报错，不会静默出错数据。每次导入结束会自动下载一份
        .txt 执行日志。查到数据后除了直接导入，也可以对勾选的行生成一段 SQL4CDS 可读的 INSERT 语句，复制到 SQL4CDS 工具里对着任意连接执行。
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
          <input
            type="text"
            placeholder="搜索字段…"
            value={columnQuery}
            onChange={(e) => setColumnQuery(e.target.value)}
            className={`${inputCls} mb-1.5 w-full`}
          />
          <div className="mb-1.5 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={showCheckedColumns} onChange={(e) => setShowCheckedColumns(e.target.checked)} />
              已勾选
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={showUncheckedColumns} onChange={(e) => setShowUncheckedColumns(e.target.checked)} />
              未勾选
            </label>
          </div>
          <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto text-xs">
            {filteredAttributes.length === 0 && <p className="text-gray-400">没有匹配的字段。</p>}
            {filteredAttributes.map((a) => (
              <label key={a.LogicalName} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selectedColumns.has(a.LogicalName)}
                  onChange={() => toggleColumn(a.LogicalName)}
                  disabled={a.IsPrimaryId}
                />
                <span className="font-mono">{a.LogicalName}</span>
                {a.IsPrimaryId && <span className="text-gray-400">(ID)</span>}
                {a.AttributeType === "Lookup" && <span className="text-purple-500 dark:text-purple-400">(Lookup)</span>}
                <span className="text-gray-400">{labelOf(a.DisplayName, "")}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">已选择 {selectedColumns.size} 个字段</p>
        </div>
      )}

      {entityMeta && (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div>
            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">过滤条件（可选）</div>
            <ConditionGroupsEditor
              groups={conditionGroups}
              topLogic={topLogic}
              onGroupsChange={setConditionGroups}
              onTopLogicChange={setTopLogic}
            />
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">排序（可选）</div>
            <OrderClausesEditor orders={orders} onChange={setOrders} />
          </div>

          {filterWarnings.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              {filterWarnings.map((w, i) => (
                <div key={i}>⚠ {w.message}</div>
              ))}
            </div>
          )}

          {(filter || orderBy) && (
            <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
              {filter && `$filter=${filter}`}
              {filter && orderBy && "\n"}
              {orderBy && `$orderby=${orderBy}`}
            </pre>
          )}

          <div className="flex flex-wrap items-end gap-2">
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
            <button
              onClick={() => setShowSqlPreview((v) => !v)}
              disabled={selectedRowIds.size === 0}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {showSqlPreview ? "隐藏 SQL 语句" : "生成 SQL 语句"}
            </button>
            {summary && (
              <span className="text-gray-500 dark:text-gray-400">
                本次结果：成功 {summary.success} / 失败 {summary.error}（共 {summary.total}）
              </span>
            )}
            {lastLog && (
              <button
                onClick={() => downloadTextFile(lastLog.filename, lastLog.text)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                重新下载执行日志 (.txt)
              </button>
            )}
          </div>

          {showSqlPreview && generatedSql && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  SQL4CDS 可读的 INSERT 语句（{selectedRowIds.size} 行）
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(generatedSql)}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  复制
                </button>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                {generatedSql}
              </pre>
            </div>
          )}

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
