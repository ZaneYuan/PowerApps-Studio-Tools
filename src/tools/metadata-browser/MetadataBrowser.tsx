import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import {
  RELATIONSHIP_COLLECTION,
  TAB_LABELS,
  labelOf,
  type AttributeSummary,
  type EntitySummary,
  type RelationshipSummary,
  type TabKey,
} from "./types";

const TABS: TabKey[] = ["attributes", "oneToMany", "manyToOne", "manyToMany"];

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

function attributeSelect() {
  return "LogicalName,SchemaName,DisplayName,AttributeType,RequiredLevel,IsCustomAttribute,IsPrimaryId,MetadataId";
}

function relationshipSelect(tab: Exclude<TabKey, "attributes">) {
  if (tab === "manyToMany") {
    return "SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName,MetadataId";
  }
  return "SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedEntity,ReferencedAttribute,MetadataId";
}

export default function MetadataBrowser() {
  const { activeConnectionId } = useActiveConnection();

  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState("");

  // Opened entities behave like browser tabs: switching between them must not lose scroll
  // position, active sub-tab, or row filter, so each of those is keyed by LogicalName instead
  // of living in a single shared field.
  const [openEntities, setOpenEntities] = useState<EntitySummary[]>([]);
  const [activeLogicalName, setActiveLogicalName] = useState<string | null>(null);
  const [activeTabByEntity, setActiveTabByEntity] = useState<Record<string, TabKey>>({});
  const [rowFilterByEntity, setRowFilterByEntity] = useState<Record<string, string>>({});

  const [tabCache, setTabCache] = useState<Record<string, (AttributeSummary | RelationshipSummary)[]>>({});
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);

  // Row-click "expand full JSON below" is disabled for now in favor of per-cell click-to-copy
  // (see the table rendering below) — commented out rather than deleted in case it comes back.
  // const [expanded, setExpanded] = useState<{ key: string; data: unknown } | null>(null);
  // const [expandLoading, setExpandLoading] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!activeConnectionId) {
      setEntities(null);
      return;
    }
    setEntities(null);
    setEntitiesError(null);
    setOpenEntities([]);
    setActiveLogicalName(null);
    setActiveTabByEntity({});
    setRowFilterByEntity({});
    fetchDataverse<{ value: EntitySummary[] }>(
      activeConnectionId,
      // EntityDefinitions doesn't support $orderby — sort client-side instead.
      "EntityDefinitions?$select=LogicalName,SchemaName,DisplayName,ObjectTypeCode,IsCustomEntity,EntitySetName",
    )
      .then((res) => setEntities([...res.value].sort((a, b) => a.LogicalName.localeCompare(b.LogicalName))))
      .catch((err) => setEntitiesError(err instanceof Error ? err.message : String(err)));
  }, [activeConnectionId]);

  const filteredEntities = useMemo(() => {
    if (!entities) return [];
    const q = entityFilter.trim().toLowerCase();
    if (!q) return entities;
    return entities
      .filter((e) => e.LogicalName.toLowerCase().includes(q) || labelOf(e.DisplayName, "").toLowerCase().includes(q))
      // Shorter names are usually the closer match (searching "quote" should surface `quote`
      // itself before `contoso_leadquotemember`) — simple stand-in for real relevance ranking.
      .sort((a, b) => labelOf(a.DisplayName, a.LogicalName).length - labelOf(b.DisplayName, b.LogicalName).length);
  }, [entities, entityFilter]);

  async function loadTab(entity: EntitySummary, tab: TabKey) {
    const cacheKey = `${entity.LogicalName}:${tab}`;
    if (tabCache[cacheKey] || !activeConnectionId) return;
    setTabLoading(true);
    setTabError(null);
    try {
      const path =
        tab === "attributes"
          ? `EntityDefinitions(LogicalName='${entity.LogicalName}')/Attributes?$select=${attributeSelect()}`
          : `EntityDefinitions(LogicalName='${entity.LogicalName}')/${RELATIONSHIP_COLLECTION[tab]}?$select=${relationshipSelect(tab)}`;
      const res = await fetchDataverse<{ value: (AttributeSummary | RelationshipSummary)[] }>(
        activeConnectionId,
        path,
      );
      const sorted =
        tab === "attributes"
          ? [...res.value].sort((a, b) =>
              (a as AttributeSummary).LogicalName.localeCompare((b as AttributeSummary).LogicalName),
            )
          : res.value;
      setTabCache((c) => ({ ...c, [cacheKey]: sorted }));
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setTabLoading(false);
    }
  }

  const selectedEntity = openEntities.find((e) => e.LogicalName === activeLogicalName) ?? null;
  const activeTab: TabKey = (activeLogicalName && activeTabByEntity[activeLogicalName]) || "attributes";
  const rowFilter = (activeLogicalName && rowFilterByEntity[activeLogicalName]) || "";

  function openEntity(entity: EntitySummary) {
    setOpenEntities((prev) => (prev.some((e) => e.LogicalName === entity.LogicalName) ? prev : [...prev, entity]));
    setActiveLogicalName(entity.LogicalName);
    setActiveTabByEntity((prev) => (prev[entity.LogicalName] ? prev : { ...prev, [entity.LogicalName]: "attributes" }));
    void loadTab(entity, activeTabByEntity[entity.LogicalName] ?? "attributes");
  }

  function closeEntityTab(logicalName: string, e: MouseEvent) {
    e.stopPropagation();
    setOpenEntities((prev) => {
      const idx = prev.findIndex((x) => x.LogicalName === logicalName);
      const next = prev.filter((x) => x.LogicalName !== logicalName);
      if (activeLogicalName === logicalName) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        setActiveLogicalName(fallback ? fallback.LogicalName : null);
      }
      return next;
    });
  }

  function selectTab(tab: TabKey) {
    if (!activeLogicalName) return;
    setActiveTabByEntity((prev) => ({ ...prev, [activeLogicalName]: tab }));
    if (selectedEntity) void loadTab(selectedEntity, tab);
  }

  function setRowFilter(value: string) {
    if (!activeLogicalName) return;
    setRowFilterByEntity((prev) => ({ ...prev, [activeLogicalName]: value }));
  }

  // async function toggleExpand(rowKey: string, metadataId: string) {
  //   if (expanded?.key === rowKey) {
  //     setExpanded(null);
  //     return;
  //   }
  //   if (!activeConnectionId || !selectedEntity) return;
  //   setExpandLoading(rowKey);
  //   try {
  //     const collection = activeTab === "attributes" ? "Attributes" : RELATIONSHIP_COLLECTION[activeTab];
  //     const path = `EntityDefinitions(LogicalName='${selectedEntity.LogicalName}')/${collection}(${metadataId})`;
  //     const detail = await fetchDataverse<unknown>(activeConnectionId, path);
  //     setExpanded({ key: rowKey, data: detail });
  //   } catch (err) {
  //     setExpanded({ key: rowKey, data: { 错误: err instanceof Error ? err.message : String(err) } });
  //   } finally {
  //     setExpandLoading(null);
  //   }
  // }

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
  }

  const currentRows = selectedEntity ? (tabCache[`${selectedEntity.LogicalName}:${activeTab}`] ?? null) : null;
  const filteredRows = useMemo(() => {
    if (!currentRows) return null;
    const q = rowFilter.trim().toLowerCase();
    if (!q) return currentRows;
    return currentRows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [currentRows, rowFilter]);

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }

  if (!activeConnectionId) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        请先在左侧侧边栏顶部选择一个"当前连接"（没有连接的话先去"我的连接"里添加）。
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <div className="flex w-72 shrink-0 flex-col rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="border-b border-gray-200 p-2 dark:border-gray-800">
          <input
            type="text"
            placeholder="搜索实体…"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {entitiesError && <p className="p-3 text-xs text-red-600 dark:text-red-400">{entitiesError}</p>}
          {!entities && !entitiesError && <p className="p-3 text-xs text-gray-400">加载实体列表…</p>}
          {entities && filteredEntities.length === 0 && (
            <p className="p-3 text-xs text-gray-400">没有匹配的实体。</p>
          )}
          <ul>
            {filteredEntities.map((e) => (
              <li key={e.MetadataId}>
                <button
                  onClick={() => openEntity(e)}
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                    activeLogicalName === e.LogicalName
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                  title={e.LogicalName}
                >
                  {labelOf(e.DisplayName, e.LogicalName)}
                  <span className="ml-1 text-xs text-gray-400">({e.LogicalName})</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {openEntities.length > 0 && (
          <div className="mb-2 flex items-center gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
            {openEntities.map((e) => (
              <div
                key={e.LogicalName}
                className={`group flex shrink-0 items-center gap-1 rounded-t-md border-b-2 px-2.5 py-1.5 text-xs ${
                  activeLogicalName === e.LogicalName
                    ? "border-blue-600 font-medium text-blue-700 dark:text-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                <button
                  onClick={() => setActiveLogicalName(e.LogicalName)}
                  className="max-w-[9rem] truncate"
                  title={e.LogicalName}
                >
                  {labelOf(e.DisplayName, e.LogicalName)}
                </button>
                <button
                  onClick={(ev) => closeEntityTab(e.LogicalName, ev)}
                  className="rounded px-1 text-gray-400 opacity-0 hover:bg-gray-200 hover:text-gray-700 group-hover:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  title="关闭"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {!selectedEntity ? (
          <p className="text-sm text-gray-400">
            从左侧选一个实体{openEntities.length > 0 ? "，或点击上方标签页切换。" : "。"}
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {labelOf(selectedEntity.DisplayName, selectedEntity.LogicalName)}
              </h2>
              <button
                onClick={() => copyText("entity-logicalname", selectedEntity.LogicalName)}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {copiedKey === "entity-logicalname" ? "已复制" : selectedEntity.LogicalName}
              </button>
              <span className="text-xs text-gray-400">EntitySetName: {selectedEntity.EntitySetName}</span>
            </div>

            <div className="mb-3 flex gap-1 border-b border-gray-200 dark:border-gray-800">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => selectTab(tab)}
                  className={`px-3 py-1.5 text-sm ${
                    activeTab === tab
                      ? "border-b-2 border-blue-600 font-medium text-blue-700 dark:text-blue-400"
                      : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="过滤当前列表…"
              value={rowFilter}
              onChange={(e) => setRowFilter(e.target.value)}
              className="mb-2 w-full max-w-sm rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
              {tabError && <p className="p-3 text-xs text-red-600 dark:text-red-400">{tabError}</p>}
              {tabLoading && <p className="p-3 text-xs text-gray-400">加载中…</p>}
              {!tabLoading && filteredRows && filteredRows.length === 0 && (
                <p className="p-3 text-xs text-gray-400">没有数据。</p>
              )}
              {!tabLoading && filteredRows && filteredRows.length > 0 && (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    {activeTab === "attributes" ? (
                      <tr>
                        <th className="px-3 py-2">Logical Name</th>
                        <th className="px-3 py-2">显示名</th>
                        <th className="px-3 py-2">类型</th>
                        <th className="px-3 py-2">必填</th>
                        <th className="px-3 py-2">自定义</th>
                      </tr>
                    ) : (
                      <tr>
                        <th className="px-3 py-2">Schema Name</th>
                        <th className="px-3 py-2">详情</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const rowKey =
                        (row as { MetadataId: string }).MetadataId ?? JSON.stringify(row).slice(0, 40);
                      const cellCls =
                        "cursor-pointer px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800";
                      const relationshipDetail =
                        activeTab === "attributes"
                          ? ""
                          : activeTab === "manyToMany"
                            ? `${(row as RelationshipSummary).Entity1LogicalName} ↔ ${(row as RelationshipSummary).Entity2LogicalName}`
                            : `${(row as RelationshipSummary).ReferencingEntity}.${(row as RelationshipSummary).ReferencingAttribute} → ${(row as RelationshipSummary).ReferencedEntity}`;
                      return (
                        <tr key={rowKey} className="border-t border-gray-100 dark:border-gray-800">
                          {activeTab === "attributes" ? (
                            <>
                              <td
                                onClick={() => copyText(`ln-${rowKey}`, (row as AttributeSummary).LogicalName)}
                                className={`${cellCls} font-mono text-xs`}
                                title="点击复制 Logical Name"
                              >
                                {copiedKey === `ln-${rowKey}` ? "已复制" : (row as AttributeSummary).LogicalName}
                                {(row as AttributeSummary).IsPrimaryId && (
                                  <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800">
                                    PK
                                  </span>
                                )}
                              </td>
                              <td
                                onClick={() => copyText(`dn-${rowKey}`, labelOf((row as AttributeSummary).DisplayName, ""))}
                                className={cellCls}
                                title="点击复制显示名"
                              >
                                {copiedKey === `dn-${rowKey}` ? "已复制" : labelOf((row as AttributeSummary).DisplayName, "")}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">
                                {(row as AttributeSummary).AttributeType}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">
                                {(row as AttributeSummary).RequiredLevel?.Value ?? ""}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">
                                {(row as AttributeSummary).IsCustomAttribute ? "是" : ""}
                              </td>
                            </>
                          ) : (
                            <>
                              <td
                                onClick={() => copyText(`sn-${rowKey}`, (row as RelationshipSummary).SchemaName)}
                                className={`${cellCls} font-mono text-xs`}
                                title="点击复制 Schema Name"
                              >
                                {copiedKey === `sn-${rowKey}` ? "已复制" : (row as RelationshipSummary).SchemaName}
                              </td>
                              <td
                                onClick={() => copyText(`detail-${rowKey}`, relationshipDetail)}
                                className={`${cellCls} text-xs text-gray-500`}
                                title="点击复制详情"
                              >
                                {copiedKey === `detail-${rowKey}` ? "已复制" : relationshipDetail}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
