import { useRef, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import TreePanel, { type TreePanelHandle } from "./TreePanel";
import StepRegisterDialog from "./StepRegisterDialog";
import ImageRegisterDialog from "./ImageRegisterDialog";
import AssemblyRegisterDialog from "./AssemblyRegisterDialog";
import {
  deleteAssemblyCascade,
  deleteImage,
  deleteStepCascade,
  deleteTypeCascade,
  fetchRecordDetail,
  setStepEnabled,
} from "./dataverseOps";
import { COLLECTION_BY_KIND, nodeKey, type TreeNodeKind } from "./types";

type DialogState =
  | { kind: "step"; pluginTypeId: string; pluginTypeName: string }
  | { kind: "image"; stepId: string }
  | { kind: "assembly"; existingAssemblyId?: string }
  | null;

/** Best-effort read of a lookup's plain `_<attr>_value` field off an untyped detail record. */
function lookupValue(detail: unknown, attribute: string): string | null {
  if (!detail || typeof detail !== "object") return null;
  const value = (detail as Record<string, unknown>)[`_${attribute}_value`];
  return typeof value === "string" ? value : null;
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

  async function loadDetail(kind: TreeNodeKind, id: string) {
    if (!activeConnectionId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await fetchRecordDetail(activeConnectionId, COLLECTION_BY_KIND[kind], id);
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

  async function handleDeleteAssembly() {
    if (!activeConnectionId || !selected || selected.kind !== "assembly") return;
    if (!confirm("删除该程序集会连带删除它下面所有的 PluginType / Step / Image。确定继续？")) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await deleteAssemblyCascade(activeConnectionId, selected.id);
      treeRef.current?.reloadRoot();
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
        请先在左侧侧边栏顶部选择一个"当前连接"（没有连接的话先去"我的连接"里添加）。
      </div>
    );
  }

  const stepEnabled = selected?.kind === "step" && (detail as { statecode?: number } | null)?.statecode === 0;

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <TreePanel
        ref={treeRef}
        connectionId={activeConnectionId}
        selectedKey={selected ? nodeKey(selected.kind, selected.id) : null}
        onSelect={handleSelect}
        onAddAssembly={() => setDialog({ kind: "assembly" })}
        onAddStep={(pluginTypeId, pluginTypeName) => setDialog({ kind: "step", pluginTypeId, pluginTypeName })}
        onAddImage={(stepId) => setDialog({ kind: "image", stepId })}
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
            <button
              onClick={
                selected.kind === "assembly"
                  ? handleDeleteAssembly
                  : selected.kind === "type"
                    ? handleDeleteType
                    : selected.kind === "step"
                      ? handleDeleteStep
                      : handleDeleteImage
              }
              disabled={actionBusy || detailLoading}
              className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              删除
              {selected.kind === "assembly"
                ? " Assembly"
                : selected.kind === "type"
                  ? " PluginType"
                  : selected.kind === "step"
                    ? " Step"
                    : " Image"}
            </button>
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
          <pre className="overflow-auto text-xs text-gray-700 dark:text-gray-300">
            {JSON.stringify(detail, null, 2)}
          </pre>
        )}
      </div>

      {dialog?.kind === "step" && (
        <StepRegisterDialog
          connectionId={activeConnectionId}
          pluginTypeId={dialog.pluginTypeId}
          pluginTypeName={dialog.pluginTypeName}
          onClose={() => setDialog(null)}
          onRegistered={() => {
            treeRef.current?.invalidateChildrenOf("type", dialog.pluginTypeId);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "image" && (
        <ImageRegisterDialog
          connectionId={activeConnectionId}
          stepId={dialog.stepId}
          onClose={() => setDialog(null)}
          onRegistered={() => {
            treeRef.current?.invalidateChildrenOf("step", dialog.stepId);
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
