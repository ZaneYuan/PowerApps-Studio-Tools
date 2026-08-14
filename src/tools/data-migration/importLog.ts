import type { Sql4CdsBatchStatementLog, WriteAction } from "../sql4cds/executionLog";

const ACTION_LABELS: Record<WriteAction, string> = { insert: "INSERT", update: "UPDATE", delete: "DELETE" };

export interface DataMigrationLogParams {
  startedAt: Date;
  finishedAt: Date;
  targetConnectionName: string;
  /** The whole pasted SQL, printed once in the header. */
  sql: string;
  statements: Sql4CdsBatchStatementLog[];
  /** True if the user clicked "停止" partway through — later statements (or later rows within
   *  the statement that was running) never executed. */
  stopped?: boolean;
}

/** Plain-text execution log for one "从 SQL 导入" run — same per-statement/per-entry format as
 *  SQL4CDS's batch log (src/tools/sql4cds/executionLog.ts's buildSql4CdsBatchLogText), since this
 *  tool reuses that same write engine, but with this tool's own header wording/filename prefix
 *  so a downloaded log doesn't say "SQL4CDS" when the user ran it from the Data Migration tool. */
export function buildDataMigrationLogText(params: DataMigrationLogParams): string {
  const allEntries = params.statements.flatMap((s) => s.entries);
  const success = allEntries.filter((e) => e.state === "success").length;
  const error = allEntries.length - success;

  const lines = [
    "Power Apps Studio & Tools — 数据迁移（SQL 导入）执行日志",
    `开始时间: ${params.startedAt.toISOString()}`,
    `结束时间: ${params.finishedAt.toISOString()}`,
    `目标连接: ${params.targetConnectionName}`,
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

export function dataMigrationLogFilename(finishedAt: Date): string {
  const ts = finishedAt.toISOString().replace(/[:.]/g, "-");
  return `data-migration-sql-import-${ts}.txt`;
}
