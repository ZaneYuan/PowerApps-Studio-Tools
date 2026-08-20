import { useState } from "react";
import { createColumn, suggestSchemaName, type NewColumnParams } from "./dataverseOps";
import { COLUMN_TYPE_LABELS, type BasicColumnType } from "./types";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";
const COLUMN_TYPES = Object.keys(COLUMN_TYPE_LABELS) as BasicColumnType[];

export default function NewColumnDialog({
  connectionId,
  solutionUniqueName,
  entityLogicalName,
  publisherPrefix,
  onClose,
  onCreated,
}: {
  connectionId: string;
  solutionUniqueName: string;
  entityLogicalName: string;
  publisherPrefix: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<BasicColumnType>("String");
  const [displayName, setDisplayName] = useState("");
  const [schemaName, setSchemaName] = useState("");
  const [schemaNameTouched, setSchemaNameTouched] = useState(false);
  const [required, setRequired] = useState(false);
  const [description, setDescription] = useState("");

  const [maxLength, setMaxLength] = useState(100);
  const [minValue, setMinValue] = useState(0);
  const [maxValue, setMaxValue] = useState(100);
  const [precision, setPrecision] = useState(2);
  const [dateFormat, setDateFormat] = useState<"DateOnly" | "DateAndTime">("DateOnly");
  const [trueLabel, setTrueLabel] = useState("是");
  const [falseLabel, setFalseLabel] = useState("否");
  const [options, setOptions] = useState<string[]>([""]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleDisplayNameChange(value: string) {
    setDisplayName(value);
    if (!schemaNameTouched) setSchemaName(suggestSchemaName(publisherPrefix, value));
  }

  async function handleSubmit() {
    if (!displayName.trim() || !schemaName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    const params: NewColumnParams = {
      schemaName: schemaName.trim(),
      displayName: displayName.trim(),
      description,
      required,
      maxLength: type === "String" || type === "Memo" ? maxLength : undefined,
      minValue: type === "Integer" || type === "Decimal" ? minValue : undefined,
      maxValue: type === "Integer" || type === "Decimal" ? maxValue : undefined,
      precision: type === "Decimal" ? precision : undefined,
      dateFormat: type === "DateTime" ? dateFormat : undefined,
      trueLabel: type === "Boolean" ? trueLabel : undefined,
      falseLabel: type === "Boolean" ? falseLabel : undefined,
      options: type === "Picklist" ? options.map((o) => o.trim()).filter(Boolean) : undefined,
    };
    try {
      await createColumn(connectionId, solutionUniqueName, entityLogicalName, type, params);
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = displayName.trim() && schemaName.trim() && (type !== "Picklist" || options.some((o) => o.trim()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">新建字段 · {entityLogicalName}</h3>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>类型</label>
            <select value={type} onChange={(e) => setType(e.target.value as BasicColumnType)} className={inputCls}>
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COLUMN_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>显示名称</label>
            <input value={displayName} onChange={(e) => handleDisplayNameChange(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>SchemaName（含 publisher 前缀，创建后不可改）</label>
            <input
              value={schemaName}
              onChange={(e) => {
                setSchemaName(e.target.value);
                setSchemaNameTouched(true);
              }}
              className={`${inputCls} font-mono`}
            />
          </div>

          {(type === "String" || type === "Memo") && (
            <div>
              <label className={labelCls}>最大长度</label>
              <input type="number" min={1} value={maxLength} onChange={(e) => setMaxLength(Number(e.target.value) || 1)} className={inputCls} />
            </div>
          )}

          {(type === "Integer" || type === "Decimal") && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>最小值</label>
                <input type="number" value={minValue} onChange={(e) => setMinValue(Number(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>最大值</label>
                <input type="number" value={maxValue} onChange={(e) => setMaxValue(Number(e.target.value))} className={inputCls} />
              </div>
            </div>
          )}
          {type === "Decimal" && (
            <div>
              <label className={labelCls}>小数位数</label>
              <input type="number" min={0} max={10} value={precision} onChange={(e) => setPrecision(Number(e.target.value) || 0)} className={inputCls} />
            </div>
          )}
          {type === "DateTime" && (
            <div>
              <label className={labelCls}>格式</label>
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as "DateOnly" | "DateAndTime")} className={inputCls}>
                <option value="DateOnly">仅日期</option>
                <option value="DateAndTime">日期和时间</option>
              </select>
            </div>
          )}
          {type === "Boolean" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>"是"标签</label>
                <input value={trueLabel} onChange={(e) => setTrueLabel(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>"否"标签</label>
                <input value={falseLabel} onChange={(e) => setFalseLabel(e.target.value)} className={inputCls} />
              </div>
            </div>
          )}
          {type === "Picklist" && (
            <div>
              <label className={labelCls}>选项（只需填标签，编号由 Dataverse 自动分配）</label>
              <div className="space-y-1.5">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      value={opt}
                      onChange={(e) => setOptions((os) => os.map((o, j) => (j === i ? e.target.value : o)))}
                      className={inputCls}
                      placeholder={`选项 ${i + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}
                      disabled={options.length === 1}
                      className="shrink-0 rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOptions((os) => [...os, ""])}
                className="mt-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                + 添加选项
              </button>
            </div>
          )}

          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            必填（Business Required）
          </label>

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
