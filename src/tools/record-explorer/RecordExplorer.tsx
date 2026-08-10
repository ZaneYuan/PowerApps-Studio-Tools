import { useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { useEntitySetName } from "../../native/useEntitySetName";
import ChildTablePanel from "./ChildTablePanel";
import RecordCard from "./RecordCard";
import { fetchRecordGraph } from "./dataverseOps";
import { recordMatches } from "./search";
import { extractGuid, parseRecordUrl, type RecordGraph } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

type ViewTab = "current" | "up" | "down";

export default function RecordExplorer() {
  const { activeConnectionId } = useActiveConnection();
  const [entityName, setEntityName] = useState("");
  const [locator, setLocator] = useState("");
  const [graph, setGraph] = useState<RecordGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<ViewTab>("current");

  const entityMeta = useEntitySetName(activeConnectionId, entityName);

  function handleLocatorChange(value: string) {
    setLocator(value);
    const parsed = parseRecordUrl(value);
    if (parsed) setEntityName(parsed.entityLogicalName);
  }

  const id = extractGuid(locator);
  const canLoad = !!activeConnectionId && !!entityName.trim() && !!id;

  async function handleLoad() {
    if (!activeConnectionId || !entityName.trim() || !id) return;
    setLoading(true);
    setError(null);
    setGraph(null);
    try {
      const result = await fetchRecordGraph(activeConnectionId, entityName.trim(), id);
      setGraph(result);
      setTab("current");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  const level1Visible = graph
    ? graph.level1
        .map((g) => ({ ...g, records: searchText.trim() ? g.records.filter((r) => recordMatches(r, searchText)) : g.records }))
        .filter((g) => g.records.length > 0)
    : [];
  const level2Visible = graph
    ? graph.level2
        .map((g) => ({ ...g, items: searchText.trim() ? g.items.filter((i) => recordMatches(i.record, searchText)) : g.items }))
        .filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="max-w-6xl space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        输入实体 + GUID（或直接粘贴记录的 D365 表单 URL）加载一条记录，向上展示两级查找字段指向的完整记录，向下展示一级子表记录。系统自带的管理型字段/平台通用子表已过滤，自定义字段/关系始终保留。
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">实体 (entity name)</label>
          <input
            type="text"
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            placeholder="quote"
            className={`${inputCls} w-40`}
          />
          {entityMeta.loading && <div className="mt-0.5 text-xs text-gray-400">校验中…</div>}
          {entityMeta.resolved && !entityMeta.loading && <div className="mt-0.5 text-xs text-green-600 dark:text-green-400">✓ 实体存在</div>}
          {entityMeta.error && !entityMeta.loading && entityName.trim() && (
            <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">⚠ 找不到该实体</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">GUID 或记录 URL（粘贴 URL 会自动识别实体名）</label>
          <input
            type="text"
            value={locator}
            onChange={(e) => handleLocatorChange(e.target.value)}
            placeholder="11111111-1111-1111-1111-111111111111"
            className={`${inputCls} w-full font-mono`}
          />
        </div>
        <button
          onClick={handleLoad}
          disabled={!canLoad || loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "加载中…" : "加载"}
        </button>
        {!activeConnectionId && <span className="text-xs text-gray-400">请先在侧边栏选择一个当前连接。</span>}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {graph && (
        <>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="模糊搜索：过滤并高亮所有已加载记录的字段值…"
            className={`${inputCls} w-full max-w-md`}
          />

          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
            {([
              ["current", "当前记录"],
              ["up", `关联记录（向上）${searchText.trim() ? ` — ${level1Visible.length + level2Visible.length} 组命中` : ""}`],
              ["down", "子记录（向下）"],
            ] as [ViewTab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-sm ${
                  tab === key
                    ? "border-b-2 border-blue-600 font-medium text-blue-700 dark:text-blue-400"
                    : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "current" && <RecordCard snapshot={graph.current} searchText={searchText} defaultExpanded />}

          {tab === "up" && (
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">一级</h3>
                {level1Visible.length === 0 ? (
                  <p className="text-sm text-gray-400">{searchText.trim() ? "没有命中的一级关联记录。" : "没有可跟随的查找字段。"}</p>
                ) : (
                  <div className="space-y-3">
                    {level1Visible.map((group) => (
                      <div key={group.entityLogicalName}>
                        <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                          {group.entityLogicalName} ({group.records.length})
                        </div>
                        <div className="space-y-2">
                          {group.records.map((r) => (
                            <RecordCard key={r.id} snapshot={r} searchText={searchText} defaultExpanded />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">二级</h3>
                {level2Visible.length === 0 ? (
                  <p className="text-sm text-gray-400">{searchText.trim() ? "没有命中的二级关联记录。" : "没有二级关联记录。"}</p>
                ) : (
                  <div className="space-y-3">
                    {level2Visible.map((group) => (
                      <div key={group.entityLogicalName}>
                        <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                          {group.entityLogicalName} ({group.items.length})
                        </div>
                        <div className="space-y-2">
                          {group.items.map(({ record, via }) => (
                            <RecordCard
                              key={record.id}
                              snapshot={record}
                              searchText={searchText}
                              defaultExpanded={false}
                              subtitle={`${via.entityLogicalName} · ${via.primaryName}`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "down" && <ChildTablePanel groups={graph.children} searchText={searchText} />}
        </>
      )}
    </div>
  );
}
