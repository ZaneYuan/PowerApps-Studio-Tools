import { useEffect, useMemo, useState } from "react";
import { addExistingTableComponent, fetchAllEntitiesForPicker, type PickableEntity } from "./dataverseOps";

export default function AddExistingTableDialog({
  connectionId,
  solutionUniqueName,
  onClose,
  onAdded,
}: {
  connectionId: string;
  solutionUniqueName: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [entities, setEntities] = useState<PickableEntity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PickableEntity | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllEntitiesForPicker(connectionId)
      .then(setEntities)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [connectionId]);

  const filtered = useMemo(() => {
    if (!entities) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entities.slice(0, 100);
    return entities.filter((e) => e.displayName.toLowerCase().includes(q) || e.logicalName.toLowerCase().includes(q)).slice(0, 100);
  }, [entities, query]);

  async function handleSubmit() {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await addExistingTableComponent(connectionId, solutionUniqueName, selected.metadataId);
      onAdded();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900">
        <h3 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100">添加现有表</h3>

        <div className="p-4 pb-2">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索表名…"
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {loadError && <p className="p-2 text-xs text-red-600 dark:text-red-400">{loadError}</p>}
          {!entities && !loadError && <p className="p-2 text-xs text-gray-400">加载中…</p>}
          {entities && filtered.length === 0 && <p className="p-2 text-xs text-gray-400">没有匹配的表。</p>}
          {filtered.map((e) => (
            <button
              key={e.metadataId}
              onClick={() => setSelected(e)}
              className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                selected?.metadataId === e.metadataId
                  ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                  : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
              title={e.logicalName}
            >
              {e.displayName} <span className="text-xs text-gray-400">({e.logicalName})</span>
            </button>
          ))}
        </div>

        {submitError && (
          <p className="mx-4 mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-200 p-3 dark:border-gray-800">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selected || submitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "添加中…" : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}
