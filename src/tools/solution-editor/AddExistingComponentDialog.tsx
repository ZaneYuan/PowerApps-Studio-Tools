import { useEffect, useMemo, useState } from "react";
import { addSolutionComponent, COMPONENT_SEARCH_LIMIT, searchComponentRecords } from "./dataverseOps";
import type { AddableComponentKind } from "./componentCatalog";
import type { PickableComponent } from "./types";
import ErrorMessage from "../../shared/ErrorMessage";
import Dialog from "../../shared/Dialog";

const SEARCH_DEBOUNCE_MS = 300;

export default function AddExistingComponentDialog({
  connectionId,
  solutionUniqueName,
  kind,
  onClose,
  onAdded,
}: {
  connectionId: string;
  solutionUniqueName: string;
  kind: AddableComponentKind;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [metadataItems, setMetadataItems] = useState<PickableComponent[] | null>(null);
  const [recordItems, setRecordItems] = useState<PickableComponent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, PickableComponent>>(new Map());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const source = kind.source;

  useEffect(() => {
    if (source.kind !== "metadata") return;
    source
      .load(connectionId)
      .then(setMetadataItems)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [connectionId, source]);

  useEffect(() => {
    if (source.kind !== "records") return;
    let cancelled = false;
    setRecordItems(null);
    setLoadError(null);
    const timer = setTimeout(() => {
      searchComponentRecords(connectionId, source, query)
        .then((items) => {
          if (!cancelled) setRecordItems(items);
        })
        .catch((err) => {
          if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connectionId, source, query]);

  const items = useMemo(() => {
    if (source.kind === "records") return recordItems;
    if (!metadataItems) return null;
    const q = query.trim().toLowerCase();
    const matched = q
      ? metadataItems.filter((i) => i.name.toLowerCase().includes(q) || (i.secondary ?? "").toLowerCase().includes(q))
      : metadataItems;
    return matched.slice(0, COMPONENT_SEARCH_LIMIT);
  }, [source.kind, recordItems, metadataItems, query]);

  function toggle(item: PickableComponent) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    const pending = [...selected.values()];
    try {
      for (const item of pending) {
        await addSolutionComponent(connectionId, solutionUniqueName, kind.componentType, item.id);
        setSelected((prev) => {
          const next = new Map(prev);
          next.delete(item.id);
          return next;
        });
      }
      onAdded();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog ariaLabel={`添加现有 ${kind.label}`} onClose={onClose} panelClassName="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900">
      <h3 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100">添加现有 · {kind.label}</h3>

      <div className="p-4 pb-2">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索名称…"
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="mt-1 text-[11px] text-gray-400">最多显示 {COMPONENT_SEARCH_LIMIT} 条，找不到请输入更多关键字。可多选。</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loadError && <p className="p-2 text-xs text-red-600 dark:text-red-400">{loadError}</p>}
        {!items && !loadError && <p className="p-2 text-xs text-gray-400">加载中…</p>}
        {items && items.length === 0 && <p className="p-2 text-xs text-gray-400">没有匹配的组件。</p>}
        {items?.map((item) => {
          const checked = selected.has(item.id);
          return (
            <label
              key={item.id}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${
                checked ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
              title={item.name}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(item)} />
              <span className="truncate">{item.name}</span>
              {item.secondary && <span className="shrink-0 truncate text-xs text-gray-400">({item.secondary})</span>}
            </label>
          );
        })}
      </div>

      {submitError && <ErrorMessage error={submitError} className="mx-4 mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}

      <div className="flex justify-end gap-2 border-t border-gray-200 p-3 dark:border-gray-800">
        <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={selected.size === 0 || submitting}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "添加中…" : `添加${selected.size > 0 ? `（${selected.size}）` : ""}`}
        </button>
      </div>
    </Dialog>
  );
}
