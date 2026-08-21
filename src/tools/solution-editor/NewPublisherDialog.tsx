import { useState } from "react";
import { createPublisher, type NewPublisherParams } from "./dataverseOps";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

/** Picks a value in Dataverse's fixed 10000-99999 range deterministically from the prefix text,
 *  purely so the field starts non-empty with something plausible — the user can (and, for a real
 *  publisher, should) change it, since this has no collision-avoidance of its own. */
function suggestOptionValuePrefix(prefix: string): number {
  let hash = 0;
  for (const ch of prefix) hash = (hash * 31 + ch.charCodeAt(0)) % 90000;
  return 10000 + hash;
}

export default function NewPublisherDialog({
  connectionId,
  onClose,
  onCreated,
}: {
  connectionId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [friendlyName, setFriendlyName] = useState("");
  const [uniqueName, setUniqueName] = useState("");
  const [uniqueNameTouched, setUniqueNameTouched] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [optionValuePrefix, setOptionValuePrefix] = useState(10000);
  const [optionValuePrefixTouched, setOptionValuePrefixTouched] = useState(false);
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleFriendlyNameChange(value: string) {
    setFriendlyName(value);
    if (!uniqueNameTouched) setUniqueName(value.replace(/[^A-Za-z0-9]/g, ""));
  }

  function handlePrefixChange(value: string) {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    setPrefix(cleaned);
    if (!optionValuePrefixTouched && cleaned) setOptionValuePrefix(suggestOptionValuePrefix(cleaned));
  }

  const rangeError = optionValuePrefix < 10000 || optionValuePrefix > 99999;
  const canSubmit = friendlyName.trim() && uniqueName.trim() && prefix.trim() && !rangeError;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const params: NewPublisherParams = {
      uniqueName: uniqueName.trim(),
      friendlyName: friendlyName.trim(),
      customizationPrefix: prefix.trim(),
      customizationOptionValuePrefix: optionValuePrefix,
      description,
    };
    try {
      await createPublisher(connectionId, params);
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">新建 Publisher</h3>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>显示名称</label>
            <input value={friendlyName} onChange={(e) => handleFriendlyNameChange(e.target.value)} className={inputCls} placeholder="Contoso" />
          </div>
          <div>
            <label className={labelCls}>唯一名称（Unique Name）</label>
            <input
              value={uniqueName}
              onChange={(e) => {
                setUniqueName(e.target.value);
                setUniqueNameTouched(true);
              }}
              className={`${inputCls} font-mono`}
            />
          </div>
          <div>
            <label className={labelCls}>前缀（Customization Prefix，最多 8 位小写字母/数字，创建后不可改）</label>
            <input value={prefix} onChange={(e) => handlePrefixChange(e.target.value)} className={`${inputCls} font-mono`} placeholder="contoso" />
          </div>
          <div>
            <label className={labelCls}>Option Value Prefix（10000–99999，创建后不可改）</label>
            <input
              type="number"
              min={10000}
              max={99999}
              value={optionValuePrefix}
              onChange={(e) => {
                setOptionValuePrefix(Number(e.target.value) || 0);
                setOptionValuePrefixTouched(true);
              }}
              className={inputCls}
            />
            {rangeError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">必须在 10000–99999 之间。</p>}
          </div>
          <div>
            <label className={labelCls}>描述（可选）</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
          </div>

          {submitError && (
            <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {submitError}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
