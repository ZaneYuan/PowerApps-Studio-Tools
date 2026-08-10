import { useMemo, useState } from "react";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

/** Shared by StepRegisterDialog's "Filtering Attributes" and ImageRegisterDialog's
 *  "Attributes" — a search box to cut down a long field list, checkboxes to pick from it, and
 *  a "已选择 N 个" count below instead of spelling out every selected name. */
export default function AttributePicker({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((a) => a.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="text"
        placeholder="搜索字段…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`${inputCls} mb-1.5`}
      />
      <div className="max-h-32 overflow-y-auto rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700">
        {filtered.length === 0 && <p className="text-gray-400">没有匹配的字段。</p>}
        {filtered.map((a) => (
          <label key={a} className="mr-3 inline-flex items-center gap-1">
            <input type="checkbox" checked={selected.has(a)} onChange={() => onToggle(a)} />
            {a}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-400">已选择 {selected.size} 个字段</p>
    </div>
  );
}
