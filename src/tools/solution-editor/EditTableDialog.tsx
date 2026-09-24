import { useState } from "react";
import { publishSolutionComponents, updateTable } from "./dataverseOps";
import type { EntityBasicInfo } from "./types";
import ErrorMessage from "../../shared/ErrorMessage";
import Dialog from "../../shared/Dialog";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

export default function EditTableDialog({
  connectionId,
  solutionUniqueName,
  info,
  onClose,
  onSaved,
}: {
  connectionId: string;
  solutionUniqueName: string;
  info: EntityBasicInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(info.displayName);
  const [displayCollectionName, setDisplayCollectionName] = useState(info.displayCollectionName);
  const [description, setDescription] = useState(info.description ?? "");
  const [publishAfterSave, setPublishAfterSave] = useState(true);
  const [saved, setSaved] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!displayName.trim() || !displayCollectionName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await updateTable(connectionId, solutionUniqueName, info.logicalName, {
        displayName: displayName.trim(),
        displayCollectionName: displayCollectionName.trim(),
        description: description.trim(),
      });
      setSaved(true);
      if (publishAfterSave) {
        try {
          await publishSolutionComponents(connectionId, [info.logicalName]);
        } catch (err) {
          setSubmitError(`已保存，但发布失败：${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !!displayName.trim() && !!displayCollectionName.trim() && !submitting && !saved;
  const close = saved ? onSaved : onClose;

  return (
    <Dialog ariaLabel="编辑表" onClose={close} panelClassName="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
      <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">编辑表属性</h3>
      <p className="mb-4 font-mono text-xs text-gray-400">{info.logicalName}</p>

      <div className="space-y-3">
        <div>
          <label className={labelCls}>显示名称</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>复数显示名称</label>
          <input value={displayCollectionName} onChange={(e) => setDisplayCollectionName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>描述</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={publishAfterSave} onChange={(e) => setPublishAfterSave(e.target.checked)} />
          保存后发布这个表
        </label>

        {submitError && <ErrorMessage error={submitError} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={close} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
          {saved ? "关闭" : "取消"}
        </button>
        <button onClick={handleSubmit} disabled={!canSubmit} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {submitting ? "保存中…" : "保存"}
        </button>
      </div>
    </Dialog>
  );
}
