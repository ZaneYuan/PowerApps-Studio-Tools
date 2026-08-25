import { useRef, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { useSqlEditorSchema } from "../../native/useSqlEditorSchema";
import { downloadTextFile } from "../../native/download";
import { unwrapODataRowWithFormatting } from "../../native/odata";
import { fetchAttributes, fetchDefaultViewColumnOrder, fetchEntityMeta, sortColumnsForDisplay } from "../../native/metadataService";
import { runConcurrent } from "../sql4cds/concurrency";
import { buildSelectPath, parseSql, resolveSqlSubqueries } from "../sql4cds/translate";
import { deleteRow, insertRow, updateRow } from "../sql4cds/writeOps";
import { buildSql4CdsLogText, sql4CdsLogFilename, type Sql4CdsLogEntry } from "../sql4cds/executionLog";
import { buildInsertSql, insertSqlFilename } from "../sql4cds/sqlGen";
import SqlEditor from "../../shared/SqlEditor";
import CheckableGrid, { applyEditedLabel, type GridColumn, type GridRow } from "../../shared/CheckableGrid";
import { buildEditableGridColumns, convertEditedCellValue } from "../../shared/gridColumns";
import { dirtyColumnKeys, isRowDirty, valuesEqual } from "../../shared/dirtyTracking";
import UnsavedChangesBadge from "../../shared/UnsavedChangesBadge";
import { useAlertDialog, useConfirmDialog } from "../../shared/ConfirmDialog";
import ErrorMessage from "../../shared/ErrorMessage";

const SAMPLE = `SELECT name, description FROM account WHERE statecode = 0`;

/** Keeps the SQL box's SELECT column list in sync with the checkbox grid instead of leaving a
 *  stale `*` (or a stale explicit list) once columns get checked/unchecked — text-replaces just
 *  the column list between `SELECT [TOP n]` and `FROM`, leaving WHERE/ORDER BY/casing/whitespace
 *  untouched, rather than re-serializing a full parsed statement back to SQL (translate.ts has no
 *  such serializer, and doesn't need one just for this). No-ops (returns the input unchanged) when
 *  there are no checked columns — an empty SELECT list isn't valid SQL, and the user still needs
 *  to see/fix the query rather than have it silently mangled. Only ever called on a query that
 *  already passed handleRunQuery's select-simple-only check, so the shape is always exactly
 *  `SELECT [TOP n] <cols> FROM ...`. */
export function replaceSelectColumns(sqlText: string, columnNames: string[]): string {
  if (columnNames.length === 0) return sqlText;
  const columnList = columnNames.join(", ");
  return sqlText.replace(/^(\s*SELECT\s+(?:TOP\s+\d+\s+)?)([\s\S]*?)(\s+FROM\s)/i, (_m, pre: string, _cols: string, post: string) => `${pre}${columnList}${post}`);
}

export default function DataEdit() {
  const { activeConnectionId, connections } = useActiveConnection();
  const confirmDialog = useConfirmDialog();
  const alertDialog = useAlertDialog();

  const [sql, setSql] = useState("");
  const { schema: editorSchema, defaultTable: editingTable } = useSqlEditorSchema(activeConnectionId, sql);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [entityLogicalName, setEntityLogicalName] = useState<string | null>(null);
  const [entitySetName, setEntitySetName] = useState("");
  const [primaryIdAttribute, setPrimaryIdAttribute] = useState("");
  const [columns, setColumns] = useState<GridColumn[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);

  const [writeRunning, setWriteRunning] = useState(false);
  // Which of the two write buttons is actually in flight — handleSubmit and handleDelete share
  // `writeRunning` (a row mid-update shouldn't also be deletable, and vice versa, so both buttons
  // disable together) but each needs its own "…中" label instead of both changing at once.
  const [writeKind, setWriteKind] = useState<"submit" | "delete">("submit");
  const [writeResults, setWriteResults] = useState<Sql4CdsLogEntry[] | null>(null);
  const [writeLog, setWriteLog] = useState<{ filename: string; text: string } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeConcurrency, setWriteConcurrency] = useState(8);
  const [writeSkippedCount, setWriteSkippedCount] = useState(0);
  const stopRequestedRef = useRef(false);
  const [writeStopped, setWriteStopped] = useState(false);

  // 勾选了主键 ID 列 = 更新模式（PATCH 回原记录），未勾选 = 创建模式（复制成新记录）。
  const isUpdateMode = !!primaryIdAttribute && columns.some((c) => c.key.toLowerCase() === primaryIdAttribute.toLowerCase() && c.checked);

  // The primary key column never gets sent in the body either way — a create always gets a fresh
  // server-generated id, and an update targets it via the URL, not the PATCH body.
  const checkedColumns = columns.filter((c) => c.checked && c.key.toLowerCase() !== primaryIdAttribute.toLowerCase());
  const checkedRows = rows.filter((r) => r.checked);
  // 更新模式下，只有这一行里勾选的字段相对查询结果确实发生了变更，才真正提交——这份判断同时驱动
  // "更新 N 条记录"按钮本身该不该可点、以及按钮上的 N（不是"勾了几行"，是"真的会提交几行"），也
  // 是 handleSubmit 实际执行时用来跳过未变更行的同一份逻辑，两处不会各写一套、悄悄走出两个数字
  // （Bugs/8.24.md #9）。创建模式没有"原值"可比，勾了就都算数。
  const rowsToSubmit = isUpdateMode
    ? checkedRows.filter((row) => {
        const original = row.originalValues;
        if (!original) return true; // 理论上不会发生（快照缺失），保守按"已变更"处理
        return checkedColumns.some((c) => !valuesEqual(row.values[c.key], original[c.key]));
      })
    : checkedRows;

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
      const resolvedSql = sql.trim() ? await resolveSqlSubqueries(activeConnectionId, sql) : sql;
      const parsed = parseSql(resolvedSql);
      if (parsed.kind === "empty") return;
      if (parsed.kind === "error") {
        setQueryError(parsed.error);
        return;
      }
      if (parsed.kind !== "select-simple" && parsed.kind !== "select-complex") {
        setQueryError("请输入一条 SELECT 语句 — 数据编辑只用来查询、编辑、再更新/新建，不执行 INSERT/UPDATE/DELETE。");
        return;
      }
      if (parsed.kind === "select-complex") {
        setQueryError("数据编辑只支持单表 SELECT，不支持 JOIN / GROUP BY 聚合（结果里的聚合列没法原样写回）。需要这类查询请用 SQL4CDS。");
        return;
      }

      const meta = await fetchEntityMeta(activeConnectionId, parsed.entityLogicalName);
      const path = buildSelectPath(parsed, meta.entitySetName);
      const res = await callNative<{ value: Record<string, unknown>[] }>("dataverse.request", {
        connectionId: activeConnectionId,
        method: "GET",
        path,
        includeFormattedValues: true,
      });
      const unwrapped = res.value.map(unwrapODataRowWithFormatting);
      const rawColumnNames =
        unwrapped.length > 0 ? Object.keys(unwrapped[0].fields) : parsed.select ? parsed.select.split(",").map((c) => c.trim()) : [];

      const [attrs, viewOrder] = await Promise.all([
        fetchAttributes(activeConnectionId, parsed.entityLogicalName),
        fetchDefaultViewColumnOrder(activeConnectionId, parsed.entityLogicalName),
      ]);
      const typeByName = new Map(attrs.map((a) => [a.logicalName.toLowerCase(), a.attributeType]));
      // Primary key first, then default-view order, then alphabetical — same ordering Data
      // Migration uses. System/audit columns (createdon, ownerid, statecode, ...) default
      // unchecked: a copy should get its own from the server, not the source row's. The primary
      // key itself isn't an audit field, so it defaults checked — meaning this tool opens in
      // "更新" mode by default, matching its primary use case (edit-in-place).
      const columnNames = sortColumnsForDisplay(rawColumnNames, meta.primaryIdAttribute, viewOrder);
      const newColumns = await buildEditableGridColumns(activeConnectionId, parsed.entityLogicalName, columnNames, typeByName, meta.primaryIdAttribute);
      // Rows themselves default *unchecked* (unlike the columns above) — 数据编辑 only wants to
      // submit rows the user actually touched, so ticking a row is either manual or (see
      // handleEditCell below) an automatic side effect of really editing one of its fields.
      // `originalValues` doubles as the baseline `handleSubmit`'s dirty-row skip and
      // CheckableGrid's own per-field modified marker both compare against — safe to alias the
      // same `fields` object rather than clone it, since edits always replace `values` wholesale
      // via spread and never mutate it in place.
      const newRows: GridRow[] = unwrapped.map((u) => ({
        id: String(u.fields[meta.primaryIdAttribute]),
        checked: false,
        values: u.fields,
        originalValues: u.fields,
        formattedValues: u.formattedFields,
      }));

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

  /** A row starts out unchecked (see handleRunQuery) — actually editing one of its fields ticks it
   *  automatically, so the common case ("query, tweak a few rows, submit") never needs a manual
   *  checkbox click at all. Only a *real* change (per the same valuesEqual click-in-click-out
   *  tolerance handleSubmit's own skip-unchanged filter uses) does this; a click that leaves the
   *  value exactly as loaded doesn't tick the row on its own. Deliberately one-directional — this
   *  never *un*checks a row the user (or a previous edit) already ticked, so editing a second field
   *  and then reverting the first doesn't make the row disappear from what's about to be submitted. */
  function handleEditCell(rowId: string, columnKey: string, value: string, label?: string) {
    const finalValue = convertEditedCellValue(columns.find((c) => c.key === columnKey), value);
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== rowId) return r;
        const madeRealChange = !valuesEqual(finalValue, r.originalValues?.[columnKey]);
        return {
          ...r,
          checked: r.checked || madeRealChange,
          values: { ...r.values, [columnKey]: finalValue },
          formattedValues: applyEditedLabel(r.formattedValues, columnKey, label),
        };
      }),
    );
  }

  function handleStop() {
    stopRequestedRef.current = true;
  }

  /** Downloads a standalone `INSERT INTO ... VALUES ...;` for whatever's currently checked — the
   *  primary key stays in if the user hasn't unchecked it (unlike handleSubmit's create path,
   *  which always drops it), since this is meant to produce a portable script (e.g. for Data
   *  Migration's own "以 SQL 导入", or hand-carrying exact GUIDs into another org), not a
   *  fresh-id copy. Independent of 更新/创建 mode — it just dumps whatever's checked right now. */
  function handleGenerateSql() {
    if (!entityLogicalName) return;
    const checkedColumns = columns.filter((c) => c.checked);
    const checkedRows = rows.filter((r) => r.checked);
    if (checkedColumns.length === 0 || checkedRows.length === 0) return;
    const sql = buildInsertSql(
      entityLogicalName,
      checkedColumns.map((c) => c.key),
      checkedRows.map((r) => r.values),
    );
    downloadTextFile(insertSqlFilename("data-edit", entityLogicalName, new Date()), sql);
  }

  async function handleSubmit() {
    if (!activeConnectionId || !entityLogicalName) return;
    const isUpdate = isUpdateMode;
    if (checkedColumns.length === 0 || checkedRows.length === 0) return;

    // rowsToSubmit/skippedCount are the same hoisted values the button's own label/disabled state
    // already reads (see their declaration below) — handleSubmit doesn't recompute a second copy
    // of "which rows actually have real changes" that could quietly drift from what the button
    // told the user would happen (Bugs/8.24.md #9).
    const skippedCount = checkedRows.length - rowsToSubmit.length;

    if (rowsToSubmit.length === 0) {
      await alertDialog(isUpdate ? "勾选的行都没有字段值变更，无需更新。" : "没有可创建的行。");
      return;
    }
    const confirmMsg = isUpdate
      ? `即将在 ${connectionName()} 更新 ${rowsToSubmit.length} 条 ${entityLogicalName} 记录${
          skippedCount > 0 ? `（另有 ${skippedCount} 条未变更，已自动跳过）` : ""
        }，确定吗？`
      : `即将在 ${connectionName()} 创建 ${rowsToSubmit.length} 条新的 ${entityLogicalName} 记录，确定吗？`;
    if (!(await confirmDialog(confirmMsg))) return;

    setWriteRunning(true);
    setWriteKind("submit");
    setWriteResults([]);
    setWriteLog(null);
    setWriteError(null);
    setWriteSkippedCount(skippedCount);
    stopRequestedRef.current = false;
    setWriteStopped(false);
    const startedAt = new Date();
    const entries: Sql4CdsLogEntry[] = [];
    // Rows that actually made it to Dataverse — reset to "clean" below once the whole batch
    // finishes (unchecked, ❗ cleared) so a successful submit doesn't keep nagging "still pending"
    // (Bugs/8.24.md #6). A row that errored keeps its checked/dirty state exactly as-is: its
    // edited value never actually landed in Dataverse, so silently treating it as the new
    // baseline would make a later re-submit skip that field entirely, thinking it already matches.
    const succeededRowIds = new Set<string>();
    let stopped = false;

    try {
      await runConcurrent(
        rowsToSubmit,
        writeConcurrency,
        async (row, i) => {
          const key = isUpdate ? row.id : `第 ${i + 1} 行（复制自 ${row.id}）`;
          let entry: Sql4CdsLogEntry;
          try {
            // 更新模式下 body 只带这一行真正变了的字段，不是勾选的全部字段——避免把没动过的字段也
            // PATCH 一遍（不必要地触发绑定在那些字段上的插件/工作流，也可能覆盖掉查询之后被别人改过
            // 的、这次编辑压根没打算碰的值）。创建模式没有"原值"可比，仍然照旧带上勾选的全部字段。
            const columnKeysToSend = isUpdate
              ? new Set(dirtyColumnKeys(row, checkedColumns.map((c) => c.key)))
              : null;
            const body = Object.fromEntries(
              checkedColumns.filter((c) => !columnKeysToSend || columnKeysToSend.has(c.key)).map((c) => [c.key, row.values[c.key] ?? null]),
            );
            if (isUpdate) {
              await updateRow(activeConnectionId, entityLogicalName, entitySetName, row.id, body);
              entry = { key, state: "success" };
            } else {
              const { newId } = await insertRow(activeConnectionId, entityLogicalName, entitySetName, body);
              entry = { key, state: "success", detail: newId ?? undefined };
            }
            succeededRowIds.add(row.id);
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
      if (succeededRowIds.size > 0) {
        setRows((rs) => rs.map((r) => (succeededRowIds.has(r.id) ? { ...r, checked: false, originalValues: r.values } : r)));
      }

      const finishedAt = new Date();
      const baseText = buildSql4CdsLogText({
        startedAt,
        finishedAt,
        connectionName: connectionName(),
        action: isUpdate ? "update" : "insert",
        entityLogicalName,
        entitySetName,
        sql,
        entries,
        stopped,
      });
      const text = skippedCount > 0 ? `${baseText}\n\n（另有 ${skippedCount} 行因字段值未变更被跳过，未提交）` : baseText;
      const filename = sql4CdsLogFilename(isUpdate ? "update" : "insert", entityLogicalName, finishedAt);
      setWriteLog({ filename, text });
      // Only auto-download when something actually needs looking at — a clean all-success run
      // doesn't need the file pushed on the user unasked; 下载日志 is still right there to grab it
      // manually. See Bugs/8.24.md #5.
      if (entries.some((e) => e.state === "error")) downloadTextFile(filename, text);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteRunning(false);
    }
  }

  /** Independent of 更新/创建模式 (that toggle only decides what handleSubmit does with the
   *  primary key column) — deleting only ever needs the row's own id, so it's driven purely by
   *  which rows are checked, same as 生成 INSERT SQL. */
  async function handleDelete() {
    if (!activeConnectionId || !entityLogicalName) return;
    if (checkedRows.length === 0) return;
    if (
      !(await confirmDialog({
        message: `即将在 ${connectionName()} 删除 ${checkedRows.length} 条 ${entityLogicalName} 记录，此操作不可撤销，确定吗？`,
        confirmLabel: "删除",
        danger: true,
      }))
    )
      return;

    setWriteRunning(true);
    setWriteKind("delete");
    setWriteResults([]);
    setWriteLog(null);
    setWriteError(null);
    setWriteSkippedCount(0);
    stopRequestedRef.current = false;
    setWriteStopped(false);
    const startedAt = new Date();
    const entries: Sql4CdsLogEntry[] = [];
    // Rows Dataverse actually confirmed deleting — dropped from the grid entirely below once the
    // batch finishes, not just unchecked, since the record genuinely no longer exists (leaving it
    // displayed would invite trying to "update" something that's already gone). A row that
    // errored stays in the grid exactly as it was, still checked, so it's obvious what didn't go
    // through and still selected to retry.
    const succeededRowIds = new Set<string>();
    let stopped = false;

    try {
      await runConcurrent(
        checkedRows,
        writeConcurrency,
        async (row) => {
          let entry: Sql4CdsLogEntry;
          try {
            await deleteRow(activeConnectionId, entitySetName, row.id);
            entry = { key: row.id, state: "success" };
            succeededRowIds.add(row.id);
          } catch (err) {
            entry = { key: row.id, state: "error", error: err instanceof Error ? err.message : String(err) };
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
      if (succeededRowIds.size > 0) {
        setRows((rs) => rs.filter((r) => !succeededRowIds.has(r.id)));
      }

      const finishedAt = new Date();
      const text = buildSql4CdsLogText({
        startedAt,
        finishedAt,
        connectionName: connectionName(),
        action: "delete",
        entityLogicalName,
        entitySetName,
        sql,
        entries,
        stopped,
      });
      const filename = sql4CdsLogFilename("delete", entityLogicalName, finishedAt);
      setWriteLog({ filename, text });
      // Only auto-download when something actually needs looking at — see Bugs/8.24.md #5.
      if (entries.some((e) => e.state === "error")) downloadTextFile(filename, text);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteRunning(false);
    }
  }

  const checkedRowCount = checkedRows.length;
  const isDirty = rows.some(isRowDirty);

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <UnsavedChangesBadge dirty={isDirty} />
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        写一条单表 SELECT 查出要处理的数据（对本页连接执行），结果表格可以直接编辑——支持文本、选项集（Picklist）、查找（Lookup/Customer/Owner，点 🔍
        搜索选择目标记录，表格里显示的是名称而非 GUID）三种类型的字段编辑，其余类型只读展示；列标题右边缘可拖拽调整宽度。列默认全部勾选，行默认不勾选——手动勾选，或编辑某行任意字段自动勾选该行；被改过的字段会标一个
        ❗。勾选主键 ID 列（默认已勾选）时按钮是"更新"——仅当某行的字段值相对查询结果确实变了才会真正提交，未变更的行自动跳过（按钮上的数字和是否可点也是按"真的会提交几行"算的，不是按"勾了几行"）；提交的 PATCH 也只带这一行真正变了的字段，没动过的字段不会被带上；取消勾选主键 ID
        列则变成"创建"——把勾选的行按当前值创建成全新记录，主键 ID 列不会被带上，由 Dataverse 自动生成新的。"删除"跟更新/创建模式无关，只看勾选了哪些行，直接删掉对应记录，不可撤销。只支持单表，不支持 JOIN /
        聚合。
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">查询（单条 SELECT）</label>
          <button onClick={() => setSql(SAMPLE)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            填充示例
          </button>
        </div>
        <SqlEditor
          value={sql}
          onChange={setSql}
          schema={editorSchema}
          defaultTable={editingTable}
          placeholder="SELECT name, description FROM account WHERE statecode = 0"
        />
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
        {queryError && <ErrorMessage error={queryError} />}
        {!entityLogicalName && !queryError && !queryRunning && (
          <p className="text-xs text-gray-400">输入并执行查询后，结果会显示在这里。</p>
        )}
      </div>

      {entityLogicalName && rows.length === 0 && <p className="text-xs text-gray-400">查询结果为空（0 行）。</p>}

      {entityLogicalName && rows.length > 0 && (
        <>
          <CheckableGrid
            // Remounts on a new query so a sort/filter from a previous entity's grid doesn't
            // carry over onto a different entity's (possibly same-named) columns.
            key={entityLogicalName}
            columns={columns}
            rows={rows}
            columnsLabel="要处理的列（勾选，文本/选项集/查找字段可直接编辑，列宽可拖拽；勾选主键 ID 列 = 更新，取消勾选 = 创建新记录）"
            onColumnsChange={handleColumnsChange}
            onRowsChange={setRows}
            onEditCell={handleEditCell}
            connectionId={activeConnectionId ?? undefined}
            entityLogicalName={entityLogicalName ?? undefined}
          />

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <button
              onClick={handleSubmit}
              disabled={!activeConnectionId || rowsToSubmit.length === 0 || writeRunning}
              title={isUpdateMode && checkedRowCount > 0 && rowsToSubmit.length === 0 ? "勾选的行都没有字段值变更，无需更新" : undefined}
              className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                isUpdateMode ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {writeRunning && writeKind === "submit"
                ? isUpdateMode
                  ? "更新中…"
                  : "创建中…"
                : isUpdateMode
                  ? `更新 ${rowsToSubmit.length} 条记录`
                  : `创建 ${rowsToSubmit.length} 条新记录`}
            </button>
            <button
              onClick={handleDelete}
              disabled={!activeConnectionId || checkedRowCount === 0 || writeRunning}
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {writeRunning && writeKind === "delete" ? "删除中…" : `删除 ${checkedRowCount} 条记录`}
            </button>
            <button
              onClick={handleGenerateSql}
              disabled={checkedRowCount === 0}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              生成 INSERT SQL
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

          {writeError && <ErrorMessage error={writeError} />}

          {writeResults && writeResults.length > 0 && (
            // The summary/下载日志 bar is a sibling *above* the scrolling body, not inside it — see
            // DataCopy.tsx's matching comment (Bugs/8.24.md #5): it used to share the same
            // horizontally-scrolling wrapper as the (often very wide) table rows, dragging the
            // button off to whatever the widest row's far edge was.
            <div className="flex max-h-[40vh] flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
                <span>
                  {writeStopped && <span className="mr-1 font-medium text-amber-600 dark:text-amber-400">⚠ 已手动停止 —</span>}
                  共 {writeResults.length} 条，成功 {writeResults.filter((r) => r.state === "success").length}，失败{" "}
                  {writeResults.filter((r) => r.state === "error").length}
                  {writeSkippedCount > 0 && <span className="ml-1">，另跳过 {writeSkippedCount} 条（未变更）</span>}
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
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="inline-block min-w-full align-top">
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
