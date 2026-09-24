import { useEffect, useState } from "react";
import { fetchColumnDetail, publishSolutionComponents, updateColumn, type ColumnDetail } from "./dataverseOps";
import ErrorMessage from "../../shared/ErrorMessage";
import Dialog from "../../shared/Dialog";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

/** "SystemRequired" is set by Dataverse itself and can't be chosen or cleared by a customizer. */
const REQUIRED_LEVELS = [
  { value: "None", label: "可选（None）" },
  { value: "Recommended", label: "建议（Recommended）" },
  { value: "ApplicationRequired", label: "必填（ApplicationRequired）" },
];

export default function EditColumnDialog({
  connectionId,
  solutionUniqueName,
  entityLogicalName,
  attributeLogicalName,
  onClose,
  onSaved,
}: {
  connectionId: string;
  solutionUniqueName: string;
  entityLogicalName: string;
  attributeLogicalName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<ColumnDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [requiredLevel, setRequiredLevel] = useState("None");
  const [maxLength, setMaxLength] = useState("");
  const [publishAfterSave, setPublishAfterSave] = useState(true);
  const [saved, setSaved] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetchColumnDetail(connectionId, entityLogicalName, attributeLogicalName)
      .then((d) => {
        setDetail(d);
        setDisplayName(d.displayName);
        setDescription(d.description);
        setRequiredLevel(d.requiredLevel);
        setMaxLength(d.maxLength === null ? "" : String(d.maxLength));
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [connectionId, entityLogicalName, attributeLogicalName]);

  const systemRequired = detail?.requiredLevel === "SystemRequired";
  const maxLengthValue = maxLength.trim() === "" ? undefined : Number(maxLength);
  const maxLengthValid = maxLengthValue === undefined || (Number.isInteger(maxLengthValue) && maxLengthValue > 0);

  async function handleSubmit() {
    if (!detail || !displayName.trim() || !maxLengthValid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await updateColumn(connectionId, solutionUniqueName, entityLogicalName, attributeLogicalName, {
        displayName: displayName.trim(),
        description: description.trim(),
        requiredLevel,
        maxLength: detail.maxLength === null ? undefined : maxLengthValue,
      });
      setSaved(true);
      if (publishAfterSave) {
        try {
          await publishSolutionComponents(connectionId, [entityLogicalName]);
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

  const canSubmit = !!detail && !!displayName.trim() && maxLengthValid && !submitting && !saved;
  const close = saved ? onSaved : onClose;

  return (
    <Dialog ariaLabel="编辑字段" onClose={close} panelClassName="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
      <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">编辑字段</h3>
      <p className="mb-4 font-mono text-xs text-gray-400">
        {entityLogicalName}.{attributeLogicalName}
        {detail && ` · ${detail.attributeType}`}
      </p>

      {loadError && <ErrorMessage error={loadError} />}
      {!detail && !loadError && <p className="text-sm text-gray-400">加载中…</p>}

      {detail && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>显示名称</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>必填级别</label>
            {systemRequired ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">系统必填（SystemRequired），不可修改</p>
            ) : (
              <select value={requiredLevel} onChange={(e) => setRequiredLevel(e.target.value)} className={inputCls}>
                {REQUIRED_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {detail.maxLength !== null && (
            <div>
              <label className={labelCls}>最大长度</label>
              <input type="number" min={1} value={maxLength} onChange={(e) => setMaxLength(e.target.value)} className={inputCls} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={publishAfterSave} onChange={(e) => setPublishAfterSave(e.target.checked)} />
            保存后发布这个表
          </label>

          {submitError && <ErrorMessage error={submitError} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}
        </div>
      )}

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
