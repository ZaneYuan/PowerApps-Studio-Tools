import { memo, useMemo, useState, type ReactNode } from "react";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

/** Shared by StepRegisterDialog's "Filtering Attributes", ImageRegisterDialog's "Attributes",
 *  and CheckableGrid's column picker — a search box to cut down a long field list, checkboxes
 *  to pick from it, and a "已选择 N 个" count below instead of spelling out every selected name.
 *  Wrapped in `memo`: a wide entity (a product-class table easily has 150-280 attributes) made
 *  this list expensive enough that re-rendering it on every unrelated parent re-render was a real,
 *  visible stutter — CheckableGrid now goes out of its way to keep every prop here referentially
 *  stable across its own scroll-driven re-renders (see its own comments), and `memo` is what
 *  actually turns "stable props" into "skip re-rendering this" instead of doing the work anyway. */
function AttributePicker({
  label,
  options,
  selected,
  onToggle,
  onToggleAll,
  renderBadge,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  /** Selects (true) or clears (false) every option — the *full* list, not just what the search
   *  box/已勾选/未勾选 filters currently show, matching how a grid's own row-select-all checkbox
   *  works regardless of any visual filtering. */
  onToggleAll: (selectAll: boolean) => void;
  renderBadge?: (name: string) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [showChecked, setShowChecked] = useState(true);
  const [showUnchecked, setShowUnchecked] = useState(true);
  const allSelected = options.length > 0 && options.every((o) => selected.has(o));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((a) => {
      if (q && !a.toLowerCase().includes(q)) return false;
      return selected.has(a) ? showChecked : showUnchecked;
    });
  }, [options, query, selected, showChecked, showUnchecked]);

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
      <div className="mb-1.5 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={allSelected} onChange={(e) => onToggleAll(e.target.checked)} />
          全选
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={showChecked} onChange={(e) => setShowChecked(e.target.checked)} />
          已勾选
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={showUnchecked} onChange={(e) => setShowUnchecked(e.target.checked)} />
          未勾选
        </label>
      </div>
      <div className="max-h-32 overflow-y-auto rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700">
        {filtered.length === 0 && <p className="text-gray-400">没有匹配的字段。</p>}
        {filtered.map((a) => (
          <label key={a} className="mr-3 inline-flex items-center gap-1">
            <input type="checkbox" checked={selected.has(a)} onChange={() => onToggle(a)} />
            {a}
            {renderBadge?.(a)}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-400">已选择 {selected.size} 个字段</p>
    </div>
  );
}

export default memo(AttributePicker);
