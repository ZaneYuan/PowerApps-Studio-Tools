import { useEffect, useState } from "react";
import AttributePicker from "../../shared/AttributePicker";
import { fetchEntityAttributes, fetchImageDetail, fetchStepDetail, registerImage, updateImage } from "./dataverseOps";
import { IMAGE_TYPE_LABELS } from "./types";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

/** Message parameter an image attaches to — "Target" for virtually every message except the
 *  Delete family, which uses "EntityMoniker" instead. Not a user-facing field (XrmToolBox
 *  doesn't expose it either): computed from the step's message and left alone. */
function defaultMessageProperty(messageName: string): string {
  return messageName.toLowerCase().includes("delete") ? "EntityMoniker" : "Target";
}

interface ImageRegisterDialogProps {
  connectionId: string;
  stepId: string;
  /** Needed to pick the right default messagePropertyName when creating. */
  messageName: string;
  /** Needed to fetch the field-picker options; null falls back to a free-text field list. */
  primaryEntity: string | null;
  editImageId?: string;
  onClose: () => void;
  /** `newImageId` is only set for an edit — updateImage deletes and re-registers the record (see
   *  its own doc comment for why), so a caller tracking the edited image by its old id needs the
   *  new one to keep pointing at a record that still exists. */
  onSaved: (newImageId?: string) => void;
}

export default function ImageRegisterDialog({
  connectionId,
  stepId,
  messageName,
  primaryEntity,
  editImageId,
  onClose,
  onSaved,
}: ImageRegisterDialogProps) {
  const isEdit = !!editImageId;

  const [alias, setAlias] = useState("");
  const [imageType, setImageType] = useState(0);
  const [messagePropertyName, setMessagePropertyName] = useState(() => defaultMessageProperty(messageName));
  const [attributesText, setAttributesText] = useState("");
  const [selectedAttributes, setSelectedAttributes] = useState<Set<string>>(new Set());
  const [attributeOptions, setAttributeOptions] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (primaryEntity) {
      fetchEntityAttributes(connectionId, primaryEntity)
        .then(setAttributeOptions)
        .catch(() => setAttributeOptions([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, primaryEntity]);

  useEffect(() => {
    if (!editImageId) return;
    setEditLoading(true);
    setEditError(null);
    fetchImageDetail(connectionId, editImageId)
      .then(async (d) => {
        setAlias(d.entityalias);
        setImageType(d.imagetype);
        setMessagePropertyName(d.messagepropertyname);
        const attrs = (d.attributes ?? "").split(",").map((a) => a.trim()).filter(Boolean);
        setSelectedAttributes(new Set(attrs));
        setAttributesText(d.attributes ?? "");

        // The image record itself doesn't carry its parent step's entity — only needed here
        // (edit mode) since create mode already gets it as a prop from the tree's step row.
        if (!primaryEntity && d._sdkmessageprocessingstepid_value) {
          const step = await fetchStepDetail(connectionId, d._sdkmessageprocessingstepid_value).catch(() => null);
          const entity = step?.sdkmessagefilterid?.primaryobjecttypecode;
          if (entity) {
            const opts = await fetchEntityAttributes(connectionId, entity).catch(() => []);
            setAttributeOptions(opts);
          }
        }
      })
      .catch((err) => setEditError(err instanceof Error ? err.message : String(err)))
      .finally(() => setEditLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editImageId]);

  function toggleAttribute(name: string) {
    setSelectedAttributes((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAllAttributes(selectAll: boolean) {
    setSelectedAttributes(selectAll && attributeOptions ? new Set(attributeOptions) : new Set());
  }

  async function handleSubmit() {
    if (!alias.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    const attributes = attributeOptions ? Array.from(selectedAttributes).join(",") : attributesText;
    try {
      if (isEdit && editImageId) {
        const updated = await updateImage(connectionId, editImageId, stepId, {
          alias: alias.trim(),
          imageType,
          messagePropertyName,
          attributes,
        });
        onSaved(updated.sdkmessageprocessingstepimageid);
      } else {
        await registerImage(connectionId, {
          stepId,
          alias: alias.trim(),
          imageType,
          messagePropertyName,
          attributes,
        });
        onSaved();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {isEdit ? "编辑 Image" : "注册 Image"}
        </h3>

        {isEdit && editLoading && <p className="text-xs text-gray-400">加载中…</p>}
        {isEdit && editError && <p className="text-xs text-red-600 dark:text-red-400">{editError}</p>}

        {(!isEdit || (!editLoading && !editError)) && (
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

            {attributeOptions && attributeOptions.length > 0 ? (
              <AttributePicker
                label="Attributes（不勾选 = 全部字段）"
                options={attributeOptions}
                selected={selectedAttributes}
                onToggle={toggleAttribute}
                onToggleAll={toggleAllAttributes}
              />
            ) : (
              <div>
                <label className={labelCls}>Attributes（逗号分隔，留空 = 全部字段）</label>
                <input
                  type="text"
                  value={attributesText}
                  onChange={(e) => setAttributesText(e.target.value)}
                  placeholder="name,revenue"
                  className={inputCls}
                />
              </div>
            )}

            {submitError && (
              <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                {submitError}
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!alias.trim() || submitting || (isEdit && editLoading)}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "保存中…" : isEdit ? "保存" : "注册 Image"}
          </button>
        </div>
      </div>
    </div>
  );
}
