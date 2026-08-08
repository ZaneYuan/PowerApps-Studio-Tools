import { useState } from "react";
import { registerImage } from "./dataverseOps";
import { IMAGE_TYPE_LABELS } from "./types";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

interface ImageRegisterDialogProps {
  connectionId: string;
  stepId: string;
  onClose: () => void;
  onRegistered: () => void;
}

export default function ImageRegisterDialog({ connectionId, stepId, onClose, onRegistered }: ImageRegisterDialogProps) {
  const [alias, setAlias] = useState("");
  const [imageType, setImageType] = useState(0);
  const [messagePropertyName, setMessagePropertyName] = useState("Target");
  const [attributes, setAttributes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!alias.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await registerImage(connectionId, {
        stepId,
        alias: alias.trim(),
        imageType,
        messagePropertyName,
        attributes,
      });
      onRegistered();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">注册 Image</h3>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Alias / Entity Alias</label>
            <input type="text" value={alias} onChange={(e) => setAlias(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Image Type</label>
            <select value={imageType} onChange={(e) => setImageType(Number(e.target.value))} className={inputCls}>
              {Object.entries(IMAGE_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Message Property Name（Delete 消息用 EntityMoniker，其余大多是 Target）</label>
            <input
              type="text"
              value={messagePropertyName}
              onChange={(e) => setMessagePropertyName(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Attributes（逗号分隔，留空 = 全部字段）</label>
            <input
              type="text"
              value={attributes}
              onChange={(e) => setAttributes(e.target.value)}
              placeholder="name,revenue"
              className={inputCls}
            />
          </div>

          {submitError && (
            <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {submitError}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!alias.trim() || submitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "注册中…" : "注册 Image"}
          </button>
        </div>
      </div>
    </div>
  );
}
