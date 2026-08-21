import { useEffect, useState } from "react";
import { callNative } from "../native/bridge";
import { fetchEntityMeta, type EntityMeta } from "../native/metadataService";
import { buildLookupRelationshipMap, type RelationshipMeta } from "../native/navProperty";
import { escapeODataString } from "../native/odata";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

/** Search-and-pick modal for a Lookup/Customer/Owner-typed condition value — resolves the
 *  field's real target entity(ies) via `buildLookupRelationshipMap` (a polymorphic lookup like
 *  `customerid` resolves to more than one candidate; the user picks which one to search), then
 *  queries that entity's records with a debounced `contains()` filter on its primary name
 *  attribute. Follows the same `fixed inset-0 ... bg-black/40` modal shell every other dialog in
 *  this app already uses (see plugin-registration/StepRegisterDialog.tsx).
 *
 *  `multiValue` (true for `in`/`not-in` conditions) keeps the modal open after each pick instead
 *  of closing it — the caller appends the picked value to a comma-separated list instead of
 *  replacing a single value, so picking several records in one sitting has to stay possible. */
export default function LookupPickerModal({
  connectionId,
  entityLogicalName,
  attributeLogicalName,
  multiValue,
  onPick,
  onClose,
}: {
  connectionId: string;
  entityLogicalName: string;
  attributeLogicalName: string;
  multiValue: boolean;
  /** `label` is the picked record's resolved primary-name text (empty string if the target
   *  entity has no primary name attribute) - purely for callers that want to display something
   *  more readable than a raw GUID; existing callers that only take `(value)` still work
   *  unchanged since this is an additional argument, not a replaced one. */
  onPick: (value: string, label: string) => void;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<RelationshipMeta[] | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [targetEntity, setTargetEntity] = useState("");

  useEffect(() => {
    let cancelled = false;
    buildLookupRelationshipMap(connectionId, entityLogicalName)
      .then((map) => {
        if (cancelled) return;
        const list = [...(map.get(attributeLogicalName.toLowerCase()) ?? [])].sort((a, b) =>
          a.ReferencedEntity.localeCompare(b.ReferencedEntity),
        );
        if (list.length === 0) {
          setCandidatesError(`找不到字段 "${attributeLogicalName}" 对应的查找关系元数据，无法确定它指向哪个实体。`);
          return;
        }
        setCandidates(list);
        setTargetEntity(list[0].ReferencedEntity);
      })
      .catch((err) => {
        if (!cancelled) setCandidatesError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, entityLogicalName, attributeLogicalName]);

  const [meta, setMeta] = useState<EntityMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    if (!targetEntity) return;
    let cancelled = false;
    setMeta(null);
    setMetaError(null);
    fetchEntityMeta(connectionId, targetEntity)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((err) => {
        if (!cancelled) setMetaError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, targetEntity]);

  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    setResultsLoading(true);
    setResultsError(null);
    const timer = setTimeout(() => {
      const selectCols = meta.primaryNameAttribute ? `${meta.primaryIdAttribute},${meta.primaryNameAttribute}` : meta.primaryIdAttribute;
      const parts = [`$select=${selectCols}`, "$top=50"];
      const q = searchText.trim();
      // A handful of system/config entities have an empty PrimaryNameAttribute — skip the
      // contains() filter and the name column entirely rather than emit malformed OData
      // (`contains(,'...')` / a trailing comma in $select).
      if (q && meta.primaryNameAttribute) {
        parts.push(`$filter=contains(${meta.primaryNameAttribute},'${escapeODataString(q)}')`);
      }
      callNative<{ value: Record<string, unknown>[] }>("dataverse.request", {
        connectionId,
        method: "GET",
        path: `${meta.entitySetName}?${parts.join("&")}`,
      })
        .then((res) => {
          if (!cancelled) setResults(res.value);
        })
        .catch((err) => {
          if (!cancelled) setResultsError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setResultsLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connectionId, meta, searchText]);

  function handleTargetChange(entity: string) {
    setTargetEntity(entity);
    setResults(null);
    setSearchText("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            查找字段 "{attributeLogicalName}"{targetEntity ? ` — 搜索 ${targetEntity}` : ""}
          </span>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-red-500">
            ✕ 关闭
          </button>
        </div>

        {!candidates && !candidatesError && <p className="text-xs text-gray-400">解析查找关系元数据中…</p>}
        {candidatesError && <p className="text-sm text-red-600 dark:text-red-400">{candidatesError}</p>}

        {candidates && candidates.length > 1 && (
          <div className="mb-2">
            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
              该字段是多态查找，可能指向多个实体，选择要搜索的实体：
            </label>
            <select value={targetEntity} onChange={(e) => handleTargetChange(e.target.value)} className={inputCls}>
              {candidates.map((c) => (
                <option key={c.ReferencedEntity} value={c.ReferencedEntity}>
                  {c.ReferencedEntity}
                </option>
              ))}
            </select>
          </div>
        )}

        {metaError && <p className="text-sm text-red-600 dark:text-red-400">{metaError}</p>}

        {meta && (
          <>
            <input
              type="text"
              autoFocus
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={meta.primaryNameAttribute ? `按 ${meta.primaryNameAttribute} 搜索…` : "该实体没有可搜索的主名称字段，直接显示前 50 条"}
              className={`${inputCls} mb-2`}
            />

            <div className="flex-1 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-800">
              {resultsLoading && <p className="p-3 text-xs text-gray-400">搜索中…</p>}
              {resultsError && <p className="p-3 text-xs text-red-500 dark:text-red-400">{resultsError}</p>}
              {!resultsLoading && !resultsError && results && results.length === 0 && (
                <p className="p-3 text-xs text-gray-400">没有匹配的记录。</p>
              )}
              {!resultsLoading && results && results.length > 0 && (
                <table className="w-full text-left text-sm">
                  <tbody>
                    {results.map((row) => {
                      const id = String(row[meta.primaryIdAttribute]);
                      const name = meta.primaryNameAttribute ? String(row[meta.primaryNameAttribute] ?? "") : "";
                      return (
                        <tr key={id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="px-3 py-1.5">
                            <div className="text-gray-900 dark:text-gray-100">{name || "（无名称）"}</div>
                            <div className="font-mono text-xs text-gray-400">{id}</div>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <button
                              onClick={() => {
                                onPick(id, name);
                                if (!multiValue) onClose();
                              }}
                              className="rounded border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                            >
                              选择
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {multiValue && (
          <div className="mt-3 flex justify-end">
            <button onClick={onClose} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
