import { useMemo, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { useEntitySetName } from "../../native/useEntitySetName";
import { parseSql } from "./translate";

const SAMPLE = `SELECT TOP 50 name, revenue, statecode
FROM account
WHERE statecode = 0 AND (name LIKE 'Contoso%' OR telephone1 IS NOT NULL)
ORDER BY name`;

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

function OutputRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
        <button
          onClick={() => navigator.clipboard.writeText(value)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          复制
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        {value}
      </pre>
    </div>
  );
}

export default function Sql4Cds() {
  const { activeConnectionId } = useActiveConnection();
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const result = useMemo(() => parseSql(sql), [sql]);

  // Every non-error/non-empty statement kind carries entityLogicalName/entitySetGuess — narrow
  // once here instead of repeating the `"entityLogicalName" in result` check at every use site.
  const hasEntity = result.kind !== "error" && result.kind !== "empty";
  const entityLogicalName = hasEntity ? result.entityLogicalName : null;
  const entitySetGuess = hasEntity ? result.entitySetGuess : null;

  const entitySetMeta = useEntitySetName(activeConnectionId, entityLogicalName ?? "");
  const entitySet = entitySetMeta.entitySetName || entitySetGuess || "";

  const path = useMemo(() => {
    if (!entitySet) return "";
    if (result.kind === "select-simple") {
      const parts: string[] = [];
      if (result.select) parts.push(`$select=${result.select}`);
      if (result.filter) parts.push(`$filter=${result.filter}`);
      if (result.orderby) parts.push(`$orderby=${result.orderby}`);
      if (result.top) parts.push(`$top=${result.top}`);
      return parts.length ? `${entitySet}?${parts.join("&")}` : entitySet;
    }
    if (result.kind === "select-complex") {
      return `${entitySet}?fetchXml=${encodeURIComponent(result.fetchXml)}`;
    }
    return "";
  }, [entitySet, result]);

  async function handleRun() {
    if (!activeConnectionId || !path) return;
    setRunning(true);
    setRunError(null);
    setRows(null);
    try {
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
    <div className="max-w-4xl space-y-6">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        支持 SELECT（含 JOIN / GROUP BY / 聚合函数，翻译成 FetchXML 执行）。INSERT / UPDATE / DELETE 即将支持。用
        T-SQL 语法解析，翻译成 Dataverse Web API 查询后真实执行。
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">SQL</label>
          <button onClick={() => setSql(SAMPLE)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            填充示例
          </button>
        </div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder="SELECT name FROM account WHERE statecode = 0"
          className={inputCls}
        />
      </div>

      {result.kind === "error" && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {result.error}
        </div>
      )}

      {hasEntity && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">实体：</span>
          <code className="rounded bg-gray-100 px-2 py-0.5 dark:bg-gray-800">{entityLogicalName}</code>
          <span className="text-gray-500 dark:text-gray-400">
            Entity Set Name（{entitySetMeta.resolved ? "已从元数据确认" : "猜测"}，可编辑覆盖）：
          </span>
          <input
            type="text"
            value={entitySetMeta.override}
            onChange={(e) => entitySetMeta.setOverride(e.target.value)}
            placeholder={entitySetMeta.resolved ?? entitySetGuess ?? ""}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {entitySetMeta.loading && <span className="text-xs text-gray-400">读取真实值中…</span>}
          {entitySetMeta.resolved && !entitySetMeta.loading && (
            <span className="text-xs text-green-600 dark:text-green-400">✓ 真实值</span>
          )}
          {entitySetMeta.error && !entitySetMeta.loading && (
            <span className="text-xs text-amber-600 dark:text-amber-400" title={entitySetMeta.error}>
              ⚠ 读取失败，已回退为猜测值
            </span>
          )}
          {activeConnectionId && (
            <button onClick={entitySetMeta.refresh} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
              刷新
            </button>
          )}
        </div>
      )}

      {(result.kind === "select-simple" || result.kind === "select-complex") && (
        <>
          {result.kind === "select-complex" ? (
            <OutputRow label="FetchXML" value={result.fetchXml} />
          ) : (
            <OutputRow label="请求路径" value={path} />
          )}

          {result.warnings.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              {result.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}

          <div>
            <button
              onClick={handleRun}
              disabled={!activeConnectionId || running}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {running ? "执行中…" : "执行查询"}
            </button>
            {!activeConnectionId && <span className="ml-2 text-xs text-gray-400">请先在侧边栏选择一个我的连接。</span>}
          </div>

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
        </>
      )}

      {(result.kind === "insert" || result.kind === "mutate") && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          {result.kind === "insert"
            ? `已识别为 INSERT（目标实体 ${result.entityLogicalName}，${result.rows.length} 行）`
            : `已识别为 ${result.action === "update" ? "UPDATE" : "DELETE"}（目标实体 ${result.entityLogicalName}）`}
          ，执行功能正在这次改动的下一部分实现中。
        </div>
      )}
    </div>
  );
}
