import { useState } from "react";
import { createWebResource, publishSolutionComponents } from "./dataverseOps";
import { WEB_RESOURCE_TYPES, webResourceTypeForFileName } from "./componentCatalog";
import ErrorMessage from "../../shared/ErrorMessage";
import Dialog from "../../shared/Dialog";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export default function NewWebResourceDialog({
  connectionId,
  solutionUniqueName,
  publisherPrefix,
  onClose,
  onCreated,
}: {
  connectionId: string;
  solutionUniqueName: string;
  publisherPrefix: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [webResourceType, setWebResourceType] = useState<number | null>(null);
  const [publishAfterCreate, setPublishAfterCreate] = useState(true);
  const [created, setCreated] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleFileChange(picked: File | null) {
    setFile(picked);
    if (!picked) return;
    if (!nameTouched) setName(`${publisherPrefix}_/${picked.name}`);
    if (!displayName) setDisplayName(picked.name);
    setWebResourceType(webResourceTypeForFileName(picked.name));
  }

  async function handleSubmit() {
    if (!file || !name.trim() || webResourceType === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const content = await readFileAsBase64(file);
      const { webResourceId } = await createWebResource(connectionId, solutionUniqueName, {
        name: name.trim(),
        displayName: displayName.trim(),
        webResourceType,
        content,
      });
      setCreated(true);
      if (publishAfterCreate) {
        try {
          await publishSolutionComponents(connectionId, [], [webResourceId]);
        } catch (err) {
          setSubmitError(`已创建，但发布失败：${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !!file && !!name.trim() && webResourceType !== null && !submitting && !created;
  const close = created ? onCreated : onClose;

  return (
    <Dialog ariaLabel="新建 Web Resource" onClose={close} panelClassName="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
      <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">新建 Web Resource</h3>

      <div className="space-y-3">
        <div>
          <label className={labelCls}>本地文件</label>
          <input type="file" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} className="block w-full text-sm text-gray-700 dark:text-gray-300" />
        </div>
        <div>
          <label className={labelCls}>名称（含 publisher 前缀，创建后不可改）</label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            className={`${inputCls} font-mono`}
            placeholder={`${publisherPrefix}_/scripts/form.js`}
          />
        </div>
        <div>
          <label className={labelCls}>显示名称</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>类型</label>
          <select value={webResourceType ?? ""} onChange={(e) => setWebResourceType(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
            <option value="">请选择…</option>
            {WEB_RESOURCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={publishAfterCreate} onChange={(e) => setPublishAfterCreate(e.target.checked)} />
          创建后立即发布
        </label>

        {submitError && <ErrorMessage error={submitError} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={close} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
          {created ? "关闭" : "取消"}
        </button>
        <button onClick={handleSubmit} disabled={!canSubmit} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {submitting ? "创建中…" : "创建"}
        </button>
      </div>
    </Dialog>
  );
}
