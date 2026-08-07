import { useMemo, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import FilterGroupEditor from "./FilterGroupEditor";
import LinkEntityEditor from "./LinkEntityEditor";
import { serializeFetchXml } from "./serialize";
import { newLinkEntity, newOrderClause, newQuery, type FetchXmlQuery, type LinkEntity } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

/** Same naive pluralization heuristic used by the other Dataverse tools — a starting guess
 *  only, Dataverse's real plural entity set names can be irregular. */
function naivePluralize(name: string): string {
  if (/[sxz]$|[cs]h$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

export default function FetchXmlBuilder() {
  const { activeConnectionId } = useActiveConnection();
  const [query, setQuery] = useState<FetchXmlQuery>(newQuery);
  const [entitySetOverride, setEntitySetOverride] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const { xml, error } = useMemo(() => serializeFetchXml(query), [query]);
  const entitySetGuess = query.entityName.trim() ? naivePluralize(query.entityName.trim()) : "";
  const entitySet = entitySetOverride || entitySetGuess;

  function updateOrder(id: string, patch: Partial<{ attribute: string; descending: boolean }>) {
    setQuery((q) => ({
      ...q,
      orders: q.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  }
  function removeOrder(id: string) {
    setQuery((q) => ({ ...q, orders: q.orders.filter((o) => o.id !== id) }));
  }
  function addOrder() {
    setQuery((q) => ({ ...q, orders: [...q.orders, newOrderClause()] }));
  }
  function updateLink(id: string, updated: LinkEntity) {
    setQuery((q) => ({ ...q, links: q.links.map((l) => (l.id === id ? updated : l)) }));
  }
  function removeLink(id: string) {
    setQuery((q) => ({ ...q, links: q.links.filter((l) => l.id !== id) }));
  }
  function addLink() {
    setQuery((q) => ({ ...q, links: [...q.links, newLinkEntity()] }));
  }

  async function handleRun() {
    if (!activeConnectionId || !xml || !entitySet) return;
    setRunning(true);
    setRunError(null);
    setRows(null);
    try {
      const path = `${entitySet}?fetchXml=${encodeURIComponent(xml)}`;
      const res = await callNative<{ value: Record<string, unknown>[] }>("dataverse.request", {
        connectionId: activeConnectionId,
        method: "GET",
        path,
      });
      setRows(res.value);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const columns = rows && rows.length > 0 ? Object.keys(rows[0]).filter((k) => !k.startsWith("@")) : [];

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        可视化拼 FetchXML（含嵌套过滤分组、嵌套 link-entity），生成后直接对当前连接真实执行。
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">实体 (entity name)</label>
          <input
            type="text"
            value={query.entityName}
            onChange={(e) => setQuery((q) => ({ ...q, entityName: e.target.value }))}
            placeholder="account"
            className={`${inputCls} w-40`}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
            返回字段，逗号分隔（勾选全部字段则忽略此项）
          </label>
          <input
            type="text"
            value={query.attributes}
            onChange={(e) => setQuery((q) => ({ ...q, attributes: e.target.value }))}
            disabled={query.allAttributes}
            placeholder="name, revenue"
            className={`${inputCls} w-full disabled:opacity-50`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Top</label>
          <input
            type="text"
            value={query.top}
            onChange={(e) => setQuery((q) => ({ ...q, top: e.target.value }))}
            placeholder="50"
            className={`${inputCls} w-20`}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={query.allAttributes}
            onChange={(e) => setQuery((q) => ({ ...q, allAttributes: e.target.checked }))}
          />
          全部字段
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={query.distinct}
            onChange={(e) => setQuery((q) => ({ ...q, distinct: e.target.checked }))}
          />
          distinct
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">过滤条件</span>
        </div>
        <FilterGroupEditor group={query.filter} onChange={(f) => setQuery((q) => ({ ...q, filter: f }))} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">排序</span>
          <button onClick={addOrder} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            + 添加排序字段
          </button>
        </div>
        <div className="space-y-2">
          {query.orders.map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <input
                type="text"
                value={o.attribute}
                onChange={(e) => updateOrder(o.id, { attribute: e.target.value })}
                placeholder="字段名"
                className={`${inputCls} w-40`}
              />
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={o.descending}
                  onChange={(e) => updateOrder(o.id, { descending: e.target.checked })}
                />
                降序
              </label>
              <button onClick={() => removeOrder(o.id)} className="text-xs text-gray-400 hover:text-red-500">
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Link-entity（关联）</span>
          <button onClick={addLink} className="text-xs font-medium text-purple-600 hover:underline dark:text-purple-400">
            + 添加 link-entity
          </button>
        </div>
        <div className="space-y-3">
          {query.links.map((l) => (
            <LinkEntityEditor key={l.id} link={l} onChange={(updated) => updateLink(l.id, updated)} onRemove={() => removeLink(l.id)} />
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {xml && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">生成的 FetchXML</span>
            <button
              onClick={() => navigator.clipboard.writeText(xml)}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              复制
            </button>
          </div>
          <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            {xml}
          </pre>
        </div>
      )}

      {xml && !error && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">Entity Set Name（猜测，可编辑）：</span>
          <input
            type="text"
            value={entitySetOverride}
            onChange={(e) => setEntitySetOverride(e.target.value)}
            placeholder={entitySetGuess}
            className={`${inputCls} w-40 font-mono`}
          />
          <button
            onClick={handleRun}
            disabled={!activeConnectionId || running}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? "执行中…" : "执行查询"}
          </button>
          {!activeConnectionId && <span className="text-xs text-gray-400">请先在侧边栏选择一个当前连接。</span>}
        </div>
      )}

      {runError && (
        <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
          {runError}
        </pre>
      )}

      {rows && (
        <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <div className="border-b border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {rows.length} 行
          </div>
          {rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2 font-mono">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-1.5 font-mono text-xs">
                        {typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
