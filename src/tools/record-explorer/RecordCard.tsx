import { useEffect, useState } from "react";
import { matchedFields } from "./search";
import type { RecordSnapshot } from "./types";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function RecordCard({
  snapshot,
  searchText,
  defaultExpanded,
  subtitle,
}: {
  snapshot: RecordSnapshot;
  searchText: string;
  defaultExpanded: boolean;
  subtitle?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const matched = matchedFields(snapshot, searchText);

  // A hit anywhere in this record forces it open even if the user had collapsed it earlier.
  useEffect(() => {
    if (matched.size > 0) setExpanded(true);
  }, [matched.size]);

  const fieldEntries = Object.entries(snapshot.fields).filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {snapshot.primaryName}
          <span className="ml-2 font-mono text-xs font-normal text-gray-400">{snapshot.entityLogicalName}</span>
        </span>
        <span className="shrink-0 text-xs text-gray-400">{expanded ? "收起 ▲" : "展开 ▼"}</span>
      </button>
      {subtitle && <div className="px-3 pb-1 text-xs text-gray-400">来自：{subtitle}</div>}
      {expanded && (
        <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 border-t border-gray-100 px-3 py-2 text-xs dark:border-gray-800">
          {fieldEntries.map(([field, value]) => (
            <div key={field} className="contents">
              <div className="truncate font-mono text-gray-400" title={field}>
                {field}
              </div>
              <div className={`min-w-0 break-all ${matched.has(field) ? "rounded bg-yellow-200 px-1 dark:bg-yellow-500/40" : ""}`}>
                {formatValue(value)}
              </div>
            </div>
          ))}
          {fieldEntries.length === 0 && <div className="col-span-2 text-gray-400">没有非空字段。</div>}
        </div>
      )}
    </div>
  );
}
