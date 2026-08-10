import { Fragment, useEffect, useMemo, useState } from "react";
import { matchedFields } from "./search";
import type { ChildGroup } from "./types";

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ChildTablePanel({ groups, searchText }: { groups: ChildGroup[]; searchText: string }) {
  const filtered = useMemo(() => {
    const q = searchText.trim();
    return groups
      .map((g) => ({ ...g, rows: q ? g.rows.filter((r) => matchedFields(r, q).size > 0) : g.rows }))
      .filter((g) => g.rows.length > 0);
  }, [groups, searchText]);

  const [activeEntity, setActiveEntity] = useState<string | null>(filtered[0]?.entityLogicalName ?? null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!filtered.some((g) => g.entityLogicalName === activeEntity)) {
      setActiveEntity(filtered[0]?.entityLogicalName ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  if (groups.length === 0) {
    return <p className="text-sm text-gray-400">这条记录没有匹配到子表关系（或都被系统噪音表过滤掉了）。</p>;
  }
  if (filtered.length === 0) {
    return <p className="text-sm text-gray-400">没有子表命中当前搜索词。</p>;
  }

  const active = filtered.find((g) => g.entityLogicalName === activeEntity) ?? filtered[0];
  const columns = active.rows.length > 0 ? Object.keys(active.rows[0].fields) : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
        {filtered.map((g) => (
          <button
            key={g.entityLogicalName}
            onClick={() => setActiveEntity(g.entityLogicalName)}
            className={`px-3 py-1.5 text-sm ${
              active.entityLogicalName === g.entityLogicalName
                ? "border-b-2 border-blue-600 font-medium text-blue-700 dark:text-blue-400"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {g.entityLogicalName}
            <span className="ml-1 text-xs text-gray-400">({g.rows.length}{g.truncated ? "+" : ""})</span>
          </button>
        ))}
      </div>

      {active.truncated && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          结果超过 50 行，已截断——用搜索缩小范围可以看到更精确的匹配。
        </p>
      )}

      <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
            <tr>
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 font-mono">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.rows.map((row) => {
              const matched = searchText.trim() ? matchedFields(row, searchText) : new Set<string>();
              const rowKey = row.id || JSON.stringify(row.fields).slice(0, 40);
              const isExpanded = expandedId === rowKey;
              return (
                <Fragment key={rowKey}>
                  <tr
                    onClick={() => setExpandedId((k) => (k === rowKey ? null : rowKey))}
                    className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    {columns.map((c) => (
                      <td
                        key={c}
                        className={`whitespace-nowrap px-3 py-1.5 font-mono text-xs ${
                          matched.has(c) ? "bg-yellow-200 dark:bg-yellow-500/40" : ""
                        }`}
                      >
                        {cellValue(row.fields[c])}
                      </td>
                    ))}
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={columns.length} className="border-t border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
                        <pre className="max-h-64 overflow-auto text-xs text-gray-700 dark:text-gray-300">
                          {JSON.stringify(row.fields, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
