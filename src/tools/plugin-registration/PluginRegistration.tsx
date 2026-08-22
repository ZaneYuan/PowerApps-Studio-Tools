import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import TreePanel, { type TreePanelHandle } from "./TreePanel";
import StepRegisterDialog from "./StepRegisterDialog";
import ImageRegisterDialog from "./ImageRegisterDialog";
import AssemblyRegisterDialog from "./AssemblyRegisterDialog";
import {
  deleteImage,
  deleteStepCascade,
  deleteTypeCascade,
  fetchImageDetail,
  fetchRecordDetail,
  fetchStepDetail,
  setStepEnabled,
} from "./dataverseOps";
import {
  COLLECTION_BY_KIND,
  DEPLOYMENT_LABELS,
  IMAGE_TYPE_LABELS,
  MODE_LABELS,
  STAGE_LABELS,
  STEP_STATE_LABELS,
  nodeKey,
  type TreeNodeKind,
} from "./types";

type DialogState =
  | { kind: "step"; pluginTypeId: string; pluginTypeName: string; editStepId?: string }
  | { kind: "image"; stepId: string; messageName: string; primaryEntity: string | null; editImageId?: string }
  | { kind: "assembly"; existingAssemblyId?: string }
  | null;

/** Best-effort read of a lookup's plain `_<attr>_value` field off an untyped detail record. */
function lookupValue(detail: unknown, attribute: string): string | null {
  if (!detail || typeof detail !== "object") return null;
  const value = (detail as Record<string, unknown>)[`_${attribute}_value`];
  return typeof value === "string" ? value : null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
}

/** Curated label/value rows for the detail table — picks the fields worth showing per node
 *  kind instead of dumping the entire raw record, and translates the numeric enum fields
 *  (stage/mode/deployment/state/image type) into their labels. */
function detailRows(kind: TreeNodeKind, detail: unknown): { label: string; value: string }[] {
  if (!detail || typeof detail !== "object") return [];
  const d = detail as Record<string, unknown>;
  switch (kind) {
    case "assembly":
      return [
        { label: "Name", value: fmt(d.name) },
        { label: "Version", value: fmt(d.version) },
        { label: "Culture", value: fmt(d.culture) },
        { label: "Public Key Token", value: fmt(d.publickeytoken) },
        { label: "Is Managed", value: fmt(d.ismanaged) },
        { label: "Created On", value: fmt(d.createdon) },
        { label: "Modified On", value: fmt(d.modifiedon) },
      ];
    case "type":
      return [
        { label: "Friendly Name", value: fmt(d.friendlyname) },
        { label: "Name", value: fmt(d.name) },
        { label: "Type Name", value: fmt(d.typename) },
        { label: "Created On", value: fmt(d.createdon) },
        { label: "Modified On", value: fmt(d.modifiedon) },
      ];
    case "step": {
      const message = (d.sdkmessageid as { name?: string } | null)?.name;
      const entity = (d.sdkmessagefilterid as { primaryobjecttypecode?: string } | null)?.primaryobjecttypecode;
      return [
        { label: "Name", value: fmt(d.name) },
        { label: "Message", value: fmt(message) },
        { label: "主实体", value: entity ? entity : "（不限）" },
        { label: "Stage", value: STAGE_LABELS[d.stage as number] ?? fmt(d.stage) },
        { label: "Mode", value: MODE_LABELS[d.mode as number] ?? fmt(d.mode) },
        { label: "Rank", value: fmt(d.rank) },
        { label: "Deployment", value: DEPLOYMENT_LABELS[d.supporteddeployment as number] ?? fmt(d.supporteddeployment) },
        { label: "状态", value: STEP_STATE_LABELS[d.statecode as number] ?? fmt(d.statecode) },
        { label: "Filtering Attributes", value: fmt(d.filteringattributes) },
        { label: "Unsecure Configuration", value: fmt(d.configuration) },
        { label: "有 Secure Configuration", value: d._sdkmessageprocessingstepsecureconfigid_value ? "是" : "否" },
      ];
    }
    case "image":
      return [
        { label: "Name", value: fmt(d.name) },
        { label: "Entity Alias", value: fmt(d.entityalias) },
        { label: "Image Type", value: IMAGE_TYPE_LABELS[d.imagetype as number] ?? fmt(d.imagetype) },
        { label: "Message Property Name", value: fmt(d.messagepropertyname) },
        { label: "Attributes", value: fmt(d.attributes1) },
      ];
    default:
      return [];
  }
}

export default function PluginRegistration() {
  const { activeConnectionId } = useActiveConnection();
  const treeRef = useRef<TreePanelHandle>(null);

  const [selected, setSelected] = useState<{ kind: TreeNodeKind; id: string } | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [dialog, setDialog] = useState<DialogState>(null);

  const [treeWidth, setTreeWidth] = useState(384);

  function handleResizeStart(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = treeWidth;
    function onMove(ev: MouseEvent) {
      setTreeWidth(Math.min(720, Math.max(240, startWidth + (ev.clientX - startX))));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function loadDetail(kind: TreeNodeKind, id: string) {
    if (!activeConnectionId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      // Step/Image use a targeted $select+$expand (resolves Message/Primary Entity to readable
      // names instead of raw GUIDs) — Assembly/Type stay on the generic unfiltered fetch since
      // they don't have confusing lookups worth resolving.
      const data =
        kind === "step"
          ? await fetchStepDetail(activeConnectionId, id)
          : kind === "image"
            ? await fetchImageDetail(activeConnectionId, id)
            : await fetchRecordDetail(activeConnectionId, COLLECTION_BY_KIND[kind], id);
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  function handleSelect(kind: TreeNodeKind, id: string) {
    setSelected({ kind, id });
    setDetail(null);
    setActionError(null);
    void loadDetail(kind, id);
  }

  function handleEditStep(stepId: string, pluginTypeId: string, pluginTypeName: string) {
    setDialog({ kind: "step", pluginTypeId, pluginTypeName, editStepId: stepId });
  }

  function handleEditImage(imageId: string, stepId: string) {
    setDialog({ kind: "image", stepId, messageName: "", primaryEntity: null, editImageId: imageId });
  }

  async function handleToggleStepEnabled(enable: boolean) {
    if (!activeConnectionId || !selected || selected.kind !== "step") return;
    setActionBusy(true);
    setActionError(null);
    try {
      await setStepEnabled(activeConnectionId, selected.id, enable);
      const pluginTypeId = lookupValue(detail, "eventhandler");
      if (pluginTypeId) treeRef.current?.invalidateChildrenOf("type", pluginTypeId);
      await loadDetail("step", selected.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteStep() {
    if (!activeConnectionId || !selected || selected.kind !== "step") return;
    if (!confirm("删除该 Step 会连带删除它下面的所有 Image（以及关联的 secure config）。确定继续？")) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const pluginTypeId = lookupValue(detail, "eventhandler");
      await deleteStepCascade(activeConnectionId, selected.id);
      if (pluginTypeId) treeRef.current?.invalidateChildrenOf("type", pluginTypeId);
      setSelected(null);
      setDetail(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteImage() {
    if (!activeConnectionId || !selected || selected.kind !== "image") return;
    if (!confirm("确定删除该 Image？")) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const stepId = lookupValue(detail, "sdkmessageprocessingstepid");
      await deleteImage(activeConnectionId, selected.id);
      if (stepId) treeRef.current?.invalidateChildrenOf("step", stepId);
      setSelected(null);
      setDetail(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteType() {
    if (!activeConnectionId || !selected || selected.kind !== "type") return;
    if (!confirm("删除该 PluginType 会连带删除它下面所有的 Step 和 Image。确定继续？")) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const assemblyId = lookupValue(detail, "pluginassemblyid");
      await deleteTypeCascade(activeConnectionId, selected.id);
      if (assemblyId) treeRef.current?.invalidateChildrenOf("assembly", assemblyId);
      setSelected(null);
      setDetail(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

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

  const stepEnabled = selected?.kind === "step" && (detail as { statecode?: number } | null)?.statecode === 0;

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      <TreePanel
        ref={treeRef}
        connectionId={activeConnectionId}
        width={treeWidth}
        selectedKey={selected ? nodeKey(selected.kind, selected.id) : null}
        onSelect={handleSelect}
        onAddAssembly={() => setDialog({ kind: "assembly" })}
        onAddStep={(pluginTypeId, pluginTypeName) => setDialog({ kind: "step", pluginTypeId, pluginTypeName })}
        onAddImage={(stepId, messageName, primaryEntity) => setDialog({ kind: "image", stepId, messageName, primaryEntity })}
        onEditStep={handleEditStep}
        onEditImage={handleEditImage}
      />

      <div
        onMouseDown={handleResizeStart}
        className="mx-1 w-1.5 shrink-0 cursor-col-resize rounded hover:bg-blue-200 dark:hover:bg-blue-900/40"
        title="拖动调整宽度"
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        {!selected && <p className="text-sm text-gray-400">从左侧选一个节点查看详情。</p>}

        {selected && (
          <div className="mb-3 flex flex-wrap gap-2">
            {selected.kind === "assembly" && (
              <button
                onClick={() => setDialog({ kind: "assembly", existingAssemblyId: selected.id })}
                className="rounded-md border border-blue-300 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                更新程序集（重新上传 DLL）
              </button>
            )}
            {selected.kind === "step" && (
              <button
                onClick={() => handleToggleStepEnabled(!stepEnabled)}
                disabled={actionBusy || detailLoading}
                className="rounded-md border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
              >
                {stepEnabled ? "停用 Step" : "启用 Step"}
              </button>
            )}
            {selected.kind === "step" && (
              <button
                onClick={() => {
                  const pluginTypeId = lookupValue(detail, "eventhandler");
                  if (pluginTypeId) handleEditStep(selected.id, pluginTypeId, "");
                }}
                className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                编辑（或双击树节点）
              </button>
            )}
            {selected.kind === "image" && (
              <button
                onClick={() => {
                  const stepId = lookupValue(detail, "sdkmessageprocessingstepid");
                  if (stepId) handleEditImage(selected.id, stepId);
                }}
                className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                编辑（或双击树节点）
              </button>
            )}
            {/* Assembly delete is deliberately not exposed here — cascades through every type/
                step/image under it, too easy to trigger by accident. See deleteAssemblyCascade's
                doc comment in dataverseOps.ts. */}
            {selected.kind !== "assembly" && (
              <button
                onClick={
                  selected.kind === "type"
                    ? handleDeleteType
                    : selected.kind === "step"
                      ? handleDeleteStep
                      : handleDeleteImage
                }
                disabled={actionBusy || detailLoading}
                className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                删除
                {selected.kind === "type" ? " PluginType" : selected.kind === "step" ? " Step" : " Image"}
              </button>
            )}
          </div>
        )}

        {actionError && (
          <p className="mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {actionError}
          </p>
        )}

        {selected && detailLoading && <p className="text-xs text-gray-400">加载详情…</p>}
        {selected && detailError && <p className="text-xs text-red-600 dark:text-red-400">{detailError}</p>}
        {selected && detail !== null && !detailLoading && (
          <div className="overflow-auto">
            <table className="w-full max-w-2xl text-left text-sm">
              <tbody>
                {detailRows(selected.kind, detail).map((row) => (
                  <tr key={row.label} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="w-48 px-2 py-1.5 align-top text-xs font-medium text-gray-500 dark:text-gray-400">
                      {row.label}
                    </td>
                    <td className="break-all px-2 py-1.5 text-xs text-gray-900 dark:text-gray-100">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog?.kind === "step" && (
        <StepRegisterDialog
          connectionId={activeConnectionId}
          pluginTypeId={dialog.pluginTypeId}
          pluginTypeName={dialog.pluginTypeName}
          editStepId={dialog.editStepId}
          onClose={() => setDialog(null)}
          onSaved={() => {
            treeRef.current?.invalidateChildrenOf("type", dialog.pluginTypeId);
            if (dialog.editStepId && selected?.kind === "step" && selected.id === dialog.editStepId) {
              void loadDetail("step", selected.id);
            }
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "image" && (
        <ImageRegisterDialog
          connectionId={activeConnectionId}
          stepId={dialog.stepId}
          messageName={dialog.messageName}
          primaryEntity={dialog.primaryEntity}
          editImageId={dialog.editImageId}
          onClose={() => setDialog(null)}
          onSaved={(newImageId) => {
            treeRef.current?.invalidateChildrenOf("step", dialog.stepId);
            if (dialog.editImageId && selected?.kind === "image" && selected.id === dialog.editImageId && newImageId) {
              void loadDetail("image", newImageId);
            }
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "assembly" && (
        <AssemblyRegisterDialog
          connectionId={activeConnectionId}
          existingAssemblyId={dialog.existingAssemblyId}
          onClose={() => setDialog(null)}
          onRegistered={() => {
            if (dialog.existingAssemblyId) {
              treeRef.current?.invalidateChildrenOf("assembly", dialog.existingAssemblyId);
              void loadDetail("assembly", dialog.existingAssemblyId);
            } else {
              treeRef.current?.reloadRoot();
            }
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
