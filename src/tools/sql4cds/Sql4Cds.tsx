import { useEffect, useMemo, useRef, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { useEntitySetName } from "../../native/useEntitySetName";
import { downloadTextFile } from "../../native/download";
import { fetchAttributes, fetchEntityList, fetchEntityMeta, fetchManyToManyInfo } from "../../native/metadataService";
import { runConcurrent } from "./concurrency";
import { orderStatementsByDependency, type DependencyOrderResult } from "./dependencyOrder";
import { literalToJsValue, parseSql, type InsertResult, type MutateResult, type SqlNode } from "./translate";
import {
  deleteRow,
  insertIntersectRow,
  insertRow,
  queryMatchingIds,
  resolveIntersectRowValues,
  updateRow,
  type MatchingIds,
} from "./writeOps";
import {
  buildSql4CdsBatchLogText,
  buildSql4CdsLogText,
  sql4CdsBatchLogFilename,
  sql4CdsLogFilename,
  type Sql4CdsBatchStatementLog,
  type Sql4CdsLogEntry,
  type WriteAction,
} from "./executionLog";
import SqlEditor from "../../shared/SqlEditor";

const SAMPLE = `SELECT TOP 50 name, revenue, statecode
FROM account
WHERE statecode = 0 AND (name LIKE 'Contoso%' OR telephone1 IS NOT NULL)
ORDER BY name`;

// Dataverse's default service protection limit is 52 concurrent requests per user — this default
// stays well under that (leaving headroom for whatever else the same user's token is doing) while
// still giving a large batch a meaningful speedup over one request at a time. writeOps.ts retries
// individual requests on HTTP 429 with backoff, so an occasional throttle at higher concurrency
// values doesn't turn into a failed row.
const DEFAULT_WRITE_CONCURRENCY = 8;
const MAX_WRITE_CONCURRENCY = 20;

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

/** One-line human summary of a batch statement — shared by the preview list and the execution
 *  log (Sql4CdsBatchStatementLog.summary), so they can't drift apart. */
function describeStatement(stmt: InsertResult | MutateResult): string {
  if (stmt.kind === "insert") return `INSERT INTO ${stmt.entityLogicalName}（${stmt.rows.length} 行）`;
  const verb = stmt.action === "update" ? "UPDATE" : "DELETE";
  return `${verb} ${stmt.entityLogicalName} WHERE ${stmt.filter}`;
}

function ConcurrencyInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
      并发数
      <input
        type="number"
        min={1}
        max={MAX_WRITE_CONCURRENCY}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(MAX_WRITE_CONCURRENCY, Math.max(1, Number(e.target.value) || 1)))}
        className="w-14 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
    </label>
  );
}

function WriteResultTable({ results, stopped }: { results: Sql4CdsLogEntry[]; stopped?: boolean }) {
  const success = results.filter((r) => r.state === "success").length;
  const error = results.length - success;
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
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

export default function Sql4Cds() {
  const { activeConnectionId, connections } = useActiveConnection();
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const result = useMemo(() => parseSql(sql), [sql]);

  // Every non-error/non-empty/non-batch statement kind carries entityLogicalName/entitySetGuess —
  // narrow once here instead of repeating the `"entityLogicalName" in result` check at every use
  // site. A batch spans one entity per statement (possibly several different ones), so it has no
  // single entity to show here — each statement resolves its own inside handleBatch.
  const hasEntity = result.kind !== "error" && result.kind !== "empty" && result.kind !== "batch";
  const entityLogicalName = hasEntity ? result.entityLogicalName : null;
  const entitySetGuess = hasEntity ? result.entitySetGuess : null;
  const mutateFilter = result.kind === "mutate" ? result.filter : null;

  const entitySetMeta = useEntitySetName(activeConnectionId, entityLogicalName ?? "");
  const entitySet = entitySetMeta.entitySetName || entitySetGuess || "";

  // --- SQL editor autocomplete schema: all entity logical names (for table-name completion,
  // fetched once per connection) plus the current statement's table's columns (fetched lazily as
  // the FROM/INTO/UPDATE table becomes known) — both via metadataService's existing caches, so
  // switching between tables already visited in this session is instant. ---
  const [editorTables, setEditorTables] = useState<string[]>([]);
  const [editorColumns, setEditorColumns] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!activeConnectionId) {
      setEditorTables([]);
      return;
    }
    let cancelled = false;
    fetchEntityList(activeConnectionId)
      .then((names) => {
        if (!cancelled) setEditorTables(names);
      })
      .catch(() => {
        if (!cancelled) setEditorTables([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId]);

  useEffect(() => {
    if (!activeConnectionId || !entityLogicalName || editorColumns[entityLogicalName]) return;
    let cancelled = false;
    fetchAttributes(activeConnectionId, entityLogicalName)
      .then((attrs) => {
        if (!cancelled) {
          setEditorColumns((prev) => ({ ...prev, [entityLogicalName]: attrs.map((a) => a.logicalName) }));
        }
      })
      .catch(() => {
        /* autocomplete is best-effort — just falls back to the bare table name with no columns */
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, entityLogicalName, editorColumns]);

  const editorSchema = useMemo(() => {
    const schema: Record<string, string[]> = {};
    for (const table of editorTables) schema[table] = editorColumns[table] ?? [];
    if (entityLogicalName && !schema[entityLogicalName]) schema[entityLogicalName] = editorColumns[entityLogicalName] ?? [];
    return schema;
  }, [editorTables, editorColumns, entityLogicalName]);

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
  // Anything that goes wrong outside the per-row try/catch below (bad literal, download
  // failure, ...) used to become an unhandled promise rejection: writeRunning never got reset,
  // so the button stayed stuck on "执行中…" forever with no visible error. Every write handler
  // now runs its whole body in try/catch/finally so that can't happen — see handleInsert/handleMutate.
  const [writeError, setWriteError] = useState<string | null>(null);
  // "停止" button: a ref (not state) because it has to be read synchronously inside the write
  // loops between awaits, and state updates from a click handler wouldn't be visible there until
  // the next render. Can only stop *before* the next row/statement starts — an already-in-flight
  // request still finishes (no AbortController plumbed through the native bridge), so on a large
  // batch there's a small, unavoidable "one more row" lag after clicking it.
  const stopRequestedRef = useRef(false);
  const [writeStopped, setWriteStopped] = useState(false);
  const [writeConcurrency, setWriteConcurrency] = useState(DEFAULT_WRITE_CONCURRENCY);

  function handleStopWrite() {
    stopRequestedRef.current = true;
  }

  useEffect(() => {
    setWriteResults(null);
    setWriteError(null);
    setWriteStopped(false);
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

  // A batch can span several tables with cross-statement (or, for one INSERT's own multiple
  // rows, intra-statement) GUID dependencies — auto-resolved the same way matchInfo is above, so
  // the user sees the actual execution order (and any unresolvable circular dependency) before
  // clicking "执行全部", not after.
  const [orderedBatch, setOrderedBatch] = useState<DependencyOrderResult | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);

  useEffect(() => {
    setOrderedBatch(null);
    if (result.kind !== "batch" || !activeConnectionId) return;
    let cancelled = false;
    setOrderLoading(true);
    orderStatementsByDependency(activeConnectionId, result.statements)
      .then((r) => {
        if (!cancelled) setOrderedBatch(r);
      })
      .finally(() => {
        if (!cancelled) setOrderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [result, activeConnectionId]);

  function connectionName(): string {
    return connections.find((c) => c.id === activeConnectionId)?.name ?? activeConnectionId ?? "";
  }

  /** Needed for insertIntersectRow's `@odata.id` — see its doc comment for why that has to be an
   *  absolute URL. Already exposed on ConnectionDto, no extra bridge call needed. */
  function environmentUrl(): string | undefined {
    return connections.find((c) => c.id === activeConnectionId)?.environmentUrl;
  }

  function finishWrite(
    action: WriteAction,
    entity: string,
    entitySetName: string,
    startedAt: Date,
    entries: Sql4CdsLogEntry[],
    stopped: boolean,
  ) {
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
      stopped,
    });
    downloadTextFile(filename, text);
  }

  async function handleInsert() {
    if (!activeConnectionId || result.kind !== "insert" || !entitySet) return;
    const rowCount = result.rows.length;
    if (!confirm(`即将向 ${result.entityLogicalName} 插入 ${rowCount} 条新记录，确定吗？`)) return;

    setWriteRunning(true);
    setWriteResults([]);
    setWriteError(null);
    stopRequestedRef.current = false;
    setWriteStopped(false);
    const startedAt = new Date();
    const entries: Sql4CdsLogEntry[] = [];
    let stopped = false;

    // Whole body wrapped in try/finally: previously the per-row literalToJsValue() conversion
    // ran outside any try/catch, so a bad literal threw an unhandled rejection that skipped
    // finishWrite entirely — writeRunning stayed true forever (button stuck on "执行中…",
    // disabled, no visible error). Now any such failure is caught and shown, and writeRunning
    // is always released.
    try {
      // An N:N intersect entity's Web API EntitySet 400s on a plain POST ("Invalid property ...
      // was found") — confirmed against contoso-dev inserting into contoso_paymentfrequency_product.
      // Detected once up front; every row below goes through insertIntersectRow's $ref endpoint
      // instead of the normal insertRow POST when this is set.
      const manyToMany = await fetchManyToManyInfo(activeConnectionId, result.entityLogicalName);
      const envUrl = environmentUrl();
      if (manyToMany && !envUrl) throw new Error("找不到当前连接的环境 URL。");

      await runConcurrent(
        result.rows,
        writeConcurrency,
        async (row, i) => {
          const key = `第 ${i + 1} 行`;
          let entry: Sql4CdsLogEntry;
          try {
            const columnValues: Record<string, unknown> = {};
            result.columns.forEach((col, idx) => {
              columnValues[col] = literalToJsValue(row[idx]);
            });
            if (manyToMany) {
              const values = resolveIntersectRowValues(manyToMany, columnValues);
              await insertIntersectRow(activeConnectionId, envUrl!, manyToMany, values);
              entry = { key, state: "success" };
            } else {
              const { newId } = await insertRow(activeConnectionId, result.entityLogicalName, entitySet, columnValues);
              entry = { key, state: "success", detail: newId ?? undefined };
            }
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

      finishWrite("insert", result.entityLogicalName, entitySet, startedAt, entries, stopped);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteRunning(false);
    }
  }

  async function handleMutate() {
    if (!activeConnectionId || result.kind !== "mutate" || !entitySet || !matchInfo) return;
    const ids = matchInfo.ids;
    if (ids.length === 0) return;
    const verb = result.action === "update" ? "更新" : "删除";
    if (!confirm(`即将${verb} ${result.entityLogicalName} 的 ${ids.length} 条记录，确定吗？`)) return;

    setWriteRunning(true);
    setWriteResults([]);
    setWriteError(null);
    stopRequestedRef.current = false;
    setWriteStopped(false);
    const startedAt = new Date();
    const entries: Sql4CdsLogEntry[] = [];
    let stopped = false;

    // See handleInsert for why the whole body is wrapped in try/finally.
    try {
      // Associating/disassociating an N:N intersect entity goes through a completely different
      // API shape (see writeOps.ts's insertIntersectRow) than an ordinary PATCH/DELETE, and
      // there's no per-relationship-record field to UPDATE in the first place — reject explicitly
      // rather than let every row 400 with a confusing "Invalid property" error.
      const manyToMany = await fetchManyToManyInfo(activeConnectionId, result.entityLogicalName);
      if (manyToMany) {
        throw new Error(
          `"${result.entityLogicalName}" 是多对多关联表（${manyToMany.entity1LogicalName} ↔ ${manyToMany.entity2LogicalName}），暂不支持对它执行 UPDATE/DELETE（关联表本身没有可更新字段；取消关联需要走专门的关联/取消关联接口，这个功能还没做）。`,
        );
      }

      const columnValues =
        result.action === "update" && result.setClauses
          ? Object.fromEntries(result.setClauses.map((s) => [s.column, literalToJsValue(s.value)]))
          : null;

      await runConcurrent(
        ids,
        writeConcurrency,
        async (id) => {
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
        },
        () => stopRequestedRef.current,
      );
      if (stopRequestedRef.current) {
        stopped = true;
        setWriteStopped(true);
      }

      finishWrite(result.action, result.entityLogicalName, entitySet, startedAt, entries, stopped);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteRunning(false);
    }
  }

  // Batch mode: several `;`-separated INSERT/UPDATE/DELETE statements, possibly against
  // different tables — each resolves its own entitySetName/matching-ids here (unlike the single-
  // statement handlers above, which reuse the entitySet/matchInfo already resolved by the
  // top-level useEffects, since those only ever track one entity at a time). All rows across all
  // statements land in one merged log instead of one download per statement.
  async function handleBatch() {
    if (!activeConnectionId || result.kind !== "batch") return;
    // orderedBatch is populated by the useEffect above as soon as the batch is parsed — by the
    // time this button is clickable it should always be present and clean (the button itself is
    // disabled otherwise); the checks here are a second guard against a stale click.
    if (!orderedBatch || orderedBatch.cycleError || orderedBatch.ordered.some((os) => os.rowCycleError)) return;
    const statements = orderedBatch.ordered;

    // Numbered by originalIndex (the statement's position in the pasted SQL), not execution
    // order — so "语句 N" in the confirm dialog, the log, and any error always matches what the
    // user actually typed, even when dependency ordering moved it.
    const preview = statements.map((os) => `${os.originalIndex + 1}. ${describeStatement(os.statement)}`).join("\n");
    const reorderNote = orderedBatch.reordered ? "\n\n（已按跨表/跨行依赖关系自动调整了执行顺序，上面列出的就是实际执行顺序。）" : "";
    if (!confirm(`即将依次执行 ${statements.length} 条语句：\n${preview}${reorderNote}\n\n具体影响行数将在执行过程中依次查询/写入。确定吗？`)) return;

    setWriteRunning(true);
    setWriteResults([]);
    setWriteError(null);
    stopRequestedRef.current = false;
    setWriteStopped(false);
    const startedAt = new Date();
    const statementLogs: Sql4CdsBatchStatementLog[] = [];
    let stopped = false;

    try {
      for (let i = 0; i < statements.length; i++) {
        if (stopRequestedRef.current) {
          stopped = true;
          setWriteStopped(true);
          break;
        }
        const os = statements[i];
        const stmt = os.statement;
        const stmtLabel = os.originalIndex + 1;
        const entries: Sql4CdsLogEntry[] = [];
        let entitySetName = stmt.entitySetGuess;

        try {
          const meta = await fetchEntityMeta(activeConnectionId, stmt.entityLogicalName);
          entitySetName = meta.entitySetName;
          // See handleInsert/handleMutate for why intersect entities need this — same detection,
          // same $ref-based insert path, same "not supported" rejection for update/delete.
          const manyToMany = await fetchManyToManyInfo(activeConnectionId, stmt.entityLogicalName);

          if (stmt.kind === "insert") {
            const envUrl = manyToMany ? environmentUrl() : undefined;
            if (manyToMany && !envUrl) throw new Error("找不到当前连接的环境 URL。");

            // os.rowOrder is only set when this INSERT's own rows reference each other's
            // not-yet-created id (e.g. product.parentproductid pointing at a sibling row in the
            // same multi-row VALUES) — runConcurrent(..., 1, ...) is already strictly sequential
            // (single runner, awaits each row before claiming the next), so forcing concurrency
            // to 1 here is enough to make that safe without a separate sequential code path.
            // Every other statement (the overwhelming majority) runs exactly as before.
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
                    await insertIntersectRow(activeConnectionId, envUrl!, manyToMany, values);
                    entry = { key, state: "success" };
                  } else {
                    const { newId } = await insertRow(activeConnectionId, stmt.entityLogicalName, entitySetName, columnValues);
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
            const { ids } = await queryMatchingIds(activeConnectionId, entitySetName, meta.primaryIdAttribute, stmt.filter);
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
                    await updateRow(activeConnectionId, stmt.entityLogicalName, entitySetName, id, columnValues!);
                  } else {
                    await deleteRow(activeConnectionId, entitySetName, id);
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
          // A failure resolving the entity/matching-ids for this whole statement (not a single
          // row) — record one entry so it's still visible in the log instead of silently skipped.
          const entry: Sql4CdsLogEntry = {
            key: `语句 ${stmtLabel}`,
            state: "error",
            error: err instanceof Error ? err.message : String(err),
          };
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
      const text = buildSql4CdsBatchLogText({
        startedAt,
        finishedAt,
        connectionName: connectionName(),
        sql,
        statements: statementLogs,
        stopped,
      });
      downloadTextFile(sql4CdsBatchLogFilename(finishedAt), text);
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

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        支持 SELECT（含 JOIN / GROUP BY / 聚合函数，翻译成 FetchXML 执行）、INSERT、UPDATE、DELETE。UPDATE/DELETE
        必须带 WHERE 子句（不支持整表操作，请自己写恒真条件），执行前会弹窗二次确认，单次最多处理 5000 条匹配记录并自动下载执行日志。用 T-SQL
        语法解析，翻译成 Dataverse Web API 查询后真实执行。支持用分号分隔粘贴多条 INSERT/UPDATE/DELETE 语句一次性批量执行（可以跨不同的表），
        执行日志会合并成一份文件；批量里暂不支持 SELECT。写入按并发数（默认 {DEFAULT_WRITE_CONCURRENCY}，可调）同时发多个请求，比逐条执行快；单个请求遇到
        Dataverse 限流（429）会自动退避重试。
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">SQL</label>
          <button onClick={() => setSql(SAMPLE)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            填充示例
          </button>
        </div>
        <SqlEditor
          value={sql}
          onChange={setSql}
          schema={editorSchema}
          defaultTable={entityLogicalName ?? undefined}
          placeholder="SELECT name FROM account WHERE statecode = 0"
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
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
                {rows.length} 行
              </div>
              {rows.length > 0 && (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-[29px] z-10 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2 font-mono">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                        {columns.map((c) => (
                          <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
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
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
              待插入 {result.rows.length} 行
            </div>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-[29px] z-10 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  {result.columns.map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 font-mono">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                    {row.map((node, j) => (
                      <td key={j} className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                        {describeLiteral(node)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleInsert}
              disabled={!activeConnectionId || !entitySet || writeRunning}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {writeRunning ? "执行中…" : `执行插入 (${result.rows.length} 行)`}
            </button>
            {writeRunning && (
              <button
                onClick={handleStopWrite}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                停止
              </button>
            )}
            <ConcurrencyInput value={writeConcurrency} onChange={setWriteConcurrency} disabled={writeRunning} />
            {!activeConnectionId && <span className="text-xs text-gray-400">请先在侧边栏选择一个我的连接。</span>}
          </div>

          {writeError && (
            <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
              {writeError}
            </pre>
          )}

          {writeResults && writeResults.length > 0 && <WriteResultTable results={writeResults} stopped={writeStopped} />}
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

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleMutate}
              disabled={!activeConnectionId || !matchInfo || matchInfo.ids.length === 0 || writeRunning}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                result.action === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {writeRunning ? "执行中…" : `执行${result.action === "update" ? "更新" : "删除"}`}
            </button>
            {writeRunning && (
              <button
                onClick={handleStopWrite}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                停止
              </button>
            )}
            <ConcurrencyInput value={writeConcurrency} onChange={setWriteConcurrency} disabled={writeRunning} />
            {!activeConnectionId && <span className="text-xs text-gray-400">请先在侧边栏选择一个我的连接。</span>}
          </div>

          {writeError && (
            <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
              {writeError}
            </pre>
          )}

          {writeResults && writeResults.length > 0 && <WriteResultTable results={writeResults} stopped={writeStopped} />}
        </>
      )}

      {result.kind === "batch" && (() => {
        const orderedList: { statement: InsertResult | MutateResult; originalIndex: number; rowOrder?: number[]; rowCycleError?: string }[] =
          orderedBatch?.ordered ?? result.statements.map((s, i) => ({ statement: s, originalIndex: i }));
        const blockingCycleError = orderedBatch?.cycleError ?? orderedList.find((os) => os.rowCycleError)?.rowCycleError ?? null;
        return (
          <>
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
                批量执行 {result.statements.length} 条语句
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
                onClick={handleBatch}
                disabled={!activeConnectionId || writeRunning || orderLoading || !!blockingCycleError}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {writeRunning ? "执行中…" : `执行全部 (${result.statements.length} 条语句)`}
              </button>
              {writeRunning && (
                <button
                  onClick={handleStopWrite}
                  className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  停止
                </button>
              )}
              <ConcurrencyInput value={writeConcurrency} onChange={setWriteConcurrency} disabled={writeRunning} />
              {!activeConnectionId && <span className="text-xs text-gray-400">请先在侧边栏选择一个我的连接。</span>}
            </div>

            {writeError && (
              <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
                {writeError}
              </pre>
            )}

            {writeResults && writeResults.length > 0 && <WriteResultTable results={writeResults} stopped={writeStopped} />}
          </>
        );
      })()}
    </div>
  );
}
