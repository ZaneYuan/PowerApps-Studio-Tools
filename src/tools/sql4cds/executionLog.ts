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
}

const ACTION_LABELS: Record<WriteAction, string> = { insert: "INSERT", update: "UPDATE", delete: "DELETE" };

/** Plain-text execution log for one SQL4CDS write run — modeled directly on data-migration's
 *  buildImportLogText (src/tools/data-migration/importLog.ts), same success/error line format,
 *  downloaded the same way via native/download.ts. Kept as a pure function (no I/O). */
export function buildSql4CdsLogText(params: Sql4CdsLogParams): string {
  const success = params.entries.filter((e) => e.state === "success").length;
  const error = params.entries.filter((e) => e.state === "error").length;

  const lines = [
    "MSD365 PP Tools — SQL4CDS 执行日志",
    `开始时间: ${params.startedAt.toISOString()}`,
    `结束时间: ${params.finishedAt.toISOString()}`,
    `操作: ${ACTION_LABELS[params.action]}`,
    `实体: ${params.entityLogicalName} (${params.entitySetName})`,
    `连接: ${params.connectionName}`,
    `SQL: ${params.sql}`,
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
