import { useEffect, useMemo, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { useEntitySetName } from "../../native/useEntitySetName";
import { downloadTextFile } from "../../native/download";
import { fetchEntityMeta } from "../../native/metadataService";
import { literalToJsValue, parseSql, type SqlNode } from "./translate";
import { deleteRow, insertRow, queryMatchingIds, updateRow, type MatchingIds } from "./writeOps";
import { buildSql4CdsLogText, sql4CdsLogFilename, type Sql4CdsLogEntry, type WriteAction } from "./executionLog";

const SAMPLE = `SELECT TOP 50 name, revenue, statecode
FROM account
WHERE statecode = 0 AND (name LIKE 'Contoso%' OR telephone1 IS NOT NULL)
ORDER BY name`;

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

function OutputRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
        <button
          onClick={() => navigator.clipboard.writeText(value)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          复制
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        {value}
      </pre>
    </div>
  );
}

/** Display-only rendering of a literal AST node in the INSERT preview table — not used for
 *  execution (writeOps.ts's buildRowBody works off the same nodes via literalToJsValue). */
function describeLiteral(node: SqlNode): string {
  if (node.type === "null") return "NULL";
  return String(node.value);
}

function WriteResultTable({ results }: { results: Sql4CdsLogEntry[] }) {
  const success = results.filter((r) => r.state === "success").length;
  const error = results.length - success;
  return (
    <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="border-b border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        共 {results.length} 条，成功 {success}，失败 {error} — 执行日志已自动下载
      </div>
      <table className="w-full text-left text-sm">
        <tbody>
          {results.map((r, i) => (
            <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
              <td className="px-3 py-1.5 font-mono text-xs">{r.key}</td>
              <td className="px-3 py-1.5 text-xs">
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

export default function Sql4Cds() {
  const { activeConnectionId, connections } = useActiveConnection();
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const result = useMemo(() => parseSql(sql), [sql]);

  // Every non-error/non-empty statement kind carries entityLogicalName/entitySetGuess — narrow
  // once here instead of repeating the `"entityLogicalName" in result` check at every use site.
  const hasEntity = result.kind !== "error" && result.kind !== "empty";
  const entityLogicalName = hasEntity ? result.entityLogicalName : null;
  const entitySetGuess = hasEntity ? result.entitySetGuess : null;
  const mutateFilter = result.kind === "mutate" ? result.filter : null;

  const entitySetMeta = useEntitySetName(activeConnectionId, entityLogicalName ?? "");
  const entitySet = entitySetMeta.entitySetName || entitySetGuess || "";

  const path = useMemo(() => {
    if (!entitySet) return "";
    if (result.kind === "select-simple") {
      const parts: string[] = [];
      if (result.select) parts.push(`$select=${result.select}`);
      if (result.filter) parts.push(`$filter=${result.filter}`);
      if (result.orderby) parts.push(`$orderby=${result.orderby}`);
      if (result.top) parts.push(`$top=${result.top}`);
      return parts.length ? `${entitySet}?${parts.join("&")}` : entitySet;
    }
    if (result.kind === "select-complex") {
      return `${entitySet}?fetchXml=${encodeURIComponent(result.fetchXml)}`;
    }
    return "";
  }, [entitySet, result]);

  async function handleRun() {
    if (!activeConnectionId || !path) return;
    setRunning(true);
    setRunError(null);
    setRows(null);
    try {
      const res = await callNative<{ value: Record<string, unknown>[] }>("dataverse.request", {
        connectionId: activeConnectionId,
        method: "GET",
        path,
      });
      setRows(res.value);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const columns = rows && rows.length > 0 ? Object.keys(rows[0]).filter((k) => !k.startsWith("@")) : [];

  // --- write (INSERT/UPDATE/DELETE) execution state ---
  const [writeRunning, setWriteRunning] = useState(false);
  const [writeResults, setWriteResults] = useState<Sql4CdsLogEntry[] | null>(null);

  useEffect(() => {
    setWriteResults(null);
  }, [sql]);

  // UPDATE/DELETE always needs the matching record ids before it can run — auto-resolved as soon
  // as the entity set and WHERE-derived $filter are known, same spirit as useEntitySetName above.
  const [matchInfo, setMatchInfo] = useState<(MatchingIds & { primaryIdAttribute: string }) | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  useEffect(() => {
    setMatchInfo(null);
    setMatchError(null);
    if (result.kind !== "mutate" || !activeConnectionId || !entitySet || !entityLogicalName || mutateFilter === null) return;
    let cancelled = false;
    setMatchLoading(true);
    fetchEntityMeta(activeConnectionId, entityLogicalName)
      .then((meta) =>
        queryMatchingIds(activeConnectionId, entitySet, meta.primaryIdAttribute, mutateFilter).then((m) => ({
          ...m,
          primaryIdAttribute: meta.primaryIdAttribute,
        })),
      )
      .then((m) => {
        if (!cancelled) setMatchInfo(m);
      })
      .catch((err) => {
        if (!cancelled) setMatchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setMatchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [result.kind, activeConnectionId, entitySet, entityLogicalName, mutateFilter]);

  function connectionName(): string {
    return connections.find((c) => c.id === activeConnectionId)?.name ?? activeConnectionId ?? "";
  }

  function finishWrite(action: WriteAction, entity: string, entitySetName: string, startedAt: Date, entries: Sql4CdsLogEntry[]) {
    const finishedAt = new Date();
    const filename = sql4CdsLogFilename(action, entity, finishedAt);
    const text = buildSql4CdsLogText({
      startedAt,
      finishedAt,
      connectionName: connectionName(),
      action,
      entityLogicalName: entity,
      entitySetName,
      sql,
      entries,
    });
    downloadTextFile(filename, text);
    setWriteRunning(false);
  }

  async function handleInsert() {
    if (!activeConnectionId || result.kind !== "insert" || !entitySet) return;
    const rowCount = result.rows.length;
    if (!confirm(`即将向 ${result.entityLogicalName} 插入 ${rowCount} 条新记录，确定吗？`)) return;

    setWriteRunning(true);
    setWriteResults([]);
    const startedAt = new Date();
    const entries: Sql4CdsLogEntry[] = [];

    for (let i = 0; i < result.rows.length; i++) {
      const key = `第 ${i + 1} 行`;
      const columnValues: Record<string, unknown> = {};
      result.columns.forEach((col, idx) => {
        columnValues[col] = literalToJsValue(result.rows[i][idx]);
      });
      let entry: Sql4CdsLogEntry;
      try {
        const { newId } = await insertRow(activeConnectionId, result.entityLogicalName, entitySet, columnValues);
        entry = { key, state: "success", detail: newId ?? undefined };
      } catch (err) {
        entry = { key, state: "error", error: err instanceof Error ? err.message : String(err) };
      }
      entries.push(entry);
      setWriteResults((r) => [...(r ?? []), entry]);
    }

    finishWrite("insert", result.entityLogicalName, entitySet, startedAt, entries);
  }

  async function handleMutate() {
    if (!activeConnectionId || result.kind !== "mutate" || !entitySet || !matchInfo) return;
    const ids = matchInfo.ids;
    if (ids.length === 0) return;
    const verb = result.action === "update" ? "更新" : "删除";
    if (!confirm(`即将${verb} ${result.entityLogicalName} 的 ${ids.length} 条记录，确定吗？`)) return;

    setWriteRunning(true);
    setWriteResults([]);
    const startedAt = new Date();
    const entries: Sql4CdsLogEntry[] = [];

    const columnValues =
      result.action === "update" && result.setClauses
        ? Object.fromEntries(result.setClauses.map((s) => [s.column, literalToJsValue(s.value)]))
        : null;

    for (const id of ids) {
      let entry: Sql4CdsLogEntry;
      try {
        if (result.action === "update") {
          await updateRow(activeConnectionId, result.entityLogicalName, entitySet, id, columnValues!);
        } else {
          await deleteRow(activeConnectionId, entitySet, id);
        }
        entry = { key: id, state: "success" };
      } catch (err) {
        entry = { key: id, state: "error", error: err instanceof Error ? err.message : String(err) };
      }
      entries.push(entry);
      setWriteResults((r) => [...(r ?? []), entry]);
    }

    finishWrite(result.action, result.entityLogicalName, entitySet, startedAt, entries);
  }

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        支持 SELECT（含 JOIN / GROUP BY / 聚合函数，翻译成 FetchXML 执行）、INSERT、UPDATE、DELETE。UPDATE/DELETE
        必须带 WHERE 子句（不支持整表操作，请自己写恒真条件），执行前会弹窗二次确认，单次最多处理 500 条匹配记录并自动下载执行日志。用 T-SQL
        语法解析，翻译成 Dataverse Web API 查询后真实执行。
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">SQL</label>
          <button onClick={() => setSql(SAMPLE)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            填充示例
          </button>
        </div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder="SELECT name FROM account WHERE statecode = 0"
          className={inputCls}
        />
      </div>

      {result.kind === "error" && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {result.error}
        </div>
      )}

      {hasEntity && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">实体：</span>
          <code className="rounded bg-gray-100 px-2 py-0.5 dark:bg-gray-800">{entityLogicalName}</code>
          <span className="text-gray-500 dark:text-gray-400">
            Entity Set Name（{entitySetMeta.resolved ? "已从元数据确认" : "猜测"}，可编辑覆盖）：
          </span>
          <input
            type="text"
            value={entitySetMeta.override}
            onChange={(e) => entitySetMeta.setOverride(e.target.value)}
            placeholder={entitySetMeta.resolved ?? entitySetGuess ?? ""}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {entitySetMeta.loading && <span className="text-xs text-gray-400">读取真实值中…</span>}
          {entitySetMeta.resolved && !entitySetMeta.loading && (
            <span className="text-xs text-green-600 dark:text-green-400">✓ 真实值</span>
          )}
          {entitySetMeta.error && !entitySetMeta.loading && (
            <span className="text-xs text-amber-600 dark:text-amber-400" title={entitySetMeta.error}>
              ⚠ 读取失败，已回退为猜测值
            </span>
          )}
          {activeConnectionId && (
            <button onClick={entitySetMeta.refresh} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
              刷新
            </button>
          )}
        </div>
      )}

      {(result.kind === "select-simple" || result.kind === "select-complex") && (
        <>
          {result.kind === "select-complex" ? (
            <OutputRow label="FetchXML" value={result.fetchXml} />
          ) : (
            <OutputRow label="请求路径" value={path} />
          )}

          {result.warnings.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              {result.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}

          <div>
            <button
              onClick={handleRun}
              disabled={!activeConnectionId || running}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {running ? "执行中…" : "执行查询"}
            </button>
            {!activeConnectionId && <span className="ml-2 text-xs text-gray-400">请先在侧边栏选择一个我的连接。</span>}
          </div>

          {runError && (
            <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
              {runError}
            </pre>
          )}

          {rows && (
            <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="border-b border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                {rows.length} 行
              </div>
              {rows.length > 0 && (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className="px-3 py-2 font-mono">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                        {columns.map((c) => (
                          <td key={c} className="px-3 py-1.5 font-mono text-xs">
                            {typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {result.kind === "insert" && (
        <>
          <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="border-b border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              待插入 {result.rows.length} 行
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  {result.columns.map((c) => (
                    <th key={c} className="px-3 py-2 font-mono">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                    {row.map((node, j) => (
                      <td key={j} className="px-3 py-1.5 font-mono text-xs">
                        {describeLiteral(node)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <button
              onClick={handleInsert}
              disabled={!activeConnectionId || !entitySet || writeRunning}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {writeRunning ? "执行中…" : `执行插入 (${result.rows.length} 行)`}
            </button>
            {!activeConnectionId && <span className="ml-2 text-xs text-gray-400">请先在侧边栏选择一个我的连接。</span>}
          </div>

          {writeResults && writeResults.length > 0 && <WriteResultTable results={writeResults} />}
        </>
      )}

      {result.kind === "mutate" && (
        <>
          <OutputRow label="WHERE → $filter" value={result.filter} />

          {matchLoading && <p className="text-xs text-gray-400">正在查询匹配的记录…</p>}
          {matchError && (
            <p className="text-xs text-red-600 dark:text-red-400">查询匹配记录失败：{matchError}</p>
          )}
          {matchInfo && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              匹配到 {matchInfo.totalCount} 条记录
              {matchInfo.totalCount > matchInfo.ids.length
                ? `，本次最多处理其中 ${matchInfo.ids.length} 条（超出部分请缩小 WHERE 范围后再次执行）`
                : ""}
            </p>
          )}

          <div>
            <button
              onClick={handleMutate}
              disabled={!activeConnectionId || !matchInfo || matchInfo.ids.length === 0 || writeRunning}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                result.action === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {writeRunning ? "执行中…" : `执行${result.action === "update" ? "更新" : "删除"}`}
            </button>
            {!activeConnectionId && <span className="ml-2 text-xs text-gray-400">请先在侧边栏选择一个我的连接。</span>}
          </div>

          {writeResults && writeResults.length > 0 && <WriteResultTable results={writeResults} />}
        </>
      )}
    </div>
  );
}
