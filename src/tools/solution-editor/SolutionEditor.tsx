import { useEffect, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import {
  componentDeletePath,
  deleteColumn,
  deleteComponent,
  fetchEntityBasicInfo,
  fetchEntityFields,
  fetchSolutionComponents,
  fetchSolutions,
  publishAll,
  publishSolutionComponents,
  removeSolutionComponent,
} from "./dataverseOps";
import AddExistingComponentDialog from "./AddExistingComponentDialog";
import { ADD_EXISTING_KINDS, NEW_KINDS, type AddableComponentKind } from "./componentCatalog";
import DropdownMenuButton from "./DropdownMenuButton";
import EditColumnDialog from "./EditColumnDialog";
import EditTableDialog from "./EditTableDialog";
import NewColumnDialog from "./NewColumnDialog";
import NewSolutionDialog from "./NewSolutionDialog";
import NewTableDialog from "./NewTableDialog";
import NewWebResourceDialog from "./NewWebResourceDialog";
import WebResourceEditor from "./WebResourceEditor";
import { useConfirmDialog } from "../../shared/ConfirmDialog";
import ErrorMessage from "../../shared/ErrorMessage";
import SvgIcon from "../../shared/SvgIcon";
import {
  ATTRIBUTE_COMPONENT_TYPE,
  COMPONENT_TYPE_LABELS,
  ENTITY_COMPONENT_TYPE,
  ENTITY_SUBCOMPONENT_TYPES,
  SYSTEM_FORM_COMPONENT_TYPE,
  WEB_RESOURCE_COMPONENT_TYPE,
  type ColumnFieldMeta,
  type EntityBasicInfo,
  type SolutionComponentRow,
  type SolutionSummary,
} from "./types";

const rowBase = "flex w-full items-center gap-1.5 truncate px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";
const rowSelected = "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400";

/** A table added with "Include Subcomponents" carries every field implicitly — no field of it has
 *  its own Attribute(2) row, so fields can't be individually added to or removed from the solution. */
function includesAllSubcomponents(entityRow: SolutionComponentRow): boolean {
  return entityRow.rootComponentBehavior === undefined || entityRow.rootComponentBehavior === 0;
}

const REMOVE_MENU_BUTTON =
  "rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20";
const SECONDARY_BUTTON =
  "rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800";

/** Scopes a table's full live field list down to what's actually part of this solution — an
 *  unfiltered EntityDefinitions/Attributes query returns every field the table has, standard OOB
 *  fields included, regardless of what the solution actually added (Bugs/8.25.md #4). `undefined`/
 *  0 `rootComponentBehavior` ("Include Subcomponents", or unknown) keeps every field — the old,
 *  always-on behavior, and also the only correct answer for that case since Dataverse doesn't
 *  create an individual Attribute(2) solutioncomponent row per field when subcomponents are
 *  included wholesale. 1/2 ("Do Not Include Subcomponents" / "Include As Shell Only") filters down
 *  to fields with their own Attribute(2) row, plus the primary name column (not separately
 *  addable/removable from a solution, so it wouldn't have its own row either way). */
function scopeEntityFields(fields: ColumnFieldMeta[], entityRow: SolutionComponentRow, allComponents: SolutionComponentRow[]): ColumnFieldMeta[] {
  if (includesAllSubcomponents(entityRow)) return fields;
  const includedIds = new Set(
    allComponents.filter((c) => c.componenttype === ATTRIBUTE_COMPONENT_TYPE).map((c) => c.objectid.toLowerCase()),
  );
  return fields.filter((f) => f.isPrimaryName || includedIds.has(f.metadataId.toLowerCase()));
}

/** Which node in the component tree is currently shown in the right-hand detail pane — an Entity
 *  node itself shows basic table properties (make.powerapps' "Table properties" card), its nested
 *  "字段" child shows the live column list (make.powerapps' "Columns" page), everything else falls
 *  back to a generic name/type/GUID view. Kept as one discriminated union (not two separate
 *  "selected entity" / "selected other" states) so exactly one thing is ever selected at a time. */
type SelectedNode =
  | { kind: "entity"; component: SolutionComponentRow }
  | { kind: "entity-columns"; component: SolutionComponentRow }
  | { kind: "other"; component: SolutionComponentRow };

type SolutionFilter = "unmanaged" | "managed" | "all";

const SOLUTION_FILTERS: { key: SolutionFilter; label: string }[] = [
  { key: "unmanaged", label: "非托管" },
  { key: "managed", label: "托管" },
  { key: "all", label: "全部" },
];

export default function SolutionEditor() {
  const { activeConnectionId } = useActiveConnection();

  const [solutions, setSolutions] = useState<SolutionSummary[] | null>(null);
  const [solutionsError, setSolutionsError] = useState<string | null>(null);
  const [showNewSolution, setShowNewSolution] = useState(false);
  const [solutionFilter, setSolutionFilter] = useState<SolutionFilter>("unmanaged");

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
  const [showNewWebResource, setShowNewWebResource] = useState(false);
  const [addExistingKind, setAddExistingKind] = useState<AddableComponentKind | null>(null);
  const [showNewColumn, setShowNewColumn] = useState(false);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [showEditTable, setShowEditTable] = useState(false);

  const confirm = useConfirmDialog();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
    setActionError(null);
    setEntityBasicInfo(null);
    setEntityBasicInfoError(null);
    if (c.logicalName && activeConnectionId) {
      fetchEntityBasicInfo(activeConnectionId, c.logicalName)
        .then(setEntityBasicInfo)
        .catch((err) => setEntityBasicInfoError(err instanceof Error ? err.message : String(err)));
    }
  }

  function selectOther(c: SolutionComponentRow) {
    setSelectedNode({ kind: "other", component: c });
    setActionError(null);
  }

  function selectEntityColumns(c: SolutionComponentRow, allComponents: SolutionComponentRow[] | null = components) {
    setSelectedNode({ kind: "entity-columns", component: c });
    setActionError(null);
    setEntityFields(null);
    setEntityFieldsError(null);
    if (c.logicalName && activeConnectionId) {
      fetchEntityFields(activeConnectionId, c.logicalName)
        .then((fields) => setEntityFields(scopeEntityFields(fields, c, allComponents ?? [])))
        .catch((err) => setEntityFieldsError(err instanceof Error ? err.message : String(err)));
    }
  }

  /** Re-shows the entity-columns panel after a column is created/added/removed — re-fetches
   *  solutioncomponents first (not just the field list) so scopeEntityFields judges each field
   *  against its current Attribute(2) rows rather than the stale pre-change `components` snapshot. */
  function reloadEntityColumns() {
    if (!activeConnectionId || !selected || selectedNode?.kind !== "entity-columns") return;
    const component = selectedNode.component;
    fetchSolutionComponents(activeConnectionId, selected.solutionid)
      .then((freshComponents) => {
        setComponents(freshComponents);
        selectEntityColumns(component, freshComponents);
      })
      .catch((err) => setComponentsError(err instanceof Error ? err.message : String(err)));
  }

  /** Reloads the tree after a table edit so both the tree label and the panel header pick up the
   *  new display name, then re-selects that same table. */
  function reloadAndReselectEntity(solutionComponentId: string) {
    if (!activeConnectionId || !selected) return;
    fetchSolutionComponents(activeConnectionId, selected.solutionid)
      .then((freshComponents) => {
        setComponents(freshComponents);
        const row = freshComponents.find((c) => c.solutioncomponentid === solutionComponentId);
        if (row) selectEntity(row);
      })
      .catch((err) => setComponentsError(err instanceof Error ? err.message : String(err)));
  }

  async function runAction(action: () => Promise<void>, onDone: () => void) {
    setActionBusy(true);
    setActionError(null);
    try {
      await action();
      onDone();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleComponentAction(c: SolutionComponentRow, action: string) {
    if (!activeConnectionId || !selected) return;
    const connectionId = activeConnectionId;
    const name = c.name ?? c.objectid;
    const typeLabel = COMPONENT_TYPE_LABELS[c.componenttype] ?? `类型 ${c.componenttype}`;
    const ok = await confirm(
      action === "remove"
        ? {
            title: "从此解决方案移除",
            message: `把「${name}」（${typeLabel}）从解决方案「${selected.friendlyname}」中移除？\n组件本身仍保留在环境中。`,
            confirmLabel: "移除",
          }
        : {
            title: "从环境中删除",
            message:
              `永久删除「${name}」（${typeLabel}）？\n它会从整个环境中删除，所有解决方案都会失去它，无法撤销。` +
              (c.componenttype === ENTITY_COMPONENT_TYPE ? "\n表里的所有数据也会一起被删除。" : ""),
            confirmLabel: "删除",
            danger: true,
          },
    );
    if (!ok) return;
    await runAction(
      () =>
        action === "remove"
          ? removeSolutionComponent(connectionId, selected.uniquename, c.componenttype, c.objectid)
          : deleteComponent(connectionId, c.componenttype, c.objectid),
      () => {
        setSelectedNode(null);
        loadComponents(selected.solutionid);
      },
    );
  }

  async function handleColumnAction(entity: SolutionComponentRow, field: ColumnFieldMeta, action: "remove" | "delete") {
    if (!activeConnectionId || !selected || !entity.logicalName) return;
    const connectionId = activeConnectionId;
    const entityLogicalName = entity.logicalName;
    const ok = await confirm(
      action === "remove"
        ? {
            title: "从此解决方案移除字段",
            message: `把字段「${field.displayName}」（${field.logicalName}）从解决方案「${selected.friendlyname}」中移除？\n字段本身仍保留在表上。`,
            confirmLabel: "移除",
          }
        : {
            title: "从环境中删除字段",
            message: `永久删除字段「${field.displayName}」（${field.logicalName}）？\n字段和它在所有记录里的数据都会被删除，无法撤销。`,
            confirmLabel: "删除",
            danger: true,
          },
    );
    if (!ok) return;
    await runAction(
      () =>
        action === "remove"
          ? removeSolutionComponent(connectionId, selected.uniquename, ATTRIBUTE_COMPONENT_TYPE, field.metadataId)
          : deleteColumn(connectionId, entityLogicalName, field.metadataId),
      reloadEntityColumns,
    );
  }

  function openAddExistingColumns(entity: SolutionComponentRow) {
    const entityLogicalName = entity.logicalName;
    if (!entityLogicalName) return;
    const inSolution = new Set((entityFields ?? []).map((f) => f.logicalName));
    setAddExistingKind({
      key: "column",
      label: `${entity.name ?? entityLogicalName} 的字段`,
      group: "",
      componentType: ATTRIBUTE_COMPONENT_TYPE,
      source: {
        kind: "metadata",
        load: async (connectionId) =>
          (await fetchEntityFields(connectionId, entityLogicalName))
            .filter((f) => !inSolution.has(f.logicalName))
            .map((f) => ({ id: f.metadataId, name: f.displayName, secondary: f.logicalName }))
            .sort((a, b) => a.name.localeCompare(b.name)),
      },
    });
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

  async function publishComponents(logicalNames: string[], webResourceIds: string[]) {
    if (!activeConnectionId) return;
    setPublishing(true);
    setPublishError(null);
    setPublishDone(false);
    try {
      await publishSolutionComponents(activeConnectionId, logicalNames, webResourceIds);
      setPublishDone(true);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  /** Publishes just this solution's own tables and web resources — builds the explicit component
   *  list PublishXml requires from the rows already loaded (`components`), no extra fetch needed. */
  async function handlePublishThisSolution() {
    if (!components) return;
    const logicalNames = components
      .filter((c) => c.componenttype === ENTITY_COMPONENT_TYPE && c.logicalName)
      .map((c) => c.logicalName!);
    const webResourceIds = components.filter((c) => c.componenttype === WEB_RESOURCE_COMPONENT_TYPE).map((c) => c.objectid);
    await publishComponents(logicalNames, webResourceIds);
  }

  function handleNewKind(key: string) {
    if (key === "table") setShowNewTable(true);
    else if (key === "webresource") setShowNewWebResource(true);
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
    return <p className="text-sm text-gray-400">请在上方“当前标签连接”中选择连接。</p>;
  }

  // ---- List view ----
  if (!selected) {
    const visibleSolutions = solutions?.filter((s) =>
      solutionFilter === "all" ? true : solutionFilter === "managed" ? s.ismanaged : !s.ismanaged,
    );
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
          查看或新建解决方案。进入一个非托管解决方案后可以浏览组件、添加已有组件（表、Web Resource、插件、流程等）、新建表/字段/Web Resource、管理发布者并发布。托管解决方案只能浏览组件。
        </div>

        <div className="flex items-center gap-2">
          <button onClick={loadSolutions} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
            刷新
          </button>
          <button onClick={() => setShowNewSolution(true)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            + 新建 Solution
          </button>
        </div>

        <div className="flex items-center gap-2">
          {SOLUTION_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setSolutionFilter(f.key)}
              className={
                solutionFilter === f.key
                  ? "rounded-full bg-purple-600 px-3 py-1 text-sm font-medium text-white"
                  : "rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {solutionsError && <ErrorMessage error={solutionsError} />}
        {!solutions && !solutionsError && <p className="text-sm text-gray-400">加载中…</p>}

        {visibleSolutions && (
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
                {visibleSolutions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-sm text-gray-400">
                      没有符合条件的解决方案。
                    </td>
                  </tr>
                )}
                {visibleSolutions.map((s) => (
                  <tr
                    key={s.solutionid}
                    onClick={() => openSolution(s)}
                    className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
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
  // the table's full column list, and a nested row per System Form(60) whose owner resolved back
  // to this table); everything in ENTITY_SUBCOMPONENT_TYPES (a field/relationship row that's
  // really *part of* some table) is dropped from the flat grouping entirely rather than shown as
  // an unresolvable top-level GUID — see ENTITY_SUBCOMPONENT_TYPES' doc comment in types.ts for
  // why. A System Form row whose owner *did* resolve is nested under its table the same way,
  // instead of the flat "System Form" group make.powerapps never shows forms in either
  // (Bugs/8.25.md #4) — only a form whose owner lookup failed (stale/orphaned row) falls back to
  // the flat grouping, so it doesn't just disappear. Every other componenttype keeps the old flat
  // "group by type" treatment.
  const entityRows = (components ?? []).filter((c) => c.componenttype === ENTITY_COMPONENT_TYPE);
  const entityLogicalNamesInTree = new Set(entityRows.flatMap((c) => (c.logicalName ? [c.logicalName.toLowerCase()] : [])));
  const webResourceRows = (components ?? []).filter((c) => c.componenttype === WEB_RESOURCE_COMPONENT_TYPE);
  const formsByOwnerEntity = new Map<string, SolutionComponentRow[]>();
  for (const c of components ?? []) {
    if (c.componenttype !== SYSTEM_FORM_COMPONENT_TYPE || !c.ownerEntityLogicalName) continue;
    const key = c.ownerEntityLogicalName.toLowerCase();
    const list = formsByOwnerEntity.get(key) ?? [];
    list.push(c);
    formsByOwnerEntity.set(key, list);
  }
  const otherGrouped = new Map<number, SolutionComponentRow[]>();
  for (const c of components ?? []) {
    if (c.componenttype === ENTITY_COMPONENT_TYPE || ENTITY_SUBCOMPONENT_TYPES.has(c.componenttype)) continue;
    // Nested under its table instead — unless that table isn't in this solution, or the form is a
    // dashboard (objecttypecode "none"), in which case there's no table node to nest under.
    if (c.componenttype === SYSTEM_FORM_COMPONENT_TYPE && c.ownerEntityLogicalName && entityLogicalNamesInTree.has(c.ownerEntityLogicalName.toLowerCase())) continue;
    const list = otherGrouped.get(c.componenttype) ?? [];
    list.push(c);
    otherGrouped.set(c.componenttype, list);
  }
  const otherGroupTypes = [...otherGrouped.keys()].sort((a, b) => (COMPONENT_TYPE_LABELS[a] ?? "").localeCompare(COMPONENT_TYPE_LABELS[b] ?? ""));
  const readOnly = selected.ismanaged;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={backToList} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          ← 返回列表
        </button>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button
              onClick={handlePublishThisSolution}
              disabled={publishing || (entityRows.length === 0 && webResourceRows.length === 0)}
              title="只发布这个 solution 里的表和 Web Resource（PublishXml 显式列出组件），不影响其它 solution"
              className="rounded-md border border-purple-300 px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50 dark:border-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/20"
            >
              {publishing ? "发布中…" : "只发布这个 Solution"}
            </button>
            <button
              onClick={handlePublish}
              disabled={publishing}
              title="Dataverse 没有'只发布一个 solution'的原语，这个按钮走 PublishAllXml，会republish 整个环境的自定义"
              className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {publishing ? "发布中…" : "发布全部自定义"}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {selected.friendlyname}
          {readOnly && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-500 dark:bg-gray-800">Managed · 只读</span>}
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {selected.uniquename} · v{selected.version} · {selected.publisherName} ({selected.publisherPrefix})
        </p>
        {selected.description && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{selected.description}</p>}
        {publishError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{publishError}</p>}
        {publishDone && <p className="mt-2 text-xs text-green-600 dark:text-green-400">已发布。</p>}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2">
          <DropdownMenuButton
            label="+ 新建"
            items={NEW_KINDS}
            onSelect={handleNewKind}
            buttonClassName="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          />
          <DropdownMenuButton
            label="添加现有"
            items={ADD_EXISTING_KINDS}
            onSelect={(key) => setAddExistingKind(ADD_EXISTING_KINDS.find((k) => k.key === key) ?? null)}
            buttonClassName="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          />
        </div>
      )}

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
                      const ownForms = c.logicalName ? (formsByOwnerEntity.get(c.logicalName.toLowerCase()) ?? []) : [];
                      return (
                        <li key={c.solutioncomponentid}>
                          <div className={`${rowBase} ${isEntitySelected ? rowSelected : ""}`}>
                            <button onClick={() => toggleEntity(c.solutioncomponentid)}>
                              <span className="inline-block w-3 shrink-0 text-gray-400">{eOpen ? "▾" : "▸"}</span>
                            </button>
                            <button className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left" onClick={() => selectEntity(c)} title={c.name ?? c.objectid}>
                              <SvgIcon name="table" className="h-3.5 w-3.5" />
                              <span className="truncate">{c.name ?? c.objectid}</span>
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
                              {ownForms.map((f) => {
                                const isFormSelected = selectedNode?.kind === "other" && selectedNode.component.solutioncomponentid === f.solutioncomponentid;
                                return (
                                  <li key={f.solutioncomponentid}>
                                    <button
                                      onClick={() => selectOther(f)}
                                      className={`${rowBase} ${isFormSelected ? rowSelected : ""}`}
                                      title={f.name ?? f.objectid}
                                    >
                                      <span className="inline-block w-3 shrink-0" />
                                      <SvgIcon name="file" className="h-3.5 w-3.5" />
                                      <span className="truncate">{f.name ?? f.objectid}</span>
                                    </button>
                                  </li>
                                );
                              })}
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
                            onClick={() => selectOther(c)}
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

          {!readOnly && (selectedNode?.kind === "entity" || selectedNode?.kind === "other") && (
            <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-3 dark:border-gray-800">
              {selectedNode.kind === "entity" && (
                <button onClick={() => setShowEditTable(true)} disabled={!entityBasicInfo || actionBusy} className={SECONDARY_BUTTON}>
                  编辑
                </button>
              )}
              <DropdownMenuButton
                label={actionBusy ? "处理中…" : "移除"}
                items={[
                  { key: "remove", label: "从此解决方案移除" },
                  ...(componentDeletePath(selectedNode.component.componenttype, selectedNode.component.objectid)
                    ? [{ key: "delete", label: "从环境中删除" }]
                    : []),
                ]}
                onSelect={(key) => void handleComponentAction(selectedNode.component, key)}
                buttonClassName={REMOVE_MENU_BUTTON}
              />
            </div>
          )}
          {actionError && <ErrorMessage error={actionError} className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}

          {selectedNode?.kind === "other" &&
            (selectedNode.component.componenttype === WEB_RESOURCE_COMPONENT_TYPE ? (
              <WebResourceEditor
                key={selectedNode.component.objectid}
                connectionId={activeConnectionId}
                webResourceId={selectedNode.component.objectid}
                readOnly={readOnly}
              />
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium">{selectedNode.component.name ?? "(无法解析名称)"}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {COMPONENT_TYPE_LABELS[selectedNode.component.componenttype] ?? `类型 ${selectedNode.component.componenttype}`}
                </p>
                <p className="mt-1 font-mono text-xs text-gray-400">{selectedNode.component.objectid}</p>
              </div>
            ))}

          {selectedNode?.kind === "entity" && (
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <SvgIcon name="table" className="h-4 w-4" />
                {selectedNode.component.name} <span className="font-mono text-xs text-gray-400">({selectedNode.component.logicalName})</span>
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
                    {readOnly ? "查看字段 →" : "查看/管理字段 →"}
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
                {!readOnly && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openAddExistingColumns(selectedNode.component)}
                      disabled={!selectedNode.component.logicalName || !entityFields || includesAllSubcomponents(selectedNode.component)}
                      title={includesAllSubcomponents(selectedNode.component) ? "这个表以“包含所有子组件”方式加入解决方案，它的所有字段都已在解决方案里" : undefined}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      添加现有字段
                    </button>
                    <button
                      onClick={() => setShowNewColumn(true)}
                      disabled={!selectedNode.component.logicalName}
                      className="rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                    >
                      + 新建字段
                    </button>
                  </div>
                )}
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
                      {!readOnly && <th className="py-1"></th>}
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
                        {!readOnly && (
                          <td className="space-x-3 whitespace-nowrap py-1 text-right text-xs">
                            <button onClick={() => setEditingColumn(f.logicalName)} disabled={actionBusy} className="text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400">
                              编辑
                            </button>
                            {!includesAllSubcomponents(selectedNode.component) && !f.isPrimaryName && (
                              <button
                                onClick={() => void handleColumnAction(selectedNode.component, f, "remove")}
                                disabled={actionBusy}
                                className="text-gray-600 hover:underline disabled:opacity-50 dark:text-gray-400"
                              >
                                移出解决方案
                              </button>
                            )}
                            {f.isCustomAttribute && !f.isPrimaryName && (
                              <button
                                onClick={() => void handleColumnAction(selectedNode.component, f, "delete")}
                                disabled={actionBusy}
                                className="text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                              >
                                删除
                              </button>
                            )}
                          </td>
                        )}
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
      {showNewWebResource && (
        <NewWebResourceDialog
          connectionId={activeConnectionId}
          solutionUniqueName={selected.uniquename}
          publisherPrefix={selected.publisherPrefix}
          onClose={() => setShowNewWebResource(false)}
          onCreated={() => {
            setShowNewWebResource(false);
            loadComponents(selected.solutionid);
          }}
        />
      )}
      {addExistingKind && (
        <AddExistingComponentDialog
          connectionId={activeConnectionId}
          solutionUniqueName={selected.uniquename}
          kind={addExistingKind}
          onClose={() => setAddExistingKind(null)}
          onAdded={() => {
            const addedColumns = addExistingKind.componentType === ATTRIBUTE_COMPONENT_TYPE;
            setAddExistingKind(null);
            if (addedColumns) reloadEntityColumns();
            else loadComponents(selected.solutionid);
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
            reloadEntityColumns();
          }}
        />
      )}
      {editingColumn && selectedNode?.kind === "entity-columns" && selectedNode.component.logicalName && (
        <EditColumnDialog
          connectionId={activeConnectionId}
          solutionUniqueName={selected.uniquename}
          entityLogicalName={selectedNode.component.logicalName}
          attributeLogicalName={editingColumn}
          onClose={() => setEditingColumn(null)}
          onSaved={() => {
            setEditingColumn(null);
            reloadEntityColumns();
          }}
        />
      )}
      {showEditTable && selectedNode?.kind === "entity" && entityBasicInfo && (
        <EditTableDialog
          connectionId={activeConnectionId}
          solutionUniqueName={selected.uniquename}
          info={entityBasicInfo}
          onClose={() => setShowEditTable(false)}
          onSaved={() => {
            setShowEditTable(false);
            reloadAndReselectEntity(selectedNode.component.solutioncomponentid);
          }}
        />
      )}
    </div>
  );
}
