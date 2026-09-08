import { DEFAULT_QUERY_ROW_LIMIT } from "../native/dataverseQuery";

/** Row-cap input shared by every query tool (SQL4CDS / Data Migration / Data Copy / Data Edit /
 *  FetchXML Builder). `0` means "no limit" — the query pages until Dataverse runs out, which the
 *  caller should confirm before running since it can be slow and large. */
export function RowLimitInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400" title="0 = 不限制（分页拉取全部，可能很慢）">
      结果上限
      <input
        type="number"
        min={0}
        step={1000}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="w-20 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
      <span className="text-gray-400">{value === 0 ? "不限" : "行"}</span>
    </label>
  );
}

/** "取消查询" button — render while a query is running; wire `onCancel` to an AbortController. */
export function CancelQueryButton({ onCancel }: { onCancel: () => void }) {
  return (
    <button
      onClick={onCancel}
      className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
    >
      取消查询
    </button>
  );
}

/** One-line status under the run button: live "已加载 N 行…" while paging, then a truncation note
 *  once the run finished short of everything. Renders nothing when there's nothing to say. */
export function QueryProgressNote({
  running,
  loaded,
  truncated,
  rowLimit,
}: {
  running: boolean;
  loaded: number | null;
  truncated: boolean;
  rowLimit: number;
}) {
  if (running && loaded !== null) {
    return <p className="text-xs text-gray-500 dark:text-gray-400">已加载 {loaded.toLocaleString()} 行…</p>;
  }
  if (!running && truncated) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        ⚠ 结果已达上限 {rowLimit.toLocaleString()} 行，可能还有更多——调高上方"结果上限"或缩小查询条件后重新执行。
      </p>
    );
  }
  return null;
}

export { DEFAULT_QUERY_ROW_LIMIT };
