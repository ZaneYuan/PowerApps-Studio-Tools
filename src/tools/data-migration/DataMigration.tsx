import { useRef, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { useSqlEditorSchema } from "../../native/useSqlEditorSchema";
import { downloadTextFile } from "../../native/download";
import {
  fetchAttributes,
  fetchDefaultViewColumnOrder,
  fetchEntityMeta,
  fetchManyToManyInfo,
  isSystemAuditField,
  sortColumnsForDisplay,
} from "../../native/metadataService";
import { runConcurrent } from "../sql4cds/concurrency";
import { buildSelectPath, literalToJsValue, parseSql, resolveSqlSubqueries } from "../sql4cds/translate";
import { insertIntersectRow, resolveIntersectRowValues, updateRow } from "../sql4cds/writeOps";
import { buildInsertSql, insertSqlFilename } from "../sql4cds/sqlGen";
import SqlEditor from "../../shared/SqlEditor";
import CheckableGrid from "../../shared/CheckableGrid";
import { planDeferredWrite, phase1Body, phase2Body } from "./deferredWrite";
import {
  buildDataMigrationLogText,
  dataMigrationLogFilename,
  type DataMigrationLogEntry,
  type DataMigrationLogPhase,
  type DataMigrationTableLog,
} from "./importLog";
import type { ImportColumn, ImportRow, ImportTable } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

const SAMPLE = `SELECT TOP 50 name, revenue, statecode
FROM account
WHERE statecode = 0`;

let tabCounter = 0;
function nextTabId(prefix: string, entityLogicalName: string): string {
  tabCounter += 1;
  return `${prefix}-${entityLogicalName}-${tabCounter}`;
}

/** A raw SELECT's split-by-`;` text still has to go through translate.ts's own `parseSql` per
 *  statement — this only splits the *text*, so each chunk parses as exactly one statement
 *  (never `kind:"batch"`). Tracks whether it's currently inside a `--` line comment or a
 *  single-quoted string literal so a `;` inside either doesn't split there — a plain `.split(";")`
 *  silently corrupted real hand-written migration scripts whose section-header comments happened
 *  to contain a `;` (e.g. "-- 2. contoso_productroomtype -- Room Type (single room type per
 *  product; WW/PTL label pair...)"): the comment's `;` cut the file mid-comment, and the orphaned
 *  continuation text glued onto the front of the next chunk made even the syntactically-fine
 *  INSERT that followed fail to parse, silently dropping that table's rows with no specific error
 *  (see bugs & requirements/8.19.md #2 — confirmed against the user's real file, which had this
 *  exact problem in three separate section comments, not just the one they happened to notice). */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inLineComment = false;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

/** A real (macrotask) yield to the browser — unlike `await` on an already-settled/cached
 *  promise (which only schedules a *microtask* and never lets the browser paint a frame), this
 *  actually gives the UI a chance to render before the next chunk of a long synchronous loop
 *  runs. Used by handleSqlFileChange so a large .sql import (thousands of INSERT statements)
 *  doesn't look completely frozen — no loading indicator would ever get painted, and the whole
 *  parse loop would run start-to-finish before the browser draws a single new frame, since
 *  `fetchEntityMeta`'s cache hits resolve via microtasks too. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Dataverse returns a Lookup column as `_logicalname_value` (with `@...` annotations alongside)
 *  — unwrap to the plain attribute name so ImportRow.values reads uniformly regardless of
 *  whether a column is a Lookup, matching the convention this app's other write tools use. */
function unwrapRow(row: Record<string, unknown>): Record<string, unknown> {
  const unwrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.includes("@")) continue;
    const plain = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -"_value".length) : key;
    unwrapped[plain] = value;
  }
  return unwrapped;
}

/** Column order/default-checked state: primary key first, then the entity's default-view columns
 *  in that view's own order, then everything else alphabetically (`sortColumnsForDisplay`) —
 *  system/audit columns (createdon, ownerid, statecode, ...) default unchecked since a migrated
 *  row should get its own from the server, not carry the source row's (`isSystemAuditField`). */
async function buildColumns(
  connectionId: string,
  entityLogicalName: string,
  primaryIdAttribute: string,
  columnNames: string[],
): Promise<ImportColumn[]> {
  const [attrs, viewOrder] = await Promise.all([
    fetchAttributes(connectionId, entityLogicalName),
    fetchDefaultViewColumnOrder(connectionId, entityLogicalName),
  ]);
  const typeByName = new Map(attrs.map((a) => [a.logicalName.toLowerCase(), a.attributeType]));
  const ordered = sortColumnsForDisplay(columnNames, primaryIdAttribute, viewOrder);
  return ordered.map((name) => ({
    key: name,
    attributeType: typeByName.get(name.toLowerCase()) ?? "String",
    checked: !isSystemAuditField(name),
  }));
}

export default function DataMigration() {
  const { activeConnectionId, connections } = useActiveConnection();

  const [sql, setSql] = useState("");
  const { schema: editorSchema, defaultTable: editingTable } = useSqlEditorSchema(activeConnectionId, sql);
  const [queryRunning, setQueryRunning] = useState(false);
  const [fileImporting, setFileImporting] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tables, setTables] = useState<ImportTable[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const activeTable = tables.find((t) => t.tabId === activeTabId) ?? null;

  function updateTable(tabId: string, next: ImportTable) {
    setTables((ts) => ts.map((t) => (t.tabId === tabId ? next : t)));
  }
  /** Replaces the previous batch from the same source (query vs. SQL-import) instead of piling
   *  on top of it — re-running "执行查询" with the same entity still in the SQL box used to leave
   *  the stale tab from the last run sitting next to the fresh one. The two sources still coexist
   *  (per the tool's own help text), so a SQL-import run never touches query tabs and vice versa. */
  function addTables(newTables: ImportTable[]) {
    if (newTables.length === 0) return;
    const source = newTables[0].source;
    setTables((ts) => [...ts.filter((t) => t.source !== source), ...newTables]);
    setActiveTabId(newTables[0].tabId);
  }

  async function handleRunQuery() {
    if (!activeConnectionId) return;
    setQueryRunning(true);
    setQueryError(null);
    setFileNote(null);
    resetWriteState(); // a previous run's results/log are about to describe a different set of tables
    try {
      const statements = splitStatements(sql);
      const newTables: ImportTable[] = [];
      const skipped: string[] = [];

      for (let i = 0; i < statements.length; i++) {
        const resolvedStatement = await resolveSqlSubqueries(activeConnectionId, statements[i]);
        const parsed = parseSql(resolvedStatement);
        if (parsed.kind !== "select-simple" && parsed.kind !== "select-complex") {
          skipped.push(`第 ${i + 1} 条`);
          continue;
        }
        const [meta, manyToMany] = await Promise.all([
          fetchEntityMeta(activeConnectionId, parsed.entityLogicalName),
          fetchManyToManyInfo(activeConnectionId, parsed.entityLogicalName),
        ]);
        const path = buildSelectPath(parsed, meta.entitySetName);
        const res = await callNative<{ value: Record<string, unknown>[] }>("dataverse.request", {
          connectionId: activeConnectionId,
          method: "GET",
          path,
        });
        const unwrapped = res.value.map(unwrapRow);
        const columnNames = unwrapped.length > 0 ? Object.keys(unwrapped[0]) : parsed.kind === "select-simple" && parsed.select ? parsed.select.split(",").map((c) => c.trim()) : [];
        const columns = await buildColumns(activeConnectionId, parsed.entityLogicalName, meta.primaryIdAttribute, columnNames);
        const rows: ImportRow[] = unwrapped.map((r) => ({
          id: String(r[meta.primaryIdAttribute]),
          values: r,
          checked: false,
        }));
        newTables.push({
          tabId: nextTabId("query", parsed.entityLogicalName),
          entityLogicalName: parsed.entityLogicalName,
          entitySetName: meta.entitySetName,
          primaryIdAttribute: meta.primaryIdAttribute,
          source: "query",
          columns,
          rows,
          isIntersect: !!manyToMany,
          manyToManyInfo: manyToMany ?? undefined,
        });
      }

      addTables(newTables);
      if (skipped.length > 0) setFileNote(`${skipped.join("、")}不是 SELECT 查询，已跳过。`);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueryRunning(false);
    }
  }

  async function handleSqlFileChange(file: File) {
    if (!activeConnectionId) return;
    setQueryError(null);
    setFileNote(null);
    resetWriteState(); // a previous run's results/log are about to describe a different set of tables
    setFileImporting(true);
    // Let React actually paint the "导入中…" state before the parse loop below starts — a
    // plain `await` here wouldn't do it: the loop's own `await fetchEntityMeta(...)` calls hit
    // that function's cache after the first row, and an already-settled promise resolves via a
    // microtask, which the browser never gets a chance to paint a frame around. Without this,
    // a large file (thousands of INSERT rows) ran start-to-finish as what looked like one
    // frozen, unresponsive click — this is the fix for `bugs & requirements/8.18.md` #11
    // ("选择了sql点了没反应").
    await yieldToBrowser();
    try {
      const text = await file.text();
      setSql(text); // show what was actually uploaded, so a statement that didn't get recognized can be seen and checked directly, not just reasoned about from the summary counts
      const statements = splitStatements(text);
      const insertsByEntity = new Map<string, { columns: Set<string>; rows: { pkValue: string; values: Record<string, unknown> }[] }>();
      let ignoredCount = 0;
      let skippedNoPk = 0;

      for (let i = 0; i < statements.length; i++) {
        // Periodic yield (not just the one above) — keeps the tab responsive/repainting
        // through the rest of a long import instead of just showing "导入中…" once and then
        // still freezing solid for however long the remaining thousands of rows take.
        if (i > 0 && i % 200 === 0) await yieldToBrowser();

        const parsed = parseSql(statements[i]);
        if (parsed.kind !== "insert") {
          ignoredCount++;
          continue;
        }
        const meta = await fetchEntityMeta(activeConnectionId, parsed.entityLogicalName);
        const pkIndex = parsed.columns.findIndex((c) => c.toLowerCase() === meta.primaryIdAttribute.toLowerCase());
        if (pkIndex === -1) {
          skippedNoPk += parsed.rows.length;
          continue;
        }
        const entry = insertsByEntity.get(parsed.entityLogicalName) ?? { columns: new Set<string>(), rows: [] };
        parsed.columns.forEach((c) => entry.columns.add(c));
        for (const row of parsed.rows) {
          const values: Record<string, unknown> = {};
          parsed.columns.forEach((col, idx) => {
            const v = literalToJsValue(row[idx]);
            if (v !== null) values[col] = v;
            else values[col] = null;
          });
          entry.rows.push({ pkValue: String(literalToJsValue(row[pkIndex])), values });
        }
        insertsByEntity.set(parsed.entityLogicalName, entry);
      }

      const newTables: ImportTable[] = [];
      for (const [entityLogicalName, group] of insertsByEntity) {
        const [meta, manyToMany] = await Promise.all([
          fetchEntityMeta(activeConnectionId, entityLogicalName),
          fetchManyToManyInfo(activeConnectionId, entityLogicalName),
        ]);
        const columns = await buildColumns(activeConnectionId, entityLogicalName, meta.primaryIdAttribute, Array.from(group.columns));
        const rows: ImportRow[] = group.rows.map((r) => ({ id: r.pkValue, values: r.values, checked: true }));
        newTables.push({
          tabId: nextTabId("sql", entityLogicalName),
          entityLogicalName,
          entitySetName: meta.entitySetName,
          primaryIdAttribute: meta.primaryIdAttribute,
          source: "sql-insert",
          columns,
          rows,
          isIntersect: !!manyToMany,
          manyToManyInfo: manyToMany ?? undefined,
        });
      }

      addTables(newTables);
      const notes: string[] = [];
      if (ignoredCount > 0) notes.push(`已忽略 ${ignoredCount} 条非 INSERT 语句`);
      if (skippedNoPk > 0) notes.push(`${skippedNoPk} 行因为 INSERT 没有显式写主键列，无法识别自身 ID，已跳过`);
      if (notes.length > 0) setFileNote(notes.join("；") + "。");
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileImporting(false);
    }
  }

  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [writeRunning, setWriteRunning] = useState(false);
  const [writeResults, setWriteResults] = useState<DataMigrationLogEntry[] | null>(null);
  const [writeLog, setWriteLog] = useState<{ filename: string; text: string } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeConcurrency, setWriteConcurrency] = useState(8);
  const stopRequestedRef = useRef(false);
  const [writeStopped, setWriteStopped] = useState(false);

  /** Loading a fresh batch (a new query run or SQL-file upload) makes any previous run's
   *  results/log describe tables that are no longer even on screen — cleared so a stale
   *  "导入成功…" summary and download button don't linger next to unrelated freshly-loaded data. */
  function resetWriteState() {
    setWriteResults(null);
    setWriteLog(null);
    setWriteError(null);
    setWriteStopped(false);
  }

  function targetConnectionName(): string {
    return connections.find((c) => c.id === targetConnectionId)?.name ?? targetConnectionId;
  }
  function targetEnvironmentUrl(): string | undefined {
    return connections.find((c) => c.id === targetConnectionId)?.environmentUrl;
  }

  const totalCheckedRows = tables.reduce((n, t) => n + t.rows.filter((r) => r.checked).length, 0);

  async function handleImport() {
    if (!targetConnectionId || totalCheckedRows === 0) return;
    const plan = planDeferredWrite(tables);
    const intersectTables = tables.filter((t) => t.isIntersect);
    const intersectRowCount = intersectTables.reduce((n, t) => n + t.rows.filter((r) => r.checked).length, 0);
    const checkedTableCount = tables.filter((t) => t.rows.some((r) => r.checked)).length;

    if (
      !confirm(
        `即将向 ${targetConnectionName()} 导入 ${totalCheckedRows} 行（共 ${checkedTableCount} 张表）。` +
          (plan.deferredRowCount > 0 ? `其中 ${plan.deferredRowCount} 行有字段引用了本批数据里还没创建的记录，会先创建、再单独回填。` : "") +
          `\n\n确定吗？`,
      )
    )
      return;

    setWriteRunning(true);
    setWriteResults([]);
    setWriteLog(null);
    setWriteError(null);
    stopRequestedRef.current = false;
    setWriteStopped(false);
    const startedAt = new Date();
    const tableLogs = new Map<string, DataMigrationTableLog>();
    for (const t of tables) {
      tableLogs.set(t.tabId, { entityLogicalName: t.entityLogicalName, entitySetName: t.entitySetName, source: t.source, entries: [] });
    }
    let stopped = false;

    function recordResult(
      tabId: string,
      phase: DataMigrationLogPhase,
      entry: { key: string; state: "success" | "error"; error?: string },
    ) {
      const fullEntry: DataMigrationLogEntry = { ...entry, phase };
      tableLogs.get(tabId)?.entries.push(fullEntry);
      setWriteResults((r) => [...(r ?? []), fullEntry]);
    }

    try {
      // Phase 1: every checked row's non-deferred fields.
      await runConcurrent(
        plan.rows,
        writeConcurrency,
        async (rowPlan) => {
          try {
            await updateRow(targetConnectionId, rowPlan.table.entityLogicalName, rowPlan.table.entitySetName, rowPlan.row.id, phase1Body(rowPlan));
            recordResult(rowPlan.table.tabId, "create", { key: rowPlan.row.id, state: "success" });
          } catch (err) {
            recordResult(rowPlan.table.tabId, "create", { key: rowPlan.row.id, state: "error", error: err instanceof Error ? err.message : String(err) });
          }
        },
        () => stopRequestedRef.current,
      );
      if (stopRequestedRef.current) {
        stopped = true;
        setWriteStopped(true);
      }

      // Phase 2: backfill deferred fields — only for rows whose phase-1 write actually succeeded.
      if (!stopped) {
        const phase1Failed = new Set(
          Array.from(tableLogs.values())
            .flatMap((t) => t.entries)
            .filter((e) => e.state === "error")
            .map((e) => e.key),
        );
        const toBackfill = plan.rows.filter((p) => p.deferredColumns.length > 0 && !phase1Failed.has(p.row.id));
        await runConcurrent(
          toBackfill,
          writeConcurrency,
          async (rowPlan) => {
            const key = `${rowPlan.row.id} (回填 ${rowPlan.deferredColumns.join(", ")})`;
            try {
              await updateRow(targetConnectionId, rowPlan.table.entityLogicalName, rowPlan.table.entitySetName, rowPlan.row.id, phase2Body(rowPlan));
              recordResult(rowPlan.table.tabId, "backfill", { key, state: "success" });
            } catch (err) {
              recordResult(rowPlan.table.tabId, "backfill", { key, state: "error", error: err instanceof Error ? err.message : String(err) });
            }
          },
          () => stopRequestedRef.current,
        );
        if (stopRequestedRef.current) {
          stopped = true;
          setWriteStopped(true);
        }
      }

      // Phase 3: N:N intersect associations — need both sides to already exist, so these run last.
      if (!stopped && intersectRowCount > 0) {
        for (const table of intersectTables) {
          if (stopRequestedRef.current) {
            stopped = true;
            setWriteStopped(true);
            break;
          }
          const envUrl = targetEnvironmentUrl();
          const checkedRows = table.rows.filter((r) => r.checked);
          if (!table.manyToManyInfo || !envUrl) {
            for (const row of checkedRows) {
              recordResult(table.tabId, "associate", { key: row.id, state: "error", error: "找不到多对多关系元数据或目标连接的环境 URL。" });
            }
            continue;
          }
          await runConcurrent(
            checkedRows,
            writeConcurrency,
            async (row) => {
              try {
                const values = resolveIntersectRowValues(table.manyToManyInfo!, row.values);
                await insertIntersectRow(targetConnectionId, envUrl, table.manyToManyInfo!, values);
                recordResult(table.tabId, "associate", { key: row.id, state: "success" });
              } catch (err) {
                recordResult(table.tabId, "associate", { key: row.id, state: "error", error: err instanceof Error ? err.message : String(err) });
              }
            },
            () => stopRequestedRef.current,
          );
        }
      }

      const finishedAt = new Date();
      const text = buildDataMigrationLogText({
        startedAt,
        finishedAt,
        targetConnectionName: targetConnectionName(),
        tables: Array.from(tableLogs.values()).filter((t) => t.entries.length > 0),
        stopped,
      });
      setWriteLog({ filename: dataMigrationLogFilename(finishedAt), text });
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteRunning(false);
    }
  }

  function handleStop() {
    stopRequestedRef.current = true;
  }

  /** Downloads a standalone `INSERT INTO ... VALUES ...;` for the active tab's checked rows/columns
   *  — one statement per tab (mirrors this tool's whole "one table per tab" model), not the full
   *  multi-table batch at once. */
  function handleGenerateSql() {
    if (!activeTable) return;
    const checkedColumns = activeTable.columns.filter((c) => c.checked);
    const checkedRows = activeTable.rows.filter((r) => r.checked);
    if (checkedColumns.length === 0 || checkedRows.length === 0) return;
    const sql = buildInsertSql(
      activeTable.entityLogicalName,
      checkedColumns.map((c) => c.key),
      checkedRows.map((r) => r.values),
    );
    downloadTextFile(insertSqlFilename("data-migration", activeTable.entityLogicalName, new Date()), sql);
  }

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
        默认模式：写一条或多条 `;` 分隔的 SELECT（可以查不同的表），对本页连接执行，每条查询结果各开一个 Tab，行默认不勾选、列默认全选。也可以点"以
        SQL 导入"上传一个 `.sql` 文件——文件里的 INSERT 语句按表分组同样落进 Tab（行、列都默认全选），非 INSERT
        语句会被忽略并提示。两种来源的 Tab 共存，配置好勾选后选一个目标连接点导入——自动识别这批数据里"一张表引用了另一张表还没创建的记录"这种依赖，先创建所有行（引用的字段先留空），再统一回填，不需要手动排好表的导入顺序。
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">查询（SELECT，可多条）</label>
          <button onClick={() => setSql(SAMPLE)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            填充示例
          </button>
        </div>
        <SqlEditor
          value={sql}
          onChange={setSql}
          schema={editorSchema}
          defaultTable={editingTable}
          placeholder="SELECT name FROM account WHERE statecode = 0"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRunQuery}
            disabled={!activeConnectionId || queryRunning}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {queryRunning ? "查询中…" : "执行查询"}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!activeConnectionId || fileImporting}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {fileImporting ? "导入中…" : "以 SQL 导入…"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleSqlFileChange(f);
            }}
          />
          {!activeConnectionId && <span className="text-xs text-gray-400">请先在侧边栏选择一个本页连接。</span>}
        </div>
        {queryError && (
          <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
            {queryError}
          </pre>
        )}
        {fileNote && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            {fileNote}
          </p>
        )}
      </div>

      {tables.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
            {tables.map((t) => (
              <button
                key={t.tabId}
                onClick={() => setActiveTabId(t.tabId)}
                className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${
                  t.tabId === activeTabId
                    ? "border border-b-0 border-gray-200 bg-white text-blue-600 dark:border-gray-800 dark:bg-gray-950 dark:text-blue-400"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {t.source === "query" ? "🔍" : "📄"} {t.entityLogicalName}（{t.rows.length}）
              </button>
            ))}
          </div>

          {activeTable && (
            <CheckableGrid
              columns={activeTable.columns}
              rows={activeTable.rows}
              columnsLabel="要迁移的列（勾选）"
              renderColumnBadge={(c) =>
                (c as ImportColumn).attributeType === "Lookup" && (
                  <span className="text-purple-500 dark:text-purple-400">(Lookup)</span>
                )
              }
              onColumnsChange={(columns) => updateTable(activeTable.tabId, { ...activeTable, columns: columns as ImportColumn[] })}
              onRowsChange={(rows) => updateTable(activeTable.tabId, { ...activeTable, rows })}
            />
          )}

          {activeTable && (
            <div className="flex justify-end">
              <button
                onClick={handleGenerateSql}
                disabled={activeTable.rows.filter((r) => r.checked).length === 0}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                生成当前表的 INSERT SQL
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              共 {tables.length} 张表，已勾选 {totalCheckedRows} 行 → 目标连接：
            </span>
            <select value={targetConnectionId} onChange={(e) => setTargetConnectionId(e.target.value)} className={inputCls}>
              <option value="">选择目标连接…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleImport}
              disabled={!targetConnectionId || totalCheckedRows === 0 || writeRunning}
              className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {writeRunning ? "导入中…" : `导入选中的 ${totalCheckedRows} 行`}
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

          {writeResults &&
            writeResults.length > 0 &&
            (() => {
              // "导入" = create (phase 1) + associate (phase 3) entries — each is one distinct
              // source row's primary write. "依赖回填" (backfill, phase 2) is a supplementary
              // follow-up only for rows with deferred columns, so folding it into one flat total
              // double-counts those rows (see 8.19.md #1: a 52-row batch showed "成功 106").
              const imported = writeResults.filter((r) => r.phase !== "backfill");
              const backfilled = writeResults.filter((r) => r.phase === "backfill");
              const importSuccess = imported.filter((r) => r.state === "success").length;
              const importError = imported.length - importSuccess;
              const backfillSuccess = backfilled.filter((r) => r.state === "success").length;
              const backfillError = backfilled.length - backfillSuccess;
              return (
                <div className="max-h-[40vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
                  <div className="inline-block min-w-full align-top">
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
                      <span>
                        {writeStopped && <span className="mr-1 font-medium text-amber-600 dark:text-amber-400">⚠ 已手动停止 —</span>}
                        导入成功 {importSuccess} 行，失败 {importError} 行
                        {backfilled.length > 0 && `；依赖回填成功 ${backfillSuccess} 处，失败 ${backfillError} 处`}
                      </span>
                      {writeLog && (
                        <button
                          onClick={() => downloadTextFile(writeLog.filename, writeLog.text)}
                          className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                          下载日志
                        </button>
                      )}
                    </div>
                    <table className="w-full text-left text-sm">
                      <tbody>
                        {writeResults.map((r, i) => (
                          <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{r.key}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                              {r.state === "success" ? (
                                <span className="text-green-600 dark:text-green-400">成功</span>
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
              );
            })()}
        </>
      )}
    </div>
  );
}
