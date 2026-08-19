import { useEffect, useRef, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { fetchEntityMeta } from "../../native/metadataService";
import { downloadTextFile } from "../../native/download";
import { extractGuid, parseRecordUrl } from "../record-explorer/types";
import { lookupRecord, migrateReferences, scanReferences } from "./dataverseOps";
import { buildRecordMergeLogText, recordMergeLogFilename } from "./mergeLog";
import { totalReferenceCount, type MigrationLogEntry, type ReferenceScanResult } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 20;

function ConcurrencyInput({ value, onChange, disabled }: { value: number; onChange: (next: number) => void; disabled: boolean }) {
  return (
    <label className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
      并发数
      <input
        type="number"
        min={1}
        max={MAX_CONCURRENCY}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(MAX_CONCURRENCY, Math.max(1, Number(e.target.value) || 1)))}
        className="w-14 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
    </label>
  );
}

function MigrationResultTable({ results, stopped, log }: { results: MigrationLogEntry[]; stopped?: boolean; log: { filename: string; text: string } | null }) {
  const success = results.filter((r) => r.state === "success").length;
  const error = results.length - success;
  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="inline-block min-w-full align-top">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
          <span>
            {stopped && <span className="mr-1 font-medium text-amber-600 dark:text-amber-400">⚠ 已手动停止 —</span>}
            共 {results.length} 条，成功 {success}，失败 {error}
          </span>
          {log && (
            <button
              onClick={() => downloadTextFile(log.filename, log.text)}
              className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              下载日志
            </button>
          )}
        </div>
        <table className="w-full text-left text-sm">
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">{r.table}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{r.key}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-400">{r.action}</td>
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
}

export default function RecordMerge() {
  const { activeConnectionId, connections } = useActiveConnection();
  const [entityName, setEntityName] = useState("");
  const [locator, setLocator] = useState("");
  const [scanResult, setScanResult] = useState<ReferenceScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [newIdInput, setNewIdInput] = useState("");
  const [newIdCheck, setNewIdCheck] = useState<{ loading: boolean; exists: boolean | null; primaryName: string | null }>({
    loading: false,
    exists: null,
    primaryName: null,
  });

  const [writeRunning, setWriteRunning] = useState(false);
  const [writeResults, setWriteResults] = useState<MigrationLogEntry[] | null>(null);
  const [writeLog, setWriteLog] = useState<{ filename: string; text: string } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeStopped, setWriteStopped] = useState(false);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const stopRequestedRef = useRef(false);

  function connectionName(): string {
    return connections.find((c) => c.id === activeConnectionId)?.name ?? activeConnectionId ?? "";
  }

  function handleLocatorChange(value: string) {
    setLocator(value);
    const parsed = parseRecordUrl(value);
    if (parsed) setEntityName(parsed.entityLogicalName);
  }

  const id = extractGuid(locator);
  const canScan = !!activeConnectionId && !!entityName.trim() && !!id && !scanning;

  async function handleScan() {
    if (!activeConnectionId || !entityName.trim() || !id) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    setNewIdInput("");
    setWriteResults(null);
    setWriteLog(null);
    setWriteError(null);
    try {
      const trimmed = entityName.trim();
      const lookup = await lookupRecord(activeConnectionId, trimmed, id);
      if (!lookup.exists) throw new Error(`找不到记录 ${trimmed} (${id})，请检查实体名和 GUID 是否正确。`);
      const { tables, failedRelationships } = await scanReferences(activeConnectionId, trimmed, id);
      setScanResult({ entityLogicalName: trimmed, id, primaryName: lookup.primaryName, tables, failedRelationships });
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  const newId = extractGuid(newIdInput);
  useEffect(() => {
    setNewIdCheck({ loading: false, exists: null, primaryName: null });
    if (!activeConnectionId || !scanResult || !newId) return;
    let cancelled = false;
    setNewIdCheck({ loading: true, exists: null, primaryName: null });
    lookupRecord(activeConnectionId, scanResult.entityLogicalName, newId)
      .then((res) => {
        if (!cancelled) setNewIdCheck({ loading: false, exists: res.exists, primaryName: res.primaryName });
      })
      .catch(() => {
        if (!cancelled) setNewIdCheck({ loading: false, exists: false, primaryName: null });
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, scanResult, newId]);

  const isSameRecord = !!newId && !!scanResult && newId.toLowerCase() === scanResult.id.toLowerCase();
  const total = scanResult ? totalReferenceCount(scanResult.tables) : 0;
  const canMigrate =
    !!activeConnectionId && !!scanResult && total > 0 && !!newId && !isSameRecord && newIdCheck.exists === true && !writeRunning;

  function handleStop() {
    stopRequestedRef.current = true;
  }

  async function handleMigrate() {
    if (!activeConnectionId || !scanResult || !newId) return;
    const envUrl = connections.find((c) => c.id === activeConnectionId)?.environmentUrl;
    if (!envUrl) {
      setWriteError("找不到当前连接的环境 URL。");
      return;
    }
    if (
      !confirm(
        `即将把 ${scanResult.tables.length} 张表、共 ${total} 条引用记录，从 ${scanResult.primaryName ?? scanResult.id}（${scanResult.id}）迁移到 ${newIdCheck.primaryName ?? newId}（${newId}），确定吗？`,
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
    const entries: MigrationLogEntry[] = [];

    try {
      const meta = await fetchEntityMeta(activeConnectionId, scanResult.entityLogicalName);
      await migrateReferences(
        activeConnectionId,
        envUrl,
        scanResult.entityLogicalName,
        meta.entitySetName,
        scanResult.id,
        newId,
        scanResult.tables,
        concurrency,
        (entry) => {
          entries.push(entry);
          setWriteResults((r) => [...(r ?? []), entry]);
        },
        () => stopRequestedRef.current,
      );
      const stopped = stopRequestedRef.current;
      if (stopped) setWriteStopped(true);
      const finishedAt = new Date();
      const text = buildRecordMergeLogText({
        startedAt,
        finishedAt,
        connectionName: connectionName(),
        entityLogicalName: scanResult.entityLogicalName,
        oldId: scanResult.id,
        newId,
        entries,
        stopped,
      });
      setWriteLog({ filename: recordMergeLogFilename(scanResult.entityLogicalName, finishedAt), text });
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
    <div className="max-w-5xl space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        输入实体 + GUID（或粘贴记录的 D365 表单 URL）定位一条记录，查询有多少条记录（1:N 查找字段 + N:N 关联，含系统表）引用了它；再输入另一条同表记录的
        GUID，把所有这些引用批量迁移过去。旧记录本身不会被停用或删除，需要自行处理。Web API 没有批量更新接口，实际是逐条 PATCH/关联，引用数很多时会需要一些时间。
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">实体 (entity name)</label>
          <input type="text" value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="account" className={`${inputCls} w-40`} />
        </div>
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">GUID 或记录 URL</label>
          <input
            type="text"
            value={locator}
            onChange={(e) => handleLocatorChange(e.target.value)}
            placeholder="11111111-1111-1111-1111-111111111111"
            className={`${inputCls} w-full font-mono`}
          />
        </div>
        <button onClick={handleScan} disabled={!canScan} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {scanning ? "查询中…" : "查询引用"}
        </button>
        {!activeConnectionId && <span className="text-xs text-gray-400">请先在侧边栏选择一个我的连接。</span>}
      </div>

      {scanError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{scanError}</div>
      )}

      {scanResult && (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            当前记录：<span className="font-medium">{scanResult.primaryName ?? scanResult.id}</span>{" "}
            <span className="font-mono text-xs text-gray-400">({scanResult.id})</span>
          </p>

          {scanResult.failedRelationships.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              ⚠ {scanResult.failedRelationships.length} 个关系的引用计数查询失败，被跳过——下面的结果可能不完整，不代表这些表一定没有引用：
              {scanResult.failedRelationships.join("、")}
            </div>
          )}

          {scanResult.tables.length === 0 ? (
            <p className="text-sm text-gray-400">没有找到任何引用这条记录的记录。</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">表</th>
                    <th className="px-3 py-2 font-medium">关系类型</th>
                    <th className="px-3 py-2 font-medium">字段 / 关联</th>
                    <th className="px-3 py-2 font-medium">引用记录数</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.tables.map((t, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-1.5">{t.kind === "onetomany" ? t.entityLogicalName : t.otherEntityLogicalName}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-400">{t.kind === "onetomany" ? "1:N" : "N:N"}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {t.kind === "onetomany" ? t.referencingAttribute : t.intersectEntityName}
                      </td>
                      <td className="px-3 py-1.5">{t.count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 text-xs font-medium text-gray-600 dark:border-gray-800 dark:text-gray-300">
                    <td className="px-3 py-2" colSpan={3}>
                      共 {scanResult.tables.length} 张表
                    </td>
                    <td className="px-3 py-2">{total} 条</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {scanResult.tables.length > 0 && (
            <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">迁移到（新记录的 GUID，需与当前记录同表）</label>
                  <input
                    type="text"
                    value={newIdInput}
                    onChange={(e) => setNewIdInput(e.target.value)}
                    placeholder="22222222-2222-2222-2222-222222222222"
                    className={`${inputCls} w-full font-mono`}
                    disabled={writeRunning}
                  />
                  {newIdInput.trim() && !newId && <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">⚠ 无法识别为一个 GUID</div>}
                  {newId && isSameRecord && <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">⚠ 和当前记录是同一条，不能迁移到自身</div>}
                  {newId && !isSameRecord && newIdCheck.loading && <div className="mt-0.5 text-xs text-gray-400">校验中…</div>}
                  {newId && !isSameRecord && !newIdCheck.loading && newIdCheck.exists === true && (
                    <div className="mt-0.5 text-xs text-green-600 dark:text-green-400">✓ 记录存在：{newIdCheck.primaryName ?? newId}</div>
                  )}
                  {newId && !isSameRecord && !newIdCheck.loading && newIdCheck.exists === false && (
                    <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">✗ 在 {scanResult.entityLogicalName} 表中找不到这条记录</div>
                  )}
                </div>
                <button
                  onClick={handleMigrate}
                  disabled={!canMigrate}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {writeRunning ? "迁移中…" : "迁移引用"}
                </button>
                {writeRunning && (
                  <button
                    onClick={handleStop}
                    className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    停止
                  </button>
                )}
                <ConcurrencyInput value={concurrency} onChange={setConcurrency} disabled={writeRunning} />
              </div>

              {writeError && (
                <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
                  {writeError}
                </pre>
              )}

              {writeResults && writeResults.length > 0 && <MigrationResultTable results={writeResults} stopped={writeStopped} log={writeLog} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
