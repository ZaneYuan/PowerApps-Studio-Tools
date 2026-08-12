export interface ImportLogEntry {
  id: string;
  state: "success" | "error";
  error?: string;
}

export interface ImportLogParams {
  startedAt: Date;
  finishedAt: Date;
  sourceConnectionName: string;
  targetConnectionName: string;
  entityLogicalName: string;
  entitySetName: string;
  columns: string[];
  entries: ImportLogEntry[];
}

/** Plain-text execution log for one import run — every run produces one, downloadable via
 *  native/download.ts. Kept as a pure function (no I/O) so it's easy to unit-test the format
 *  later if this project ever adds a test runner. */
export function buildImportLogText(params: ImportLogParams): string {
  const success = params.entries.filter((e) => e.state === "success").length;
  const error = params.entries.filter((e) => e.state === "error").length;

  const lines = [
    "Power Apps Studio & Tools — 数据迁移执行日志",
    `开始时间: ${params.startedAt.toISOString()}`,
    `结束时间: ${params.finishedAt.toISOString()}`,
    `实体: ${params.entityLogicalName} (${params.entitySetName})`,
    `源连接: ${params.sourceConnectionName}`,
    `目标连接: ${params.targetConnectionName}`,
    `迁移列: ${params.columns.join(", ")}`,
    `总行数: ${params.entries.length}  成功: ${success}  失败: ${error}`,
    "",
    "明细：",
    ...params.entries.map((e) => (e.state === "success" ? `[成功] ${e.id}` : `[失败] ${e.id} — ${e.error ?? ""}`)),
  ];
  return lines.join("\n");
}

export function importLogFilename(entityLogicalName: string, finishedAt: Date): string {
  const ts = finishedAt.toISOString().replace(/[:.]/g, "-");
  return `data-migration-${entityLogicalName}-${ts}.txt`;
}
