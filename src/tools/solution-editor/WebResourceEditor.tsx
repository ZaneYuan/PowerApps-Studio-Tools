import { useEffect, useState } from "react";
import {
  decodeBase64Utf8,
  encodeBase64Bytes,
  encodeBase64Utf8,
  fetchWebResource,
  publishSolutionComponents,
  updateWebResource,
  type WebResourceDetail,
} from "./dataverseOps";
import { WEB_RESOURCE_TYPES } from "./componentCatalog";
import ErrorMessage from "../../shared/ErrorMessage";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 read-only:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:read-only:bg-gray-900";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

/** webresourcetype values whose content is text (HTML, CSS, JS, XML, XSL, SVG, RESX). */
const TEXT_TYPES = new Set([1, 2, 3, 4, 9, 11, 12]);

const IMAGE_MIME: Record<number, string> = { 5: "image/png", 6: "image/jpeg", 7: "image/gif", 10: "image/x-icon" };

export default function WebResourceEditor({ connectionId, webResourceId, readOnly }: { connectionId: string; webResourceId: string; readOnly: boolean }) {
  const [detail, setDetail] = useState<WebResourceDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [text, setText] = useState("");
  const [binaryContent, setBinaryContent] = useState("");
  const [dirty, setDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchWebResource(connectionId, webResourceId)
      .then((d) => {
        setDetail(d);
        setDisplayName(d.displayName);
        setDescription(d.description);
        if (TEXT_TYPES.has(d.webResourceType)) setText(decodeBase64Utf8(d.content));
        else setBinaryContent(d.content);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [connectionId, webResourceId]);

  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setSavedMessage(null);
    };
  }

  async function handleFile(file: File | null) {
    if (!file || !detail) return;
    if (TEXT_TYPES.has(detail.webResourceType)) edit(setText)(await file.text());
    else edit(setBinaryContent)(encodeBase64Bytes(new Uint8Array(await file.arrayBuffer())));
  }

  async function save(publish: boolean) {
    if (!detail) return;
    setSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      if (dirty) {
        await updateWebResource(connectionId, webResourceId, {
          displayName: displayName.trim() || detail.name,
          description: description.trim(),
          content: TEXT_TYPES.has(detail.webResourceType) ? encodeBase64Utf8(text) : binaryContent,
        });
        setDirty(false);
      }
      if (publish) {
        try {
          await publishSolutionComponents(connectionId, [], [webResourceId]);
        } catch (err) {
          setSaveError(`已保存，但发布失败：${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      setSavedMessage(publish ? "已保存并发布。" : "已保存（未发布）。");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <ErrorMessage error={loadError} />;
  if (!detail) return <p className="text-xs text-gray-400">加载中…</p>;

  const isText = TEXT_TYPES.has(detail.webResourceType);
  const typeLabel = WEB_RESOURCE_TYPES.find((t) => t.value === detail.webResourceType)?.label ?? `类型 ${detail.webResourceType}`;
  const imageMime = IMAGE_MIME[detail.webResourceType];

  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">{detail.name}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          Web Resource · {typeLabel} · <span className="font-mono">{webResourceId}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>显示名称</label>
          <input value={displayName} readOnly={readOnly} onChange={(e) => edit(setDisplayName)(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>描述</label>
          <input value={description} readOnly={readOnly} onChange={(e) => edit(setDescription)(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className={labelCls}>内容</label>
          {!readOnly && (
            <label className="cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400">
              从本地文件替换…
              <input type="file" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>
        {isText ? (
          <textarea
            value={text}
            readOnly={readOnly}
            onChange={(e) => edit(setText)(e.target.value)}
            spellCheck={false}
            className={`${inputCls} h-[50vh] resize-y font-mono text-xs`}
          />
        ) : imageMime && binaryContent ? (
          <img src={`data:${imageMime};base64,${binaryContent}`} alt={detail.name} className="max-h-64 max-w-full rounded border border-gray-200 dark:border-gray-700" />
        ) : (
          <p className="text-xs text-gray-400">二进制内容，无法在这里预览。</p>
        )}
      </div>

      {saveError && <ErrorMessage error={saveError} />}
      {savedMessage && <p className="text-xs text-green-600 dark:text-green-400">{savedMessage}</p>}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => void save(false)}
            disabled={saving || !dirty}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            onClick={() => void save(true)}
            disabled={saving}
            className="rounded-md border border-purple-300 px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50 dark:border-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/20"
          >
            {dirty ? "保存并发布" : "发布此 Web Resource"}
          </button>
          {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">有未保存的修改</span>}
        </div>
      )}
    </div>
  );
}
