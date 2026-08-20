import { useEffect, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { fetchEntityBasicInfo, fetchEntityFields, fetchSolutionComponents, fetchSolutions, publishAll } from "./dataverseOps";
import AddExistingTableDialog from "./AddExistingTableDialog";
import NewColumnDialog from "./NewColumnDialog";
import NewSolutionDialog from "./NewSolutionDialog";
import NewTableDialog from "./NewTableDialog";
import {
  COMPONENT_TYPE_LABELS,
  ENTITY_COMPONENT_TYPE,
  ENTITY_SUBCOMPONENT_TYPES,
  type ColumnFieldMeta,
  type EntityBasicInfo,
  type SolutionComponentRow,
  type SolutionSummary,
} from "./types";

const rowBase = "flex w-full items-center gap-1.5 truncate px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";
const rowSelected = "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400";

/** Which node in the component tree is currently shown in the right-hand detail pane — an Entity
 *  node itself shows basic table properties (make.powerapps' "Table properties" card), its nested
 *  "字段" child shows the live column list (make.powerapps' "Columns" page), everything else falls
 *  back to a generic name/type/GUID view. Kept as one discriminated union (not two separate
 *  "selected entity" / "selected other" states) so exactly one thing is ever selected at a time. */
type SelectedNode =
  | { kind: "entity"; component: SolutionComponentRow }
  | { kind: "entity-columns"; component: SolutionComponentRow }
  | { kind: "other"; component: SolutionComponentRow };

export default function SolutionEditor() {
  const { activeConnectionId } = useActiveConnection();

  const [solutions, setSolutions] = useState<SolutionSummary[] | null>(null);
  const [solutionsError, setSolutionsError] = useState<string | null>(null);
  const [showNewSolution, setShowNewSolution] = useState(false);

  const [selected, setSelected] = useState<SolutionSummary | null>(null);
  const [components, setComponents] = useState<SolutionComponentRow[] | null>(null);
  const [componentsError, setComponentsError] = useState<string | null>(null);
  const [tablesGroupOpen, setTablesGroupOpen] = useState(true);
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
  const [expandedOtherTypes, setExpandedOtherTypes] = useState<Set<number>>(new Set());
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  const [entityBasicInfo, setEntityBasicInfo] = useState<EntityBasicInfo | null>(null);
  const [entityBasicInfoError, setEntityBasicInfoError] = useState<string | null>(null);
  const [entityFields, setEntityFields] = useState<ColumnFieldMeta[] | null>(null);
  const [entityFieldsError, setEntityFieldsError] = useState<string | null>(null);

  const [showNewTable, setShowNewTable] = useState(false);
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [showNewColumn, setShowNewColumn] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishDone, setPublishDone] = useState(false);

  function loadSolutions() {
    if (!activeConnectionId) return;
    setSolutions(null);
    setSolutionsError(null);
    fetchSolutions(activeConnectionId)
      .then(setSolutions)
      .catch((err) => setSolutionsError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(() => {
    loadSolutions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  function loadComponents(solutionId: string) {
    if (!activeConnectionId) return;
    setComponents(null);
    setComponentsError(null);
    fetchSolutionComponents(activeConnectionId, solutionId)
      .then(setComponents)
      .catch((err) => setComponentsError(err instanceof Error ? err.message : String(err)));
  }

  function openSolution(s: SolutionSummary) {
    if (s.ismanaged) return; // read-only in v1 — nothing to edit on a managed solution
    setSelected(s);
    setSelectedNode(null);
    setTablesGroupOpen(true);
    setExpandedEntities(new Set());
    setExpandedOtherTypes(new Set());
    loadComponents(s.solutionid);
  }

  function backToList() {
    setSelected(null);
    setComponents(null);
    setSelectedNode(null);
    setPublishDone(false);
    loadSolutions();
  }

  function selectEntity(c: SolutionComponentRow) {
    setSelectedNode({ kind: "entity", component: c });
    setEntityBasicInfo(null);
    setEntityBasicInfoError(null);
    if (c.logicalName && activeConnectionId) {
      fetchEntityBasicInfo(activeConnectionId, c.logicalName)
        .then(setEntityBasicInfo)
        .catch((err) => setEntityBasicInfoError(err instanceof Error ? err.message : String(err)));
    }
  }

  function selectEntityColumns(c: SolutionComponentRow) {
    setSelectedNode({ kind: "entity-columns", component: c });
    setEntityFields(null);
    setEntityFieldsError(null);
    if (c.logicalName && activeConnectionId) {
      fetchEntityFields(activeConnectionId, c.logicalName)
        .then(setEntityFields)
        .catch((err) => setEntityFieldsError(err instanceof Error ? err.message : String(err)));
    }
  }

  function reloadEntityFields() {
    if (!activeConnectionId || selectedNode?.kind !== "entity-columns" || !selectedNode.component.logicalName) return;
    fetchEntityFields(activeConnectionId, selectedNode.component.logicalName)
      .then(setEntityFields)
      .catch((err) => setEntityFieldsError(err instanceof Error ? err.message : String(err)));
  }

  async function handlePublish() {
    if (!activeConnectionId) return;
    setPublishing(true);
    setPublishError(null);
    setPublishDone(false);
    try {
      await publishAll(activeConnectionId);
      setPublishDone(true);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  function toggleEntity(id: string) {
    setExpandedEntities((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleOtherType(type: number) {
    setExpandedOtherTypes((s) => {
      const next = new Set(s);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }
  if (!activeConnectionId) {
    return <p className="text-sm text-gray-400">请先在侧边栏选择一个本页连接。</p>;
  }

  // ---- List view ----
  if (!selected) {
    return (
      <div className="max-w-5xl space-y-4">
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
          雏形版本：查看/新建 solution，进入一个 unmanaged solution 后可以浏览组件、添加已有表、新建表、新建 8
          种基础类型的字段、发布。不支持查找字段、全局选项集、拖拽式画布——参考 UI 取的是 make.powerapps
          的"列表 → 详情 → 组件树"结构，不是像素级复刻。Managed solution 只能查看，不能编辑。
        </div>

        <div className="flex items-center gap-2">
          <button onClick={loadSolutions} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
            刷新
          </button>
          <button onClick={() => setShowNewSolution(true)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            + 新建 Solution
          </button>
        </div>

        {solutionsError && (
          <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
            {solutionsError}
          </pre>
        )}
        {!solutions && !solutionsError && <p className="text-sm text-gray-400">加载中…</p>}

        {solutions && (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2">显示名称</th>
                  <th className="px-3 py-2">唯一名称</th>
                  <th className="px-3 py-2">版本</th>
                  <th className="px-3 py-2">Publisher</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {solutions.map((s) => (
                  <tr
                    key={s.solutionid}
                    onClick={() => openSolution(s)}
                    className={`border-t border-gray-100 dark:border-gray-800 ${s.ismanaged ? "opacity-60" : "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                  >
                    <td className="px-3 py-2 font-medium">{s.friendlyname}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.uniquename}</td>
                    <td className="px-3 py-2 text-xs">{s.version}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.publisherName} ({s.publisherPrefix})
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.ismanaged && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-800">Managed · 只读</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showNewSolution && (
          <NewSolutionDialog
            connectionId={activeConnectionId}
            onClose={() => setShowNewSolution(false)}
            onCreated={() => {
              setShowNewSolution(false);
              loadSolutions();
            }}
          />
        )}
      </div>
    );
  }

  // ---- Detail view ----
  // Entity(1) rows become their own "表" group (each with a nested "字段" child that live-fetches
  // the table's full column list); everything in ENTITY_SUBCOMPONENT_TYPES (a field/relationship
  // row that's really *part of* some table) is dropped from the flat grouping entirely rather than
  // shown as an unresolvable top-level GUID — see ENTITY_SUBCOMPONENT_TYPES' doc comment in
  // types.ts for why. Every other componenttype keeps the old flat "group by type" treatment.
  const entityRows = (components ?? []).filter((c) => c.componenttype === ENTITY_COMPONENT_TYPE);
  const otherGrouped = new Map<number, SolutionComponentRow[]>();
  for (const c of components ?? []) {
    if (c.componenttype === ENTITY_COMPONENT_TYPE || ENTITY_SUBCOMPONENT_TYPES.has(c.componenttype)) continue;
    const list = otherGrouped.get(c.componenttype) ?? [];
    list.push(c);
    otherGrouped.set(c.componenttype, list);
  }
  const otherGroupTypes = [...otherGrouped.keys()].sort((a, b) => (COMPONENT_TYPE_LABELS[a] ?? "").localeCompare(COMPONENT_TYPE_LABELS[b] ?? ""));

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={backToList} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          ← 返回列表
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {publishing ? "发布中…" : "发布全部自定义"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{selected.friendlyname}</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {selected.uniquename} · v{selected.version} · {selected.publisherName} ({selected.publisherPrefix})
        </p>
        {selected.description && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{selected.description}</p>}
        {publishError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{publishError}</p>}
        {publishDone && <p className="mt-2 text-xs text-green-600 dark:text-green-400">已发布。</p>}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setShowNewTable(true)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + 新建表
        </button>
        <button
          onClick={() => setShowAddExisting(true)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          添加现有表
        </button>
      </div>

      <div className="flex gap-3">
        <div className="w-72 shrink-0 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800" style={{ maxHeight: "60vh" }}>
          {componentsError && <p className="p-2 text-xs text-red-600 dark:text-red-400">{componentsError}</p>}
          {!components && !componentsError && <p className="p-2 text-xs text-gray-400">加载中…</p>}
          {components && components.length === 0 && <p className="p-2 text-xs text-gray-400">这个 solution 还没有任何组件。</p>}
          <ul className="p-1">
            {entityRows.length > 0 && (
              <li>
                <button onClick={() => setTablesGroupOpen((v) => !v)} className={rowBase}>
                  <span className="inline-block w-3 shrink-0 text-gray-400">{tablesGroupOpen ? "▾" : "▸"}</span>
                  <span className="flex-1 truncate">表（Tables）</span>
                  <span className="shrink-0 text-xs text-gray-400">{entityRows.length}</span>
                </button>
                {tablesGroupOpen && (
                  <ul className="ml-4 border-l border-gray-100 pl-2 dark:border-gray-800">
                    {entityRows.map((c) => {
                      const eOpen = expandedEntities.has(c.solutioncomponentid);
                      const isEntitySelected = selectedNode?.kind === "entity" && selectedNode.component.solutioncomponentid === c.solutioncomponentid;
                      const isColumnsSelected =
                        selectedNode?.kind === "entity-columns" && selectedNode.component.solutioncomponentid === c.solutioncomponentid;
                      return (
                        <li key={c.solutioncomponentid}>
                          <div className={`${rowBase} ${isEntitySelected ? rowSelected : ""}`}>
                            <button onClick={() => toggleEntity(c.solutioncomponentid)}>
                              <span className="inline-block w-3 shrink-0 text-gray-400">{eOpen ? "▾" : "▸"}</span>
                            </button>
                            <button className="flex-1 truncate text-left" onClick={() => selectEntity(c)} title={c.name ?? c.objectid}>
                              🗄️ {c.name ?? c.objectid}
                            </button>
                          </div>
                          {eOpen && (
                            <ul className="ml-4 border-l border-gray-100 pl-2 dark:border-gray-800">
                              <li>
                                <button onClick={() => selectEntityColumns(c)} className={`${rowBase} ${isColumnsSelected ? rowSelected : ""}`}>
                                  <span className="inline-block w-3 shrink-0" />
                                  字段（Columns）
                                </button>
                              </li>
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            )}
            {otherGroupTypes.map((type) => {
              const items = otherGrouped.get(type)!;
              const open = expandedOtherTypes.has(type);
              return (
                <li key={type}>
                  <button onClick={() => toggleOtherType(type)} className={rowBase}>
                    <span className="inline-block w-3 shrink-0 text-gray-400">{open ? "▾" : "▸"}</span>
                    <span className="flex-1 truncate">{COMPONENT_TYPE_LABELS[type] ?? `类型 ${type}`}</span>
                    <span className="shrink-0 text-xs text-gray-400">{items.length}</span>
                  </button>
                  {open && (
                    <ul className="ml-4 border-l border-gray-100 pl-2 dark:border-gray-800">
                      {items.map((c) => (
                        <li key={c.solutioncomponentid}>
                          <button
                            onClick={() => setSelectedNode({ kind: "other", component: c })}
                            className={`${rowBase} ${
                              selectedNode?.kind === "other" && selectedNode.component.solutioncomponentid === c.solutioncomponentid ? rowSelected : ""
                            }`}
                            title={c.name ?? c.objectid}
                          >
                            {c.name ?? <span className="font-mono text-xs text-gray-400">{c.objectid}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0 flex-1 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          {!selectedNode && <p className="text-sm text-gray-400">从左侧选一个组件查看详情。</p>}

          {selectedNode?.kind === "other" && (
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <p className="font-medium">{selectedNode.component.name ?? "(无法解析名称)"}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {COMPONENT_TYPE_LABELS[selectedNode.component.componenttype] ?? `类型 ${selectedNode.component.componenttype}`}
              </p>
              <p className="mt-1 font-mono text-xs text-gray-400">{selectedNode.component.objectid}</p>
            </div>
          )}

          {selectedNode?.kind === "entity" && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                🗄️ {selectedNode.component.name} <span className="font-mono text-xs text-gray-400">({selectedNode.component.logicalName})</span>
              </h3>
              {entityBasicInfoError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{entityBasicInfoError}</p>}
              {!entityBasicInfo && !entityBasicInfoError && <p className="mt-2 text-xs text-gray-400">加载中…</p>}
              {entityBasicInfo && (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-gray-400">显示名称</dt>
                      <dd>{entityBasicInfo.displayName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">复数显示名称</dt>
                      <dd>{entityBasicInfo.displayCollectionName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">主键列（LogicalName）</dt>
                      <dd className="font-mono text-xs">{entityBasicInfo.primaryNameAttribute}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">类型</dt>
                      <dd>{entityBasicInfo.isCustomEntity ? "Custom（自定义）" : "Standard（系统内置）"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">所有权类型</dt>
                      <dd>{entityBasicInfo.ownershipType}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">EntitySetName</dt>
                      <dd className="font-mono text-xs">{entityBasicInfo.entitySetName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">最后修改</dt>
                      <dd>{entityBasicInfo.modifiedOn ? new Date(entityBasicInfo.modifiedOn).toLocaleString() : "—"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-gray-400">描述</dt>
                      <dd>{entityBasicInfo.description ?? "—"}</dd>
                    </div>
                  </dl>
                  <button
                    onClick={() => selectEntityColumns(selectedNode.component)}
                    className="mt-4 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    查看/管理字段 →
                  </button>
                </>
              )}
            </div>
          )}

          {selectedNode?.kind === "entity-columns" && (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <button onClick={() => selectEntity(selectedNode.component)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                    ← {selectedNode.component.name}
                  </button>
                  <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {selectedNode.component.name} · 字段（Columns）
                  </h3>
                </div>
                <button
                  onClick={() => setShowNewColumn(true)}
                  disabled={!selectedNode.component.logicalName}
                  className="rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                >
                  + 新建字段
                </button>
              </div>
              {entityFieldsError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{entityFieldsError}</p>}
              {!entityFields && !entityFieldsError && <p className="mt-2 text-xs text-gray-400">加载字段中…</p>}
              {entityFields && (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="py-1 pr-3">显示名称</th>
                      <th className="py-1 pr-3">LogicalName</th>
                      <th className="py-1 pr-3">类型</th>
                      <th className="py-1 pr-3">必填</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entityFields.map((f) => (
                      <tr key={f.logicalName} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3">
                          {f.displayName}
                          {f.isPrimaryName && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800">主键</span>}
                        </td>
                        <td className="py-1 pr-3 font-mono text-xs">{f.logicalName}</td>
                        <td className="py-1 pr-3 text-xs">{f.attributeType}</td>
                        <td className="py-1 pr-3 text-xs">{f.required ? "是" : "否"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {showNewTable && (
        <NewTableDialog
          connectionId={activeConnectionId}
          solutionUniqueName={selected.uniquename}
          publisherPrefix={selected.publisherPrefix}
          onClose={() => setShowNewTable(false)}
          onCreated={() => {
            setShowNewTable(false);
            loadComponents(selected.solutionid);
          }}
        />
      )}
      {showAddExisting && (
        <AddExistingTableDialog
          connectionId={activeConnectionId}
          solutionUniqueName={selected.uniquename}
          onClose={() => setShowAddExisting(false)}
          onAdded={() => {
            setShowAddExisting(false);
            loadComponents(selected.solutionid);
          }}
        />
      )}
      {showNewColumn && selectedNode?.kind === "entity-columns" && selectedNode.component.logicalName && (
        <NewColumnDialog
          connectionId={activeConnectionId}
          solutionUniqueName={selected.uniquename}
          entityLogicalName={selectedNode.component.logicalName}
          publisherPrefix={selected.publisherPrefix}
          onClose={() => setShowNewColumn(false)}
          onCreated={() => {
            setShowNewColumn(false);
            reloadEntityFields();
          }}
        />
      )}
    </div>
  );
}
