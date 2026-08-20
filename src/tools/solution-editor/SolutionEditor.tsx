import { useEffect, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { fetchEntityFields, fetchSolutionComponents, fetchSolutions, publishAll } from "./dataverseOps";
import AddExistingTableDialog from "./AddExistingTableDialog";
import NewColumnDialog from "./NewColumnDialog";
import NewSolutionDialog from "./NewSolutionDialog";
import NewTableDialog from "./NewTableDialog";
import { COMPONENT_TYPE_LABELS, ENTITY_COMPONENT_TYPE, type ColumnFieldMeta, type SolutionComponentRow, type SolutionSummary } from "./types";

const rowBase = "flex w-full items-center gap-1.5 truncate px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";
const rowSelected = "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400";

export default function SolutionEditor() {
  const { activeConnectionId } = useActiveConnection();

  const [solutions, setSolutions] = useState<SolutionSummary[] | null>(null);
  const [solutionsError, setSolutionsError] = useState<string | null>(null);
  const [showNewSolution, setShowNewSolution] = useState(false);

  const [selected, setSelected] = useState<SolutionSummary | null>(null);
  const [components, setComponents] = useState<SolutionComponentRow[] | null>(null);
  const [componentsError, setComponentsError] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<number>>(new Set());
  const [selectedComponent, setSelectedComponent] = useState<SolutionComponentRow | null>(null);

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
    setSelectedComponent(null);
    setEntityFields(null);
    setExpandedTypes(new Set([ENTITY_COMPONENT_TYPE]));
    loadComponents(s.solutionid);
  }

  function backToList() {
    setSelected(null);
    setComponents(null);
    setSelectedComponent(null);
    setEntityFields(null);
    setPublishDone(false);
    loadSolutions();
  }

  function selectComponent(c: SolutionComponentRow) {
    setSelectedComponent(c);
    setEntityFields(null);
    setEntityFieldsError(null);
    if (c.componenttype === ENTITY_COMPONENT_TYPE && c.logicalName && activeConnectionId) {
      fetchEntityFields(activeConnectionId, c.logicalName)
        .then(setEntityFields)
        .catch((err) => setEntityFieldsError(err instanceof Error ? err.message : String(err)));
    }
  }

  function reloadEntityFields() {
    if (!activeConnectionId || !selectedComponent?.logicalName) return;
    fetchEntityFields(activeConnectionId, selectedComponent.logicalName)
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

  function toggleType(type: number) {
    setExpandedTypes((s) => {
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
  const grouped = new Map<number, SolutionComponentRow[]>();
  for (const c of components ?? []) {
    const list = grouped.get(c.componenttype) ?? [];
    list.push(c);
    grouped.set(c.componenttype, list);
  }
  const groupTypes = [...grouped.keys()].sort((a, b) => (COMPONENT_TYPE_LABELS[a] ?? "").localeCompare(COMPONENT_TYPE_LABELS[b] ?? ""));

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
            {groupTypes.map((type) => {
              const items = grouped.get(type)!;
              const open = expandedTypes.has(type);
              return (
                <li key={type}>
                  <button onClick={() => toggleType(type)} className={rowBase}>
                    <span className="inline-block w-3 shrink-0 text-gray-400">{open ? "▾" : "▸"}</span>
                    <span className="flex-1 truncate">{COMPONENT_TYPE_LABELS[type] ?? `类型 ${type}`}</span>
                    <span className="shrink-0 text-xs text-gray-400">{items.length}</span>
                  </button>
                  {open && (
                    <ul className="ml-4 border-l border-gray-100 pl-2 dark:border-gray-800">
                      {items.map((c) => (
                        <li key={c.solutioncomponentid}>
                          <button
                            onClick={() => selectComponent(c)}
                            className={`${rowBase} ${selectedComponent?.solutioncomponentid === c.solutioncomponentid ? rowSelected : ""}`}
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
          {!selectedComponent && <p className="text-sm text-gray-400">从左侧选一个组件查看详情。</p>}
          {selectedComponent && selectedComponent.componenttype !== ENTITY_COMPONENT_TYPE && (
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <p className="font-medium">{selectedComponent.name ?? "(无法解析名称)"}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {COMPONENT_TYPE_LABELS[selectedComponent.componenttype] ?? `类型 ${selectedComponent.componenttype}`}
              </p>
              <p className="mt-1 font-mono text-xs text-gray-400">{selectedComponent.objectid}</p>
            </div>
          )}
          {selectedComponent && selectedComponent.componenttype === ENTITY_COMPONENT_TYPE && (
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {selectedComponent.name} <span className="font-mono text-xs text-gray-400">({selectedComponent.logicalName})</span>
                </h3>
                <button
                  onClick={() => setShowNewColumn(true)}
                  disabled={!selectedComponent.logicalName}
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
      {showNewColumn && selectedComponent?.logicalName && (
        <NewColumnDialog
          connectionId={activeConnectionId}
          solutionUniqueName={selected.uniquename}
          entityLogicalName={selectedComponent.logicalName}
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
