import { useRef, useState, type FocusEvent } from "react";

export interface ColumnFilter {
  operator: "equals" | "contains";
  value: string;
}

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

/** D365-grid-style "Filter by" popover (Equals gets a dropdown of values actually present in the
 *  column, matching D365's own choice-column filter; Contains gets a free-text substring box).
 *  Generic on purpose — takes the column's distinct values and a plain {operator, value} filter,
 *  no knowledge of what column or entity it's filtering — so wiring up a second column later is
 *  just another instance of this component, not a new one.
 *
 *  Positioned with `position: fixed` (coordinates read from the trigger button's own
 *  getBoundingClientRect() on open) instead of `absolute`: the caller's table lives inside an
 *  `overflow-auto` scroll container, which would clip an `absolute`-positioned popover that
 *  extends past the visible scrolled area. `fixed` escapes that clipping since this app doesn't
 *  put `transform`/`filter` on any ancestor (which would otherwise re-establish a containing
 *  block for fixed descendants). Closes via the same blur/relatedTarget pattern already used by
 *  fetchxml-builder/SuggestInput.tsx rather than a new document-level click listener. */
export default function ColumnFilterPopover({
  label,
  distinctValues,
  filter,
  onApply,
  onClear,
}: {
  label: string;
  distinctValues: string[];
  filter: ColumnFilter | null;
  onApply: (filter: ColumnFilter) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [operator, setOperator] = useState<ColumnFilter["operator"]>(filter?.operator ?? "equals");
  const [value, setValue] = useState(filter?.value ?? "");
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function handleOpen() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOperator(filter?.operator ?? "equals");
    setValue(filter?.value ?? "");
    setOpen(true);
  }

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }

  function handleOperatorChange(next: ColumnFilter["operator"]) {
    setOperator(next);
    // Switching to Equals with a value that was free-typed under Contains (and isn't one of the
    // column's real values) would leave the <select> silently showing nothing selected — clear it
    // instead so the dropdown state stays honest.
    if (next === "equals" && !distinctValues.includes(value)) setValue("");
  }

  function handleApply() {
    if (!value) return;
    onApply({ operator, value });
    setOpen(false);
  }

  function handleClear() {
    setValue("");
    onClear();
    setOpen(false);
  }

  return (
    <div tabIndex={-1} onBlur={handleBlur} className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : handleOpen())}
        title="筛选"
        className={`ml-1 rounded px-1 text-xs ${
          filter
            ? "text-blue-600 dark:text-blue-400"
            : "text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
        }`}
      >
        ▾
      </button>

      {open && (
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-50 w-56 rounded-md border border-gray-200 bg-white p-3 text-left font-normal normal-case shadow-xl dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Filter by {label}</span>
            <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-red-500">
              ✕
            </button>
          </div>

          <select
            value={operator}
            onChange={(e) => handleOperatorChange(e.target.value as ColumnFilter["operator"])}
            className={`${inputCls} mb-2`}
          >
            <option value="equals">Equals</option>
            <option value="contains">Contains</option>
          </select>

          {operator === "equals" ? (
            <select value={value} onChange={(e) => setValue(e.target.value)} className={`${inputCls} mb-3`}>
              <option value="">（选择一个值）</option>
              {distinctValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="包含…"
              className={`${inputCls} mb-3`}
            />
          )}

          <div className="flex gap-2">
            <button
              onClick={handleApply}
              disabled={!value}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply
            </button>
            <button
              onClick={handleClear}
              disabled={!filter}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
