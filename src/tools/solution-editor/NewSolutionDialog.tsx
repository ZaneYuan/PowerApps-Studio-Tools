import { useEffect, useState } from "react";
import { createSolution, fetchPublishers, suggestSchemaName } from "./dataverseOps";
import NewPublisherDialog from "./NewPublisherDialog";
import type { Publisher } from "./types";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

export default function NewSolutionDialog({
  connectionId,
  onClose,
  onCreated,
}: {
  connectionId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [publishers, setPublishers] = useState<Publisher[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [friendlyName, setFriendlyName] = useState("");
  const [uniqueName, setUniqueName] = useState("");
  const [uniqueNameTouched, setUniqueNameTouched] = useState(false);
  const [version, setVersion] = useState("1.0.0.0");
  const [publisherId, setPublisherId] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showNewPublisher, setShowNewPublisher] = useState(false);

  function loadPublishers() {
    fetchPublishers(connectionId)
      .then((list) => {
        setPublishers(list);
        if (list.length > 0) setPublisherId((prev) => prev || list[0].publisherid);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(() => {
    loadPublishers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const selectedPublisher = publishers?.find((p) => p.publisherid === publisherId);

  function handleFriendlyNameChange(value: string) {
    setFriendlyName(value);
    if (!uniqueNameTouched && selectedPublisher) {
      setUniqueName(suggestSchemaName(selectedPublisher.customizationprefix, value));
    }
  }

  async function handleSubmit() {
    if (!friendlyName.trim() || !uniqueName.trim() || !publisherId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createSolution(connectionId, { uniqueName: uniqueName.trim(), friendlyName: friendlyName.trim(), version, publisherId, description });
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
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">新建 Solution</h3>

        <div className="space-y-3">
          {loadError && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{loadError}</p>}

          <div>
            <label className={labelCls}>显示名称</label>
            <input value={friendlyName} onChange={(e) => handleFriendlyNameChange(e.target.value)} className={inputCls} placeholder="My Solution" />
          </div>
          <div>
            <label className={labelCls}>唯一名称（Unique Name）</label>
            <input
              value={uniqueName}
              onChange={(e) => {
                setUniqueName(e.target.value);
                setUniqueNameTouched(true);
              }}
              className={inputCls}
              placeholder="publisherprefix_MySolution"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={labelCls}>Publisher</label>
              <button type="button" onClick={() => setShowNewPublisher(true)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                + 新建 Publisher
              </button>
            </div>
            {publishers === null ? (
              <p className="text-xs text-gray-400">加载中…</p>
            ) : publishers.length === 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">这个环境没有任何 publisher，先创建一个。</p>
            ) : (
              <select value={publisherId} onChange={(e) => setPublisherId(e.target.value)} className={inputCls}>
                {publishers.map((p) => (
                  <option key={p.publisherid} value={p.publisherid}>
                    {p.friendlyname} ({p.customizationprefix})
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className={labelCls}>版本号</label>
            <input value={version} onChange={(e) => setVersion(e.target.value)} className={inputCls} placeholder="1.0.0.0" />
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
            disabled={!friendlyName.trim() || !uniqueName.trim() || !publisherId || submitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "创建中…" : "创建"}
          </button>
        </div>
      </div>

      {showNewPublisher && (
        <NewPublisherDialog
          connectionId={connectionId}
          onClose={() => setShowNewPublisher(false)}
          onCreated={() => {
            setShowNewPublisher(false);
            loadPublishers();
          }}
        />
      )}
    </div>
  );
}
