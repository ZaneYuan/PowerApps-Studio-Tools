import { useState, type FocusEvent } from "react";
import LookupPickerModal from "./LookupPickerModal";
import { operatorsForKind, type ColumnKind, type FilterOperator, type GridColumnFilter } from "./gridFilter";
import type { GridColumn } from "./CheckableGrid";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

/** CheckableGrid's "Filter by" popover — a condition dropdown (options depend on the column's
 *  `kind`, see gridFilter.ts) plus a value widget that changes shape by (kind, operator): plain
 *  text for strings, `type="number"` for numbers, `type="date"` for the date-valued conditions,
 *  a searchable Lookup-record picker (reusing LookupPickerModal) for Lookup columns, a plain
 *  True/False `<select>` for Booleans, and a scrollable multi-select checkbox list (built from
 *  the column's own `options`, already fetched for its "select" cell editor) for OptionSet
 *  columns. Self-contained conditions (`contains data`, `today`, `this month`, ...) render no
 *  value widget at all — the operator alone is the whole condition.
 *
 *  Positioned with `position: fixed` from an already-computed anchor rect (the caller — GridHeader
 *  — owns the trigger button and menu, this only renders the popover body) for the same reason as
 *  metadata-browser/ColumnFilterPopover.tsx: the grid's own scroll container is `overflow-auto`
 *  and would clip an `absolute`-positioned popover. Closes via blur/relatedTarget, matching that
 *  same component and fetchxml-builder/SuggestInput.tsx. */
export default function ColumnFilterPopover({
  column,
  kind,
  filter,
  anchor,
  onApply,
  onClear,
  onClose,
  connectionId,
  entityLogicalName,
}: {
  column: GridColumn;
  kind: ColumnKind;
  filter: GridColumnFilter | null;
  anchor: { top: number; left: number };
  onApply: (filter: GridColumnFilter) => void;
  onClear: () => void;
  onClose: () => void;
  connectionId?: string;
  entityLogicalName?: string;
}) {
  const operators = operatorsForKind(kind);
  const [operator, setOperator] = useState<FilterOperator>(filter?.operator ?? operators[0].value);
  const [value, setValue] = useState(filter?.value ?? "");
  const [label, setLabel] = useState(filter?.label ?? "");
  const [values, setValues] = useState<string[]>(filter?.values ?? []);
  const [optionSearch, setOptionSearch] = useState("");
  const [lookupModalOpen, setLookupModalOpen] = useState(false);

  const needsValue = operators.find((o) => o.value === operator)?.needsValue ?? true;

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) onClose();
  }

  function toggleOption(optionValue: string) {
    setValues((prev) => (prev.includes(optionValue) ? prev.filter((v) => v !== optionValue) : [...prev, optionValue]));
  }

  function handleApply() {
    if (kind === "optionset") {
      if (values.length === 0) return;
      onApply({ operator, values });
    } else {
      if (needsValue && !value) return;
      onApply({ operator, value: needsValue ? value : undefined, label: needsValue ? label : undefined });
    }
  }

  const canApply = kind === "optionset" ? values.length > 0 : !needsValue || value !== "";
  const visibleOptions = column.options?.filter((o) => o.label.toLowerCase().includes(optionSearch.toLowerCase())) ?? [];

  return (
    <div
      tabIndex={-1}
      onBlur={handleBlur}
      style={{ position: "fixed", top: anchor.top, left: anchor.left }}
      className="z-50 w-64 rounded-md border border-gray-200 bg-white p-3 text-left text-sm font-normal normal-case text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Filter by</span>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-red-500">
          ✕
        </button>
      </div>

      <select
        value={operator}
        onChange={(e) => setOperator(e.target.value as FilterOperator)}
        className={`${inputCls} mb-2`}
      >
        {operators.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {needsValue && kind === "string" && (
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputCls} mb-3`} autoFocus />
      )}

      {needsValue && kind === "number" && (
        <input type="number" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputCls} mb-3`} autoFocus />
      )}

      {needsValue && kind === "date" && (
        <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputCls} mb-3`} autoFocus />
      )}

      {needsValue && kind === "boolean" && (
        <select value={value} onChange={(e) => setValue(e.target.value)} className={`${inputCls} mb-3`}>
          <option value="">（选择一个值）</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      )}

      {needsValue && kind === "lookup" && (
        <>
          <div className="mb-3 flex items-center gap-1">
            <input
              type="text"
              value={label || value}
              readOnly
              placeholder="点击 🔍 搜索记录"
              className={`${inputCls} min-w-0 flex-1 cursor-default`}
            />
            <button
              type="button"
              onClick={() => setLookupModalOpen(true)}
              title="搜索并选择记录"
              aria-label="搜索并选择记录"
              disabled={!connectionId || !entityLogicalName}
              className="shrink-0 rounded border border-gray-300 px-1.5 py-1 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              🔍
            </button>
          </div>
          {lookupModalOpen && connectionId && entityLogicalName && (
            <LookupPickerModal
              connectionId={connectionId}
              entityLogicalName={entityLogicalName}
              attributeLogicalName={column.key}
              multiValue={false}
              onPick={(pickedValue, pickedLabel) => {
                setValue(pickedValue);
                setLabel(pickedLabel);
                setLookupModalOpen(false);
              }}
              onClose={() => setLookupModalOpen(false)}
            />
          )}
        </>
      )}

      {needsValue && kind === "optionset" && (
        <div className="mb-3">
          {(column.options?.length ?? 0) > 8 && (
            <input
              type="text"
              value={optionSearch}
              onChange={(e) => setOptionSearch(e.target.value)}
              placeholder="搜索选项…"
              className={`${inputCls} mb-1`}
            />
          )}
          <div className="max-h-48 overflow-y-auto rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            {visibleOptions.length === 0 && <p className="p-2 text-xs text-gray-400">没有匹配的选项。</p>}
            {visibleOptions.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <input type="checkbox" checked={values.includes(o.value)} onChange={() => toggleOption(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={!canApply}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!filter}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
