export interface DataMigrationLogEntry {
  /** This row's own primary-key value — or, for a phase-2 backfill entry, the primary-key value
   *  plus a "(回填 col1, col2)" suffix identifying which deferred fields that entry covers, so a
   *  row with deferred columns shows up as two distinct lines (phase-1 create, phase-2 backfill)
   *  instead of one entry silently standing in for both. */
  key: string;
  state: "success" | "error";
  error?: string;
}

export interface DataMigrationTableLog {
  entityLogicalName: string;
  entitySetName: string;
  source: "query" | "sql-insert";
  entries: DataMigrationLogEntry[];
}

export interface DataMigrationLogParams {
  startedAt: Date;
  finishedAt: Date;
  targetConnectionName: string;
  tables: DataMigrationTableLog[];
  /** True if the user clicked "停止" partway through. */
  stopped?: boolean;
}

const SOURCE_LABELS: Record<DataMigrationTableLog["source"], string> = { query: "查询", "sql-insert": "SQL 导入" };

/** Plain-text execution log for one "数据迁移" run — one section per table, one line per row,
 *  same download-a-txt-after-every-run convention every write tool in this app already follows. */
export function buildDataMigrationLogText(params: DataMigrationLogParams): string {
  const allEntries = params.tables.flatMap((t) => t.entries);
  const success = allEntries.filter((e) => e.state === "success").length;
  const error = allEntries.length - success;

  const lines = [
    "Power Apps Studio & Tools — 数据迁移执行日志",
    `开始时间: ${params.startedAt.toISOString()}`,
    `结束时间: ${params.finishedAt.toISOString()}`,
    `目标连接: ${params.targetConnectionName}`,
    `表数: ${params.tables.length}`,
    ...(params.stopped ? ["⚠ 用户手动停止执行 — 以下仅为已处理的部分，后续表/行未执行"] : []),
    `总行数: ${allEntries.length}  成功: ${success}  失败: ${error}`,
    "",
  ];

  for (const t of params.tables) {
    const tSuccess = t.entries.filter((e) => e.state === "success").length;
    const tError = t.entries.length - tSuccess;
    lines.push(
      `── ${t.entityLogicalName} (${t.entitySetName}) — 来源: ${SOURCE_LABELS[t.source]} ──`,
      `本表行数: ${t.entries.length}  成功: ${tSuccess}  失败: ${tError}`,
      "明细：",
      ...t.entries.map((e) => (e.state === "success" ? `[成功] ${e.key}` : `[失败] ${e.key} — ${e.error ?? ""}`)),
      "",
    );
  }

  return lines.join("\n");
}

export function dataMigrationLogFilename(finishedAt: Date): string {
  const ts = finishedAt.toISOString().replace(/[:.]/g, "-");
  return `data-migration-${ts}.txt`;
}
