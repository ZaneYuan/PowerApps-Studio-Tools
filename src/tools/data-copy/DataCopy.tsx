import { useRef, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { downloadTextFile } from "../../native/download";
import {
  fetchAttributes,
  fetchDefaultViewColumnOrder,
  fetchEntityMeta,
  fetchOptionSetValues,
  isSystemAuditField,
  sortColumnsForDisplay,
} from "../../native/metadataService";
import { runConcurrent } from "../sql4cds/concurrency";
import { parseSql, type SelectComplexResult, type SelectSimpleResult } from "../sql4cds/translate";
import { insertRow } from "../sql4cds/writeOps";
import { buildSql4CdsLogText, sql4CdsLogFilename, type Sql4CdsLogEntry } from "../sql4cds/executionLog";
import SqlEditor from "../../shared/SqlEditor";
import CheckableGrid, { type GridColumn, type GridRow } from "../../shared/CheckableGrid";

const SAMPLE = `SELECT name, description FROM account WHERE statecode = 0`;

function buildSelectPath(result: SelectSimpleResult | SelectComplexResult, entitySet: string): string {
  if (result.kind === "select-complex") return `${entitySet}?fetchXml=${encodeURIComponent(result.fetchXml)}`;
  const parts: string[] = [];
  if (result.select) parts.push(`$select=${result.select}`);
  if (result.filter) parts.push(`$filter=${result.filter}`);
  if (result.orderby) parts.push(`$orderby=${result.orderby}`);
  if (result.top) parts.push(`$top=${result.top}`);
  return parts.length ? `${entitySet}?${parts.join("&")}` : entitySet;
}

/** Keeps the SQL box's SELECT column list in sync with the checkbox grid instead of leaving a
 *  stale `*` (or a stale explicit list) once columns get checked/unchecked — text-replaces just
 *  the column list between `SELECT [TOP n]` and `FROM`, leaving WHERE/ORDER BY/casing/whitespace
 *  untouched, rather than re-serializing a full parsed statement back to SQL (translate.ts has no
 *  such serializer, and doesn't need one just for this). No-ops (returns the input unchanged) when
 *  there are no checked columns — an empty SELECT list isn't valid SQL, and the user still needs
 *  to see/fix the query rather than have it silently mangled. Only ever called on a query that
 *  already passed handleRunQuery's select-simple-only check, so the shape is always exactly
 *  `SELECT [TOP n] <cols> FROM ...`. */
function replaceSelectColumns(sqlText: string, columnNames: string[]): string {
  if (columnNames.length === 0) return sqlText;
  const columnList = columnNames.join(", ");
  return sqlText.replace(/^(\s*SELECT\s+(?:TOP\s+\d+\s+)?)([\s\S]*?)(\s+FROM\s)/i, (_m, pre: string, _cols: string, post: string) => `${pre}${columnList}${post}`);
}

/** Dataverse returns a Lookup column as `_logicalname_value` (with `@...` annotations alongside)
 *  — unwrap to the plain attribute name, same convention every other write tool here uses. */
function unwrapRow(row: Record<string, unknown>): Record<string, unknown> {
  const unwrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.includes("@")) continue;
    const plain = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -"_value".length) : key;
    unwrapped[plain] = value;
  }
  return unwrapped;
}

export default function DataCopy() {
  const { activeConnectionId, connections } = useActiveConnection();

  const [sql, setSql] = useState("");
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [entityLogicalName, setEntityLogicalName] = useState<string | null>(null);
  const [entitySetName, setEntitySetName] = useState("");
  const [primaryIdAttribute, setPrimaryIdAttribute] = useState("");
  const [columns, setColumns] = useState<GridColumn[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);

  const [writeRunning, setWriteRunning] = useState(false);
  const [writeResults, setWriteResults] = useState<Sql4CdsLogEntry[] | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeConcurrency, setWriteConcurrency] = useState(8);
  const stopRequestedRef = useRef(false);
  const [writeStopped, setWriteStopped] = useState(false);

  function connectionName(): string {
    return connections.find((c) => c.id === activeConnectionId)?.name ?? activeConnectionId ?? "";
  }

  async function handleRunQuery() {
    if (!activeConnectionId) return;
    setQueryRunning(true);
    setQueryError(null);
    setWriteResults(null);
    setWriteError(null);
    try {
      const parsed = parseSql(sql);
      if (parsed.kind === "empty") return;
      if (parsed.kind === "error") {
        setQueryError(parsed.error);
        return;
      }
      if (parsed.kind !== "select-simple" && parsed.kind !== "select-complex") {
        setQueryError("请输入一条 SELECT 语句 — 数据复制只用来查询、编辑、再新建，不执行 INSERT/UPDATE/DELETE。");
        return;
      }
      if (parsed.kind === "select-complex") {
        setQueryError("数据复制只支持单表 SELECT，不支持 JOIN / GROUP BY 聚合（结果里的聚合列没法原样复制成新记录）。需要这类查询请用 SQL4CDS。");
        return;
      }

      const meta = await fetchEntityMeta(activeConnectionId, parsed.entityLogicalName);
      const path = buildSelectPath(parsed, meta.entitySetName);
      const res = await callNative<{ value: Record<string, unknown>[] }>("dataverse.request", {
        connectionId: activeConnectionId,
        method: "GET",
        path,
      });
      const unwrapped = res.value.map(unwrapRow);
      const rawColumnNames =
        unwrapped.length > 0 ? Object.keys(unwrapped[0]) : parsed.select ? parsed.select.split(",").map((c) => c.trim()) : [];

      const [attrs, viewOrder] = await Promise.all([
        fetchAttributes(activeConnectionId, parsed.entityLogicalName),
        fetchDefaultViewColumnOrder(activeConnectionId, parsed.entityLogicalName),
      ]);
      const typeByName = new Map(attrs.map((a) => [a.logicalName.toLowerCase(), a.attributeType]));
      // Primary key first, then default-view order, then alphabetical — same ordering Data
      // Migration uses. System/audit columns (createdon, ownerid, statecode, ...) default
      // unchecked: a copy should get its own from the server, not the source row's.
      const columnNames = sortColumnsForDisplay(rawColumnNames, meta.primaryIdAttribute, viewOrder);

      const newColumns: GridColumn[] = [];
      for (const name of columnNames) {
        const attrType = typeByName.get(name.toLowerCase());
        const checked = !isSystemAuditField(name);
        if (attrType === "String" || attrType === "Memo") {
          newColumns.push({ key: name, checked, editable: true, editKind: "text" });
        } else if (attrType === "Picklist") {
          const options = await fetchOptionSetValues(activeConnectionId, parsed.entityLogicalName, name);
          newColumns.push({
            key: name,
            checked,
            editable: true,
            editKind: "select",
            options: options.map((o) => ({ value: String(o.value), label: o.label })),
          });
        } else {
          newColumns.push({ key: name, checked });
        }
      }
      const newRows: GridRow[] = unwrapped.map((r) => ({ id: String(r[meta.primaryIdAttribute]), checked: true, values: r }));

      setEntityLogicalName(parsed.entityLogicalName);
      setEntitySetName(meta.entitySetName);
      setPrimaryIdAttribute(meta.primaryIdAttribute);
      setColumns(newColumns);
      setRows(newRows);
      // Even a `SELECT *` should read back as the actual (now-default) checked column list once
      // it's run, not stay `*` — same sync `handleColumnsChange` below keeps up on every toggle.
      const checkedNames = newColumns.filter((c) => c.checked).map((c) => c.key);
      setSql((prev) => replaceSelectColumns(prev, checkedNames));
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueryRunning(false);
    }
  }

  /** Keeps the SQL box's SELECT list synced to whichever columns are checked right now — every
   *  checkbox toggle, not just the initial query run (see handleRunQuery's own sync for that). */
  function handleColumnsChange(newColumns: GridColumn[]) {
    setColumns(newColumns);
    const checkedNames = newColumns.filter((c) => c.checked).map((c) => c.key);
    setSql((prev) => replaceSelectColumns(prev, checkedNames));
  }

  function handleEditCell(rowId: string, columnKey: string, value: string) {
    const column = columns.find((c) => c.key === columnKey);
    // A Picklist's real value is Edm.Int32 — the shared grid's <select> only ever hands back a
    // string (native <option> values always are), convert back here rather than teaching the
    // generic grid component about Dataverse option-set typing.
    const finalValue: unknown = column?.editKind === "select" ? (value === "" ? null : Number(value)) : value;
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [columnKey]: finalValue } } : r)));
  }

  function handleStop() {
    stopRequestedRef.current = true;
  }

  async function handleCreate() {
    if (!activeConnectionId || !entityLogicalName) return;
    // The primary key column never gets sent, checked or not — a copy always gets a fresh
    // server-generated id, that's the whole point ("主键 id 列不需要赋值").
    const checkedColumns = columns.filter((c) => c.checked && c.key.toLowerCase() !== primaryIdAttribute.toLowerCase());
    const checkedRows = rows.filter((r) => r.checked);
    if (checkedColumns.length === 0 || checkedRows.length === 0) return;
    if (!confirm(`即将在 ${connectionName()} 创建 ${checkedRows.length} 条新的 ${entityLogicalName} 记录，确定吗？`)) return;

    setWriteRunning(true);
    setWriteResults([]);
    setWriteError(null);
    stopRequestedRef.current = false;
    setWriteStopped(false);
    const startedAt = new Date();
    const entries: Sql4CdsLogEntry[] = [];
    let stopped = false;

    try {
      await runConcurrent(
        checkedRows,
        writeConcurrency,
        async (row, i) => {
          const key = `第 ${i + 1} 行（复制自 ${row.id}）`;
          let entry: Sql4CdsLogEntry;
          try {
            const body = Object.fromEntries(checkedColumns.map((c) => [c.key, row.values[c.key] ?? null]));
            const { newId } = await insertRow(activeConnectionId, entityLogicalName, entitySetName, body);
            entry = { key, state: "success", detail: newId ?? undefined };
          } catch (err) {
            entry = { key, state: "error", error: err instanceof Error ? err.message : String(err) };
          }
          entries.push(entry);
          setWriteResults((r) => [...(r ?? []), entry]);
        },
        () => stopRequestedRef.current,
      );
      if (stopRequestedRef.current) {
        stopped = true;
        setWriteStopped(true);
      }

      const finishedAt = new Date();
      const text = buildSql4CdsLogText({
        startedAt,
        finishedAt,
        connectionName: connectionName(),
        action: "insert",
        entityLogicalName,
        entitySetName,
        sql,
        entries,
        stopped,
      });
      downloadTextFile(sql4CdsLogFilename("insert", entityLogicalName, finishedAt), text);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteRunning(false);
    }
  }

  const checkedRowCount = rows.filter((r) => r.checked).length;

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        写一条单表 SELECT 查出要复制的数据（对本页连接执行），结果表格可以直接编辑——v1 支持文本和选项集（Picklist）两种类型的字段编辑，其余类型只读展示。行、列默认全部勾选，改好之后点"创建"，会把勾选的行按当前（编辑后的）值创建成全新记录——主键
        ID 列不会被带上，由 Dataverse 自动生成新的。只支持单表，不支持 JOIN / 聚合。
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">查询（单条 SELECT）</label>
          <button onClick={() => setSql(SAMPLE)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            填充示例
          </button>
        </div>
        <SqlEditor value={sql} onChange={setSql} schema={{}} placeholder="SELECT name, description FROM account WHERE statecode = 0" />
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunQuery}
            disabled={!activeConnectionId || queryRunning}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {queryRunning ? "查询中…" : "执行查询"}
          </button>
          {!activeConnectionId && <span className="text-xs text-gray-400">请先在侧边栏选择一个本页连接。</span>}
        </div>
        {queryError && (
          <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
            {queryError}
          </pre>
        )}
      </div>

      {entityLogicalName && rows.length > 0 && (
        <>
          <CheckableGrid
            columns={columns}
            rows={rows}
            columnsLabel="要复制的列（勾选，文本/选项集字段可直接编辑）"
            onColumnsChange={handleColumnsChange}
            onRowsChange={setRows}
            onEditCell={handleEditCell}
          />

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <button
              onClick={handleCreate}
              disabled={!activeConnectionId || checkedRowCount === 0 || writeRunning}
              className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {writeRunning ? "创建中…" : `创建 ${checkedRowCount} 条新记录`}
            </button>
            {writeRunning && (
              <button
                onClick={handleStop}
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                停止
              </button>
            )}
            <label className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              并发数
              <input
                type="number"
                min={1}
                max={20}
                value={writeConcurrency}
                disabled={writeRunning}
                onChange={(e) => setWriteConcurrency(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-xs disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800"
              />
            </label>
          </div>

          {writeError && (
            <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
              {writeError}
            </pre>
          )}

          {writeResults && writeResults.length > 0 && (
            <div className="max-h-[40vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="inline-block min-w-full align-top">
                <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
                  {writeStopped && <span className="mr-1 font-medium text-amber-600 dark:text-amber-400">⚠ 已手动停止 —</span>}
                  共 {writeResults.length} 条，成功 {writeResults.filter((r) => r.state === "success").length}，失败{" "}
                  {writeResults.filter((r) => r.state === "error").length} — 执行日志已自动下载
                </div>
                <table className="w-full text-left text-sm">
                  <tbody>
                    {writeResults.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{r.key}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                          {r.state === "success" ? (
                            <span className="text-green-600 dark:text-green-400">成功{r.detail ? ` — ${r.detail}` : ""}</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">失败 — {r.error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
