/** "create" (phase 1, every checked non-intersect row gets exactly one) and "associate" (phase 3,
 *  every checked intersect-table row gets exactly one) both represent a source row's own primary
 *  write — "backfill" (phase 2) is a supplementary follow-up only for rows with deferred columns,
 *  so a row with deferred fields legitimately produces *two* entries. Without this distinction the
 *  UI/log summary counted entries as if they were rows 1:1 and reported a confusingly inflated
 *  total (e.g. "成功 106" for a 52-row batch) — see bugs & requirements/8.19.md #1. */
export type DataMigrationLogPhase = "create" | "backfill" | "associate";

export interface DataMigrationLogEntry {
  /** This row's own primary-key value — or, for a phase-2 backfill entry, the primary-key value
   *  plus a "(回填 col1, col2)" suffix identifying which deferred fields that entry covers, so a
   *  row with deferred columns shows up as two distinct lines (phase-1 create, phase-2 backfill)
   *  instead of one entry silently standing in for both. */
  key: string;
  state: "success" | "error";
  error?: string;
  phase: DataMigrationLogPhase;
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

/** create/associate entries are each one distinct source row's primary write ("导入"); backfill
 *  entries are a supplementary follow-up on an already-counted row, so they get their own "依赖回填"
 *  tally instead of being added into the row count — folding all three into one flat "成功 N" (as
 *  this used to) double-counted every row that had deferred fields (see 8.19.md #1: a 52-row
 *  batch reported "成功 106" because every row with deferred columns produced two entries). */
function summarize(entries: DataMigrationLogEntry[]): string {
  const imported = entries.filter((e) => e.phase !== "backfill");
  const backfilled = entries.filter((e) => e.phase === "backfill");
  const importSuccess = imported.filter((e) => e.state === "success").length;
  const importError = imported.length - importSuccess;
  let text = `导入成功: ${importSuccess}  导入失败: ${importError}`;
  if (backfilled.length > 0) {
    const backfillSuccess = backfilled.filter((e) => e.state === "success").length;
    text += `  依赖回填成功: ${backfillSuccess}  依赖回填失败: ${backfilled.length - backfillSuccess}`;
  }
  return text;
}

/** Plain-text execution log for one "数据迁移" run — one section per table, one line per row,
 *  same download-a-txt-after-every-run convention every write tool in this app already follows. */
export function buildDataMigrationLogText(params: DataMigrationLogParams): string {
  const allEntries = params.tables.flatMap((t) => t.entries);

  const lines = [
    "Power Apps Studio & Tools — 数据迁移执行日志",
    `开始时间: ${params.startedAt.toISOString()}`,
    `结束时间: ${params.finishedAt.toISOString()}`,
    `目标连接: ${params.targetConnectionName}`,
    `表数: ${params.tables.length}`,
    ...(params.stopped ? ["⚠ 用户手动停止执行 — 以下仅为已处理的部分，后续表/行未执行"] : []),
    summarize(allEntries),
    "",
  ];

  for (const t of params.tables) {
    lines.push(
      `── ${t.entityLogicalName} (${t.entitySetName}) — 来源: ${SOURCE_LABELS[t.source]} ──`,
      summarize(t.entries),
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
