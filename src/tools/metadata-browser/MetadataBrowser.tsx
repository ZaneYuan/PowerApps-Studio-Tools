import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import {
  fetchOptionSetValuesForType,
  isLookupAttributeType,
  isOptionSetAttributeType,
  type OptionSetValue,
} from "../../native/metadataService";
import { buildLookupRelationshipMap, type RelationshipMeta } from "../../native/navProperty";
import ColumnFilterPopover, { type ColumnFilter } from "./ColumnFilterPopover";
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
  return (
    "LogicalName,SchemaName,DisplayName,AttributeType,RequiredLevel,IsCustomAttribute,IsPrimaryId,MetadataId," +
    "Description,AttributeOf,IsValidForCreate,IsValidForUpdate,IsValidForRead,IsFilterable,IsSearchable"
  );
}

function relationshipSelect(tab: Exclude<TabKey, "attributes">) {
  if (tab === "manyToMany") {
    return "SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName,MetadataId";
  }
  return "SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedEntity,ReferencedAttribute,MetadataId";
}

/** One label/value line in the attribute detail panel — skipped entirely when empty, so callers
 *  don't need their own conditionals for e.g. an empty Description. */
function PanelField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="truncate text-right text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

function PanelBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] ${
        on
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
      }`}
    >
      {label}
    </span>
  );
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

  // Row-click "expand full JSON below" is disabled for now — commented out rather than deleted
  // in case it comes back.
  // const [expanded, setExpanded] = useState<{ key: string; data: unknown } | null>(null);
  // const [expandLoading, setExpandLoading] = useState<string | null>(null);

  // Clicking an attribute row opens a right-side detail panel for that field (basic metadata for
  // every type, plus a type-specific block below it — see the render section). `optionValues`
  // only ever gets populated for Picklist/State/Status/MultiSelectPicklist rows (fetched lazily,
  // same as before this was folded into the generic row-click panel).
  const [attributePanel, setAttributePanel] = useState<AttributeSummary | null>(null);
  const [optionValues, setOptionValues] = useState<{
    attributeLogicalName: string;
    loading: boolean;
    error: string | null;
    options: OptionSetValue[] | null;
  } | null>(null);

  // Lookup/Customer/Owner attributes don't carry their target entity on AttributeMetadata itself —
  // it only shows up on ManyToOneRelationships. Resolved once per entity (via the same cached
  // buildLookupRelationshipMap FetchXML Builder's LookupPickerModal already uses) as soon as the
  // Attributes tab is viewed, so both the "类型" column and the detail panel can read it
  // synchronously off this map instead of each firing their own request.
  const [lookupTargetsByEntity, setLookupTargetsByEntity] = useState<Record<string, Map<string, RelationshipMeta[]>>>({});

  // "类型" column's Filter by state — keyed by entity like rowFilterByEntity above (not by tab:
  // there's only one filterable column today, and it only applies to the attributes tab anyway).
  const [typeFilterByEntity, setTypeFilterByEntity] = useState<Record<string, ColumnFilter | null>>({});

  const [entityListWidth, setEntityListWidth] = useState(288);

  function handleResizeStart(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = entityListWidth;
    function onMove(ev: MouseEvent) {
      setEntityListWidth(Math.min(720, Math.max(240, startWidth + (ev.clientX - startX))));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

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
    setTypeFilterByEntity({});
    setLookupTargetsByEntity({});
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

  function closeEntityTab(logicalName: string, e: ReactMouseEvent) {
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

  const typeFilter = (activeLogicalName && typeFilterByEntity[activeLogicalName]) || null;

  function applyTypeFilter(filter: ColumnFilter) {
    if (!activeLogicalName) return;
    setTypeFilterByEntity((prev) => ({ ...prev, [activeLogicalName]: filter }));
  }

  function clearTypeFilter() {
    if (!activeLogicalName) return;
    setTypeFilterByEntity((prev) => ({ ...prev, [activeLogicalName]: null }));
  }

  // The detail panel shows one attribute's metadata for the currently open entity — stale once
  // either changes, so close it instead of leaving it displaying the wrong field's data.
  useEffect(() => {
    setAttributePanel(null);
  }, [activeLogicalName, activeTab]);

  // Clicking a row while dragging a text selection still fires a trailing `click` on mouseup —
  // this is what stops that click from also popping the detail panel open, which would fight
  // with the 8/17 change (MetadataBrowser: ... removed per-cell click-to-copy in favor of normal
  // text selection) that made cell text drag-selectable in the first place.
  function handleRowClick(row: AttributeSummary) {
    if (window.getSelection()?.toString()) return;
    setAttributePanel(row);
  }

  // Only Picklist/State/Status/MultiSelectPicklist rows need this extra fetch — everything else
  // the panel shows (base metadata, Lookup targets) is already in hand synchronously.
  useEffect(() => {
    setOptionValues(null);
    if (!attributePanel || !activeConnectionId || !selectedEntity || !isOptionSetAttributeType(attributePanel.AttributeType)) {
      return;
    }
    const row = attributePanel;
    let cancelled = false;
    setOptionValues({ attributeLogicalName: row.LogicalName, loading: true, error: null, options: null });
    fetchOptionSetValuesForType(activeConnectionId, selectedEntity.LogicalName, row.LogicalName, row.AttributeType)
      .then((options) => {
        if (!cancelled) setOptionValues((p) => (p && p.attributeLogicalName === row.LogicalName ? { ...p, options, loading: false } : p));
      })
      .catch((err) => {
        if (!cancelled) {
          setOptionValues((p) =>
            p && p.attributeLogicalName === row.LogicalName
              ? { ...p, error: err instanceof Error ? err.message : String(err), loading: false }
              : p,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attributePanel, activeConnectionId, selectedEntity]);

  // Resolves Lookup/Customer/Owner target entities for the whole entity at once (not per-row) as
  // soon as the Attributes tab is viewed — both the "类型" column and the detail panel read off
  // this map synchronously. buildLookupRelationshipMap has its own connection+entity cache, so
  // switching back to an already-visited entity is instant.
  useEffect(() => {
    if (!activeConnectionId || !selectedEntity || activeTab !== "attributes" || lookupTargetsByEntity[selectedEntity.LogicalName]) {
      return;
    }
    let cancelled = false;
    const entityLogicalName = selectedEntity.LogicalName;
    buildLookupRelationshipMap(activeConnectionId, entityLogicalName).then((map) => {
      if (!cancelled) setLookupTargetsByEntity((prev) => ({ ...prev, [entityLogicalName]: map }));
    });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, selectedEntity, activeTab, lookupTargetsByEntity]);

  /** "Lookup" / "Owner — systemuser / team" for the "类型" column — falls back to the bare type
   *  name until the entity's lookup relationship map (above) has loaded. */
  function typeCellText(row: AttributeSummary): string {
    if (!isLookupAttributeType(row.AttributeType) || !selectedEntity) return row.AttributeType;
    const rels = lookupTargetsByEntity[selectedEntity.LogicalName]?.get(row.LogicalName.toLowerCase());
    if (!rels || rels.length === 0) return row.AttributeType;
    const targets = [...new Set(rels.map((r) => r.ReferencedEntity))].sort();
    return `${row.AttributeType} — ${targets.join(" / ")}`;
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

  const currentRows = selectedEntity ? (tabCache[`${selectedEntity.LogicalName}:${activeTab}`] ?? null) : null;

  // Distinct values for the "类型" column's Filter by popover — read off the full unfiltered
  // row set (like D365's own choice-column filter does), not the already-filtered rows, so the
  // dropdown doesn't shrink as soon as a filter narrows the grid.
  const typeDistinctValues = useMemo(() => {
    if (!currentRows || activeTab !== "attributes") return [];
    return [...new Set((currentRows as AttributeSummary[]).map((r) => r.AttributeType))].sort();
  }, [currentRows, activeTab]);

  const filteredRows = useMemo(() => {
    if (!currentRows) return null;
    let rows = currentRows;
    const q = rowFilter.trim().toLowerCase();
    if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    if (activeTab === "attributes" && typeFilter?.value) {
      rows = rows.filter((r) => {
        const type = (r as AttributeSummary).AttributeType;
        return typeFilter.operator === "equals" ? type === typeFilter.value : type.toLowerCase().includes(typeFilter.value.toLowerCase());
      });
    }
    return rows;
  }, [currentRows, rowFilter, activeTab, typeFilter]);

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
        请先在左侧侧边栏顶部选择一个"我的连接"（没有连接的话先去"我的连接"里添加）。
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      <div
        className="flex shrink-0 flex-col rounded-lg border border-gray-200 dark:border-gray-800"
        style={{ width: entityListWidth }}
      >
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

      <div
        onMouseDown={handleResizeStart}
        className="mx-1 w-1.5 shrink-0 cursor-col-resize rounded hover:bg-blue-200 dark:hover:bg-blue-900/40"
        title="拖动调整宽度"
      />

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
                  aria-label={`关闭 ${labelOf(e.DisplayName, e.LogicalName)}`}
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
              <span className="rounded border border-gray-300 px-2 py-0.5 font-mono text-xs text-gray-600 dark:border-gray-600 dark:text-gray-300">
                {selectedEntity.LogicalName}
              </span>
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
                        <th className="px-3 py-2">
                          类型
                          <ColumnFilterPopover
                            label="类型"
                            distinctValues={typeDistinctValues}
                            filter={typeFilter}
                            onApply={applyTypeFilter}
                            onClear={clearTypeFilter}
                          />
                        </th>
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
                      const relationshipDetail =
                        activeTab === "attributes"
                          ? ""
                          : activeTab === "manyToMany"
                            ? `${(row as RelationshipSummary).Entity1LogicalName} ↔ ${(row as RelationshipSummary).Entity2LogicalName}`
                            : `${(row as RelationshipSummary).ReferencingEntity}.${(row as RelationshipSummary).ReferencingAttribute} → ${(row as RelationshipSummary).ReferencedEntity}`;
                      const isAttributeRow = activeTab === "attributes";
                      return (
                        <tr
                          key={rowKey}
                          onClick={isAttributeRow ? () => handleRowClick(row as AttributeSummary) : undefined}
                          className={`border-t border-gray-100 dark:border-gray-800 ${
                            isAttributeRow ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/40" : ""
                          }`}
                        >
                          {isAttributeRow ? (
                            <>
                              <td className="px-3 py-1.5 font-mono text-xs text-gray-900 dark:text-gray-100">
                                {(row as AttributeSummary).LogicalName}
                                {(row as AttributeSummary).IsPrimaryId && (
                                  <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800">
                                    PK
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100">
                                {labelOf((row as AttributeSummary).DisplayName, "")}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">{typeCellText(row as AttributeSummary)}</td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">
                                {(row as AttributeSummary).RequiredLevel?.Value ?? ""}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">
                                {(row as AttributeSummary).IsCustomAttribute ? "是" : ""}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-1.5 font-mono text-xs text-gray-900 dark:text-gray-100">
                                {(row as RelationshipSummary).SchemaName}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">{relationshipDetail}</td>
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

      {attributePanel && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-96 max-w-full flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between border-b border-gray-200 p-3 dark:border-gray-800">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                {labelOf(attributePanel.DisplayName, attributePanel.LogicalName)}
              </div>
              <div className="truncate font-mono text-xs text-gray-400">{attributePanel.LogicalName}</div>
            </div>
            <button onClick={() => setAttributePanel(null)} className="shrink-0 text-xs text-gray-400 hover:text-red-500">
              ✕ 关闭
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="mb-3 space-y-1">
              <PanelField label="Schema Name" value={attributePanel.SchemaName} />
              <PanelField label="类型" value={attributePanel.AttributeType} />
              <PanelField label="必填级别" value={attributePanel.RequiredLevel?.Value ?? "None"} />
              <PanelField label="自定义字段" value={attributePanel.IsCustomAttribute ? "是" : "否"} />
              <PanelField label="主键" value={attributePanel.IsPrimaryId ? "是" : "否"} />
              {attributePanel.AttributeOf && <PanelField label="复合字段归属" value={`"${attributePanel.AttributeOf}" 的子字段`} />}
              <PanelField label="Description" value={labelOf(attributePanel.Description, "")} />
            </div>

            <div className="mb-4 flex flex-wrap gap-1.5">
              <PanelBadge on={attributePanel.IsValidForCreate} label="可创建" />
              <PanelBadge on={attributePanel.IsValidForUpdate} label="可更新" />
              <PanelBadge on={attributePanel.IsValidForRead} label="可读" />
              <PanelBadge on={attributePanel.IsFilterable} label="可筛选（高级查找）" />
              <PanelBadge on={attributePanel.IsSearchable} label="快速查找可搜索" />
            </div>

            {isLookupAttributeType(attributePanel.AttributeType) &&
              selectedEntity &&
              (() => {
                const map = lookupTargetsByEntity[selectedEntity.LogicalName];
                const targets = map ? [...new Set((map.get(attributePanel.LogicalName.toLowerCase()) ?? []).map((r) => r.ReferencedEntity))].sort() : null;
                return (
                  <div>
                    <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">目标表</div>
                    {!map && <p className="text-xs text-gray-400">解析查找关系元数据中…</p>}
                    {map && targets && targets.length === 0 && (
                      <p className="text-xs text-gray-400">没有找到对应的查找关系元数据。</p>
                    )}
                    {targets && targets.length > 0 && (
                      <ul className="space-y-1">
                        {targets.map((t) => (
                          <li
                            key={t}
                            className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                          >
                            {t}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}

            {isOptionSetAttributeType(attributePanel.AttributeType) && (
              <div>
                <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">选项</div>
                {optionValues?.loading && <p className="text-xs text-gray-400">加载选项中…</p>}
                {optionValues?.error && <p className="text-sm text-red-600 dark:text-red-400">{optionValues.error}</p>}
                {optionValues?.options && optionValues.options.length === 0 && (
                  <p className="text-xs text-gray-400">这个字段没有选项。</p>
                )}
                {optionValues?.options && optionValues.options.length > 0 && (
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-1.5">Value</th>
                        <th className="px-2 py-1.5">Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionValues.options.map((o) => (
                        <tr key={o.value} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="px-2 py-1.5 font-mono text-xs text-gray-900 dark:text-gray-100">{o.value}</td>
                          <td className="px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100">{o.label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
