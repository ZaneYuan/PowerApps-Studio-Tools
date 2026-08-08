import { useEffect, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import {
  deleteTraceLog,
  fetchTraceLogDetail,
  fetchTraceLogs,
  fetchTraceSetting,
  updateTraceSetting,
  type OrgTraceSetting,
} from "./dataverseOps";
import { DEFAULT_FILTERS, MODE_LABELS, OPERATION_TYPE_LABELS, TRACE_SETTING_LABELS, type PluginTraceLog, type TraceFilters } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

const TOP_OPTIONS = [50, 100, 200, 500];

export default function PluginTraceViewer() {
  const { activeConnectionId } = useActiveConnection();

  const [filters, setFilters] = useState<TraceFilters>(DEFAULT_FILTERS);
  const [logs, setLogs] = useState<PluginTraceLog[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [orgSetting, setOrgSetting] = useState<OrgTraceSetting | null>(null);
  const [settingError, setSettingError] = useState<string | null>(null);
  const [settingSaving, setSettingSaving] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function loadLogs() {
    if (!activeConnectionId) return;
    setListLoading(true);
    setListError(null);
    try {
      setLogs(await fetchTraceLogs(activeConnectionId, filters));
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }

  async function loadSetting() {
    if (!activeConnectionId) return;
    setSettingError(null);
    try {
      setOrgSetting(await fetchTraceSetting(activeConnectionId));
    } catch (err) {
      setSettingError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    setLogs(null);
    setSelectedId(null);
    setDetail(null);
    void loadLogs();
    void loadSetting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  async function handleChangeSetting(value: number) {
    if (!activeConnectionId || !orgSetting) return;
    setSettingSaving(true);
    setSettingError(null);
    try {
      await updateTraceSetting(activeConnectionId, orgSetting.organizationid, value);
      setOrgSetting({ ...orgSetting, plugintracelogsetting: value });
    } catch (err) {
      setSettingError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingSaving(false);
    }
  }

  async function handleSelectRow(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    if (!activeConnectionId) return;
    setDetailLoading(true);
    try {
      setDetail(await fetchTraceLogDetail(activeConnectionId, id));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!activeConnectionId) return;
    if (!confirm("确定删除这条 Trace Log？")) return;
    try {
      await deleteTraceLog(activeConnectionId, id);
      setLogs((cur) => cur?.filter((l) => l.plugintracelogid !== id) ?? null);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  if (!activeConnectionId) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        请先在左侧侧边栏顶部选择一个"当前连接"（没有连接的话先去"我的连接"里添加）。
      </div>
    );
  }

  const selectedLog = logs?.find((l) => l.plugintracelogid === selectedId) ?? null;
  const detailFields =
    detail && typeof detail === "object"
      ? (detail as { exceptiondetails?: string | null; messageblock?: string | null })
      : null;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 text-xs dark:border-gray-800">
        <span className="text-gray-500 dark:text-gray-400">Plugin Trace Log 设置：</span>
        {settingError && <span className="text-red-600 dark:text-red-400">{settingError}</span>}
        {!orgSetting && !settingError && <span className="text-gray-400">加载中…</span>}
        {orgSetting && (
          <select
            value={orgSetting.plugintracelogsetting}
            onChange={(e) => handleChangeSetting(Number(e.target.value))}
            disabled={settingSaving}
            className={inputCls}
          >
            {Object.entries(TRACE_SETTING_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        )}
        {settingSaving && <span className="text-gray-400">保存中…</span>}
        <span className="text-gray-400">（关闭时不会产生新的 trace，历史记录仍然可查）</span>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-800">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Type Name 包含</label>
          <input
            type="text"
            value={filters.typeName}
            onChange={(e) => setFilters((f) => ({ ...f, typeName: e.target.value }))}
            className={`${inputCls} w-40`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Message 包含</label>
          <input
            type="text"
            value={filters.messageName}
            onChange={(e) => setFilters((f) => ({ ...f, messageName: e.target.value }))}
            placeholder="Create / Update…"
            className={`${inputCls} w-32`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">主实体 包含</label>
          <input
            type="text"
            value={filters.primaryEntity}
            onChange={(e) => setFilters((f) => ({ ...f, primaryEntity: e.target.value }))}
            placeholder="account"
            className={`${inputCls} w-28`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">从</label>
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">到</label>
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">最多显示</label>
          <select
            value={filters.top}
            onChange={(e) => setFilters((f) => ({ ...f, top: Number(e.target.value) }))}
            className={inputCls}
          >
            {TOP_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} 条
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={filters.onlyErrors}
            onChange={(e) => setFilters((f) => ({ ...f, onlyErrors: e.target.checked }))}
          />
          只看异常
        </label>
        <button
          onClick={loadLogs}
          disabled={listLoading}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {listLoading ? "查询中…" : "查询"}
        </button>
        <button
          onClick={() => setFilters(DEFAULT_FILTERS)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          重置
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
          {listError && <p className="p-3 text-xs text-red-600 dark:text-red-400">{listError}</p>}
          {!logs && !listError && <p className="p-3 text-xs text-gray-400">加载中…</p>}
          {logs && logs.length === 0 && <p className="p-3 text-xs text-gray-400">没有匹配的 trace log。</p>}
          {logs && logs.length > 0 && (
            <>
              {logs.length === filters.top && (
                <p className="border-b border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
                  已达到显示上限（{filters.top} 条），可能还有更多历史记录 —— 缩小时间范围或增大"最多显示"数量。
                </p>
              )}
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2">创建时间</th>
                    <th className="px-3 py-2">Type Name</th>
                    <th className="px-3 py-2">Message</th>
                    <th className="px-3 py-2">实体</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">耗时(ms)</th>
                    <th className="px-3 py-2">异常</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.plugintracelogid}
                      onClick={() => handleSelectRow(log.plugintracelogid)}
                      className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900 ${
                        selectedId === log.plugintracelogid ? "bg-blue-50 dark:bg-blue-500/10" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                        {new Date(log.createdon).toLocaleString()}
                      </td>
                      <td className="max-w-xs truncate px-3 py-1.5 text-xs" title={log.typename ?? ""}>
                        {log.typename}
                      </td>
                      <td className="px-3 py-1.5 text-xs">{log.messagename}</td>
                      <td className="px-3 py-1.5 text-xs">{log.primaryentity}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">
                        {log.mode !== null ? (MODE_LABELS[log.mode] ?? log.mode) : ""}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">{log.performanceexecutionduration ?? ""}</td>
                      <td className="px-3 py-1.5 text-xs">
                        {log.exceptiondetails && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            异常
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(log.plugintracelogid);
                          }}
                          className="text-gray-400 hover:text-red-500"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="w-96 shrink-0 overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          {!selectedLog && <p className="text-sm text-gray-400">从左侧选一行查看详情。</p>}
          {selectedLog && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-1 text-xs text-gray-600 dark:text-gray-300">
                <div>Type: {selectedLog.typename}</div>
                <div>Message: {selectedLog.messagename}</div>
                <div>Entity: {selectedLog.primaryentity}</div>
                <div>Depth: {selectedLog.depth}</div>
                <div>
                  Operation: {selectedLog.operationtype !== null ? OPERATION_TYPE_LABELS[selectedLog.operationtype] : ""}
                </div>
                <div>Duration: {selectedLog.performanceexecutionduration} ms</div>
                <div className="col-span-2 truncate" title={selectedLog.correlationid ?? ""}>
                  Correlation: {selectedLog.correlationid}
                </div>
              </div>

              {detailLoading && <p className="text-xs text-gray-400">加载详情…</p>}
              {detailError && <p className="text-xs text-red-600 dark:text-red-400">{detailError}</p>}

              {/* messageblock isn't in the list $select (kept the list query light) — both
                  fields below come from the full-record detail fetch, not the row summary. */}
              {detailFields?.exceptiondetails && (
                <div>
                  <div className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">Exception Details</div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
                    {detailFields.exceptiondetails}
                  </pre>
                </div>
              )}

              {detailFields?.messageblock && (
                <div>
                  <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Message Block</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                    {detailFields.messageblock}
                  </pre>
                </div>
              )}

              {detail !== null && !detailLoading && (
                <details>
                  <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">
                    完整 JSON
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-auto text-xs text-gray-700 dark:text-gray-300">
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
