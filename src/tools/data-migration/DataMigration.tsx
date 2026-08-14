import { useEffect, useMemo, useRef, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { downloadTextFile } from "../../native/download";
import { fetchAttributes, fetchEntityList, fetchEntityMeta, fetchManyToManyInfo } from "../../native/metadataService";
import { orderStatementsByDependency, type DependencyOrderResult } from "../sql4cds/dependencyOrder";
import { runConcurrent } from "../sql4cds/concurrency";
import { literalToJsValue, parseSql, type InsertResult, type MutateResult } from "../sql4cds/translate";
import { deleteRow, insertIntersectRow, insertRow, queryMatchingIds, resolveIntersectRowValues, updateRow } from "../sql4cds/writeOps";
import type { Sql4CdsBatchStatementLog, Sql4CdsLogEntry } from "../sql4cds/executionLog";
import SqlEditor from "../sql4cds/SqlEditor";
import { buildDataMigrationLogText, dataMigrationLogFilename } from "./importLog";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

function ConcurrencyInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
      并发数
      <input
        type="number"
        min={1}
        max={20}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
        className="w-14 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
    </label>
  );
}

function describeStatement(stmt: InsertResult | MutateResult): string {
  if (stmt.kind === "insert") return `INSERT INTO ${stmt.entityLogicalName}（${stmt.rows.length} 行）`;
  const verb = stmt.action === "update" ? "UPDATE" : "DELETE";
  return `${verb} ${stmt.entityLogicalName} WHERE ${stmt.filter}`;
}

function WriteResultTable({ results, stopped }: { results: Sql4CdsLogEntry[]; stopped?: boolean }) {
  const success = results.filter((r) => r.state === "success").length;
  const error = results.length - success;
  return (
    <div className="max-h-[50vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
        {stopped && <span className="mr-1 font-medium text-amber-600 dark:text-amber-400">⚠ 已手动停止 —</span>}
        共 {results.length} 条，成功 {success}，失败 {error} — 执行日志已自动下载
      </div>
      <table className="w-full text-left text-sm">
        <tbody>
          {results.map((r, i) => (
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
  );
}

/** Data Migration is a thin, cross-environment-focused shell around SQL4CDS's own parse/order/
 *  write engine (translate.ts/dependencyOrder.ts/writeOps.ts/concurrency.ts, all imported
 *  directly rather than re-implemented — a bug fix to any of those benefits both tools, not just
 *  one of a diverging pair). What's actually specific to this tool: a "目标连接" picker decoupled
 *  from whichever connection this tab happens to be bound to, since the whole point of a
 *  migration run is writing to a *different* environment than the one you're looking at. Unlike
 *  SQL4CDS's own INSERT (a plain create) there is no upsert-by-id behavior here either — SQL
 *  semantics are preserved as written (INSERT creates, rejecting a duplicate id rather than
 *  silently overwriting; UPDATE only touches whatever its own WHERE matches). */
export default function DataMigration() {
  const { connections } = useActiveConnection();

  const [sql, setSql] = useState("");
  const [targetConnectionId, setTargetConnectionId] = useState("");

  const parsed = useMemo(() => parseSql(sql), [sql]);
  const statements = useMemo<(InsertResult | MutateResult)[]>(() => {
    if (parsed.kind === "insert" || parsed.kind === "mutate") return [parsed];
    if (parsed.kind === "batch") return parsed.statements;
    return [];
  }, [parsed]);

  // Table/column-name autocomplete — best-effort, scoped to whichever table the first statement
  // targets (same "one shared cache, lazily filled in" approach as SQL4CDS's own editor).
  const [editorTables, setEditorTables] = useState<string[]>([]);
  const [editorColumns, setEditorColumns] = useState<Record<string, string[]>>({});
  const primaryEntityLogicalName = statements[0]?.entityLogicalName ?? null;

  useEffect(() => {
    if (!targetConnectionId) {
      setEditorTables([]);
      return;
    }
    let cancelled = false;
    fetchEntityList(targetConnectionId)
      .then((names) => {
        if (!cancelled) setEditorTables(names);
      })
      .catch(() => {
        if (!cancelled) setEditorTables([]);
      });
    return () => {
      cancelled = true;
    };
  }, [targetConnectionId]);

  useEffect(() => {
    if (!targetConnectionId || !primaryEntityLogicalName || editorColumns[primaryEntityLogicalName]) return;
    let cancelled = false;
    fetchAttributes(targetConnectionId, primaryEntityLogicalName)
      .then((attrs) => {
        if (!cancelled) setEditorColumns((prev) => ({ ...prev, [primaryEntityLogicalName]: attrs.map((a) => a.logicalName) }));
      })
      .catch(() => {
        /* autocomplete is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [targetConnectionId, primaryEntityLogicalName, editorColumns]);

  const editorSchema = useMemo(() => {
    const schema: Record<string, string[]> = {};
    for (const table of editorTables) schema[table] = editorColumns[table] ?? [];
    if (primaryEntityLogicalName && !schema[primaryEntityLogicalName]) schema[primaryEntityLogicalName] = editorColumns[primaryEntityLogicalName] ?? [];
    return schema;
  }, [editorTables, editorColumns, primaryEntityLogicalName]);

  // Dependency ordering — auto-resolved as soon as there are statements and a target connection,
  // same pattern SQL4CDS uses for its own batch preview (see Sql4Cds.tsx).
  const [orderedBatch, setOrderedBatch] = useState<DependencyOrderResult | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);

  useEffect(() => {
    setOrderedBatch(null);
    if (statements.length === 0 || !targetConnectionId) return;
    let cancelled = false;
    setOrderLoading(true);
    orderStatementsByDependency(targetConnectionId, statements)
      .then((r) => {
        if (!cancelled) setOrderedBatch(r);
      })
      .finally(() => {
        if (!cancelled) setOrderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statements, targetConnectionId]);

  const [writeRunning, setWriteRunning] = useState(false);
  const [writeResults, setWriteResults] = useState<Sql4CdsLogEntry[] | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeConcurrency, setWriteConcurrency] = useState(8);
  const stopRequestedRef = useRef(false);
  const [writeStopped, setWriteStopped] = useState(false);

  useEffect(() => {
    setWriteResults(null);
    setWriteError(null);
    setWriteStopped(false);
  }, [sql]);

  function handleStop() {
    stopRequestedRef.current = true;
  }

  function targetConnectionName(): string {
    return connections.find((c) => c.id === targetConnectionId)?.name ?? targetConnectionId;
  }
  function targetEnvironmentUrl(): string | undefined {
    return connections.find((c) => c.id === targetConnectionId)?.environmentUrl;
  }

  async function handleImport() {
    if (!targetConnectionId || !orderedBatch || orderedBatch.cycleError || orderedBatch.ordered.some((os) => os.rowCycleError)) return;
    const ordered = orderedBatch.ordered;

    const preview = ordered.map((os) => `${os.originalIndex + 1}. ${describeStatement(os.statement)}`).join("\n");
    const reorderNote = orderedBatch.reordered ? "\n\n（已按跨表/跨行依赖关系自动调整了执行顺序，上面列出的就是实际执行顺序。）" : "";
    if (!confirm(`即将向 ${targetConnectionName()} 依次执行 ${ordered.length} 条语句：\n${preview}${reorderNote}\n\n确定吗？`)) return;

    setWriteRunning(true);
    setWriteResults([]);
    setWriteError(null);
    stopRequestedRef.current = false;
    setWriteStopped(false);
    const startedAt = new Date();
    const statementLogs: Sql4CdsBatchStatementLog[] = [];
    let stopped = false;

    try {
      for (let i = 0; i < ordered.length; i++) {
        if (stopRequestedRef.current) {
          stopped = true;
          setWriteStopped(true);
          break;
        }
        const os = ordered[i];
        const stmt = os.statement;
        const stmtLabel = os.originalIndex + 1;
        const entries: Sql4CdsLogEntry[] = [];
        let entitySetName = stmt.entitySetGuess;

        try {
          const meta = await fetchEntityMeta(targetConnectionId, stmt.entityLogicalName);
          entitySetName = meta.entitySetName;
          const manyToMany = await fetchManyToManyInfo(targetConnectionId, stmt.entityLogicalName);

          if (stmt.kind === "insert") {
            const envUrl = manyToMany ? targetEnvironmentUrl() : undefined;
            if (manyToMany && !envUrl) throw new Error("找不到目标连接的环境 URL。");

            const orderedRows = os.rowOrder ? os.rowOrder.map((idx) => stmt.rows[idx]) : stmt.rows;
            const rowConcurrency = os.rowOrder ? 1 : writeConcurrency;

            await runConcurrent(
              orderedRows,
              rowConcurrency,
              async (row, r) => {
                const rowLabel = os.rowOrder ? os.rowOrder[r] + 1 : r + 1;
                const key = `语句 ${stmtLabel} · 第 ${rowLabel} 行`;
                let entry: Sql4CdsLogEntry;
                try {
                  const columnValues: Record<string, unknown> = {};
                  stmt.columns.forEach((col, idx) => {
                    columnValues[col] = literalToJsValue(row[idx]);
                  });
                  if (manyToMany) {
                    const values = resolveIntersectRowValues(manyToMany, columnValues);
                    await insertIntersectRow(targetConnectionId, envUrl!, manyToMany, values);
                    entry = { key, state: "success" };
                  } else {
                    const { newId } = await insertRow(targetConnectionId, stmt.entityLogicalName, entitySetName, columnValues);
                    entry = { key, state: "success", detail: newId ?? undefined };
                  }
                } catch (err) {
                  entry = { key, state: "error", error: err instanceof Error ? err.message : String(err) };
                }
                entries.push(entry);
                setWriteResults((r2) => [...(r2 ?? []), entry]);
              },
              () => stopRequestedRef.current,
            );
            if (stopRequestedRef.current) {
              stopped = true;
              setWriteStopped(true);
            }
          } else {
            if (manyToMany) {
              throw new Error(
                `"${stmt.entityLogicalName}" 是多对多关联表（${manyToMany.entity1LogicalName} ↔ ${manyToMany.entity2LogicalName}），暂不支持对它执行 UPDATE/DELETE。`,
              );
            }
            const { ids } = await queryMatchingIds(targetConnectionId, entitySetName, meta.primaryIdAttribute, stmt.filter);
            const columnValues =
              stmt.action === "update" && stmt.setClauses
                ? Object.fromEntries(stmt.setClauses.map((s) => [s.column, literalToJsValue(s.value)]))
                : null;

            await runConcurrent(
              ids,
              writeConcurrency,
              async (id) => {
                const key = `语句 ${stmtLabel} · ${id}`;
                let entry: Sql4CdsLogEntry;
                try {
                  if (stmt.action === "update") {
                    await updateRow(targetConnectionId, stmt.entityLogicalName, entitySetName, id, columnValues!);
                  } else {
                    await deleteRow(targetConnectionId, entitySetName, id);
                  }
                  entry = { key, state: "success" };
                } catch (err) {
                  entry = { key, state: "error", error: err instanceof Error ? err.message : String(err) };
                }
                entries.push(entry);
                setWriteResults((r2) => [...(r2 ?? []), entry]);
              },
              () => stopRequestedRef.current,
            );
            if (stopRequestedRef.current) {
              stopped = true;
              setWriteStopped(true);
            }
          }
        } catch (err) {
          const entry: Sql4CdsLogEntry = { key: `语句 ${stmtLabel}`, state: "error", error: err instanceof Error ? err.message : String(err) };
          entries.push(entry);
          setWriteResults((r2) => [...(r2 ?? []), entry]);
        }

        statementLogs.push({
          index: stmtLabel,
          action: stmt.kind === "insert" ? "insert" : stmt.action,
          entityLogicalName: stmt.entityLogicalName,
          entitySetName,
          summary: describeStatement(stmt),
          entries,
        });
      }

      const finishedAt = new Date();
      const text = buildDataMigrationLogText({
        startedAt,
        finishedAt,
        targetConnectionName: targetConnectionName(),
        sql,
        statements: statementLogs,
        stopped,
      });
      downloadTextFile(dataMigrationLogFilename(finishedAt), text);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteRunning(false);
    }
  }

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  const orderedList: { statement: InsertResult | MutateResult; originalIndex: number; rowOrder?: number[]; rowCycleError?: string }[] =
    orderedBatch?.ordered ?? statements.map((s, i) => ({ statement: s, originalIndex: i }));
  const blockingCycleError = orderedBatch?.cycleError ?? orderedList.find((os) => os.rowCycleError)?.rowCycleError ?? null;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        粘贴一段或多段 `;` 分隔的 INSERT/UPDATE/DELETE 语句（可以跨不同的表），执行前自动识别跨表、以及同一条 INSERT 内部跨行的 GUID
        依赖关系并排好安全的执行顺序，排不出顺序（循环依赖）会清晰报错并阻止执行。按 SQL 本身的语义执行——INSERT
        是真正新建（主键冲突会报错，不是静默按 GUID 覆盖已有记录），UPDATE/DELETE 按各自的 WHERE 条件执行。执行对象是下面选择的"目标连接"，与当前
        Tab 绑定的连接无关。此界面不支持 SELECT 查询——查询请使用 SQL4CDS 工具。
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">目标连接：</label>
        <select value={targetConnectionId} onChange={(e) => setTargetConnectionId(e.target.value)} className={inputCls}>
          <option value="">选择目标连接…</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {!targetConnectionId && <span className="text-xs text-gray-400">请先选择要写入的目标连接。</span>}
      </div>

      <SqlEditor
        value={sql}
        onChange={setSql}
        schema={editorSchema}
        defaultTable={primaryEntityLogicalName ?? undefined}
        placeholder="INSERT INTO account (accountid, name) VALUES ('...', 'Contoso');"
      />

      {parsed.kind === "error" && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {parsed.error}
        </div>
      )}

      {(parsed.kind === "select-simple" || parsed.kind === "select-complex") && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          此界面不支持 SELECT 查询，请到 SQL4CDS 工具执行查询。
        </div>
      )}

      {statements.length > 0 && (
        <>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
              共 {statements.length} 条语句
              {!targetConnectionId && " — 选择目标连接后开始分析依赖关系"}
              {orderLoading && " — 正在分析跨表依赖关系…"}
              {!orderLoading && orderedBatch?.reordered && " — 已按依赖关系自动排序（下表为实际执行顺序）"}
            </div>
            <table className="w-full text-left text-sm">
              <tbody>
                {orderedList.map((os, i) => (
                  <tr key={os.originalIndex} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-400">
                      {i + 1}
                      {os.originalIndex !== i && <span className="ml-1 text-amber-500">(原第 {os.originalIndex + 1} 条)</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{describeStatement(os.statement)}</td>
                    {os.rowCycleError && <td className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400">⚠ {os.rowCycleError}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {blockingCycleError && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {blockingCycleError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleImport}
              disabled={!targetConnectionId || writeRunning || orderLoading || !!blockingCycleError}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {writeRunning ? "执行中…" : `导入 (${statements.length} 条语句)`}
            </button>
            {writeRunning && (
              <button
                onClick={handleStop}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                停止
              </button>
            )}
            <ConcurrencyInput value={writeConcurrency} onChange={setWriteConcurrency} disabled={writeRunning} />
          </div>

          {writeError && (
            <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
              {writeError}
            </pre>
          )}

          {writeResults && writeResults.length > 0 && <WriteResultTable results={writeResults} stopped={writeStopped} />}
        </>
      )}
    </div>
  );
}
