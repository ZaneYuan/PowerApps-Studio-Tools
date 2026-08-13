export type WriteAction = "insert" | "update" | "delete";

export interface Sql4CdsLogEntry {
  /** "第 N 行" for insert (no id exists yet until the row succeeds), the record GUID for update/delete. */
  key: string;
  state: "success" | "error";
  error?: string;
  /** e.g. the new record's id for a successful insert. */
  detail?: string;
}

export interface Sql4CdsLogParams {
  startedAt: Date;
  finishedAt: Date;
  connectionName: string;
  action: WriteAction;
  entityLogicalName: string;
  entitySetName: string;
  sql: string;
  entries: Sql4CdsLogEntry[];
  /** True if the user clicked "停止" partway through — entries only cover what actually ran
   *  before the stop took effect, not the full planned row count. */
  stopped?: boolean;
}

const ACTION_LABELS: Record<WriteAction, string> = { insert: "INSERT", update: "UPDATE", delete: "DELETE" };

/** Plain-text execution log for one SQL4CDS write run — modeled directly on data-migration's
 *  buildImportLogText (src/tools/data-migration/importLog.ts), same success/error line format,
 *  downloaded the same way via native/download.ts. Kept as a pure function (no I/O). */
export function buildSql4CdsLogText(params: Sql4CdsLogParams): string {
  const success = params.entries.filter((e) => e.state === "success").length;
  const error = params.entries.filter((e) => e.state === "error").length;

  const lines = [
    "Power Apps Studio & Tools — SQL4CDS 执行日志",
    `开始时间: ${params.startedAt.toISOString()}`,
    `结束时间: ${params.finishedAt.toISOString()}`,
    `操作: ${ACTION_LABELS[params.action]}`,
    `实体: ${params.entityLogicalName} (${params.entitySetName})`,
    `连接: ${params.connectionName}`,
    `SQL: ${params.sql}`,
    ...(params.stopped ? ["⚠ 用户手动停止执行 — 以下仅为已处理的部分，后续行未执行"] : []),
    `总行数: ${params.entries.length}  成功: ${success}  失败: ${error}`,
    "",
    "明细：",
    ...params.entries.map((e) =>
      e.state === "success" ? `[成功] ${e.key}${e.detail ? ` — ${e.detail}` : ""}` : `[失败] ${e.key} — ${e.error ?? ""}`,
    ),
  ];
  return lines.join("\n");
}

export function sql4CdsLogFilename(action: WriteAction, entityLogicalName: string, finishedAt: Date): string {
  const ts = finishedAt.toISOString().replace(/[:.]/g, "-");
  return `sql4cds-${action}-${entityLogicalName}-${ts}.txt`;
}

export interface Sql4CdsBatchStatementLog {
  /** 1-based position in the batch, for the header line only — entries within stay keyed the
   *  way single-statement runs already key them ("第 N 行" / record id). */
  index: number;
  action: WriteAction;
  entityLogicalName: string;
  entitySetName: string;
  /** One-line description of what this statement targeted (INSERT's row count, or UPDATE/
   *  DELETE's WHERE filter) — the batch's full original SQL text is already in the log header
   *  (see Sql4CdsBatchLogParams.sql), so this doesn't try to reconstruct each statement's own
   *  slice of it (node-sql-parser's sqlify() wouldn't exactly match what the user typed anyway,
   *  just something semantically equivalent). */
  summary: string;
  entries: Sql4CdsLogEntry[];
}

export interface Sql4CdsBatchLogParams {
  startedAt: Date;
  finishedAt: Date;
  connectionName: string;
  /** The whole batch's original SQL text (all statements), printed once in the header. */
  sql: string;
  statements: Sql4CdsBatchStatementLog[];
  /** True if the user clicked "停止" partway through — later statements (or later rows within
   *  the statement that was running) never executed. */
  stopped?: boolean;
}

/** One merged log for a whole batch run instead of one file per statement — same line format as
 *  buildSql4CdsLogText per statement, with an overall header + per-statement sections. */
export function buildSql4CdsBatchLogText(params: Sql4CdsBatchLogParams): string {
  const allEntries = params.statements.flatMap((s) => s.entries);
  const success = allEntries.filter((e) => e.state === "success").length;
  const error = allEntries.length - success;

  const lines = [
    "Power Apps Studio & Tools — SQL4CDS 批量执行日志",
    `开始时间: ${params.startedAt.toISOString()}`,
    `结束时间: ${params.finishedAt.toISOString()}`,
    `连接: ${params.connectionName}`,
    `语句数: ${params.statements.length}`,
    `SQL:\n${params.sql}`,
    ...(params.stopped ? ["⚠ 用户手动停止执行 — 以下仅为已处理的部分，后续语句/行未执行"] : []),
    `总行数: ${allEntries.length}  成功: ${success}  失败: ${error}`,
    "",
  ];

  for (const s of params.statements) {
    const sSuccess = s.entries.filter((e) => e.state === "success").length;
    const sError = s.entries.length - sSuccess;
    lines.push(
      `── 第 ${s.index} 条语句 ──`,
      `操作: ${ACTION_LABELS[s.action]} ${s.entityLogicalName} (${s.entitySetName})`,
      s.summary,
      `本条行数: ${s.entries.length}  成功: ${sSuccess}  失败: ${sError}`,
      "明细：",
      ...s.entries.map((e) =>
        e.state === "success" ? `[成功] ${e.key}${e.detail ? ` — ${e.detail}` : ""}` : `[失败] ${e.key} — ${e.error ?? ""}`,
      ),
      "",
    );
  }

  return lines.join("\n");
}

export function sql4CdsBatchLogFilename(finishedAt: Date): string {
  const ts = finishedAt.toISOString().replace(/[:.]/g, "-");
  return `sql4cds-batch-${ts}.txt`;
}
