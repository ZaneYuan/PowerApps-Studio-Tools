import type { MigrationLogEntry } from "./types";

export interface RecordMergeLogParams {
  startedAt: Date;
  finishedAt: Date;
  connectionName: string;
  entityLogicalName: string;
  oldId: string;
  newId: string;
  entries: MigrationLogEntry[];
  /** True if the user clicked "停止" partway through — entries only cover what actually ran
   *  before the stop took effect, not every table the scan found. */
  stopped?: boolean;
}

/** Plain-text execution log for one 引用迁移 run — same format/download convention as
 *  data-migration's buildDataMigrationLogText and sql4cds's buildSql4CdsLogText. */
export function buildRecordMergeLogText(params: RecordMergeLogParams): string {
  const success = params.entries.filter((e) => e.state === "success").length;
  const error = params.entries.length - success;

  const lines = [
    "Power Apps Studio & Tools — 记录引用迁移执行日志",
    `开始时间: ${params.startedAt.toISOString()}`,
    `结束时间: ${params.finishedAt.toISOString()}`,
    `连接: ${params.connectionName}`,
    `实体: ${params.entityLogicalName}`,
    `旧记录: ${params.oldId}`,
    `新记录: ${params.newId}`,
    ...(params.stopped ? ["⚠ 用户手动停止执行 — 以下仅为已处理的部分，后续表/记录未迁移"] : []),
    `总行数: ${params.entries.length}  成功: ${success}  失败: ${error}`,
    "",
    "明细：",
    ...params.entries.map((e) =>
      e.state === "success" ? `[成功] ${e.table} — ${e.action} — ${e.key}` : `[失败] ${e.table} — ${e.action} — ${e.key} — ${e.error ?? ""}`,
    ),
  ];
  return lines.join("\n");
}

export function recordMergeLogFilename(entityLogicalName: string, finishedAt: Date): string {
  const ts = finishedAt.toISOString().replace(/[:.]/g, "-");
  return `record-merge-${entityLogicalName}-${ts}.txt`;
}
