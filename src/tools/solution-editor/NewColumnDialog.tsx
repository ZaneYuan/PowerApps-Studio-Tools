import { useEffect, useState } from "react";
import {
  createColumn,
  createColumnWithGlobalChoice,
  createLookupColumn,
  fetchAllEntitiesForPicker,
  fetchGlobalOptionSets,
  suggestSchemaName,
  type GlobalOptionSetSummary,
  type NewColumnParams,
  type PickableEntity,
} from "./dataverseOps";
import { COLUMN_TYPE_LABELS, type BasicColumnType } from "./types";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";
const COLUMN_TYPES = Object.keys(COLUMN_TYPE_LABELS) as BasicColumnType[];
/** "Lookup" isn't a BasicColumnType (see types.ts's own doc comment on why) — it's a UI-only
 *  addition to this dialog's type dropdown, routed to createLookupColumn instead of createColumn. */
type DialogColumnType = BasicColumnType | "Lookup";

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
  const [type, setType] = useState<DialogColumnType>("String");
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

  // Picklist only: use an existing global choice instead of defining local options.
  const [useGlobalChoice, setUseGlobalChoice] = useState(false);
  const [globalOptionSets, setGlobalOptionSets] = useState<GlobalOptionSetSummary[] | null>(null);
  const [globalOptionSetId, setGlobalOptionSetId] = useState("");

  // Lookup only: the target ("one" side) table.
  const [allEntities, setAllEntities] = useState<PickableEntity[] | null>(null);
  const [referencedEntity, setReferencedEntity] = useState("");
  const [relationshipSchemaName, setRelationshipSchemaName] = useState("");
  const [relationshipSchemaNameTouched, setRelationshipSchemaNameTouched] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (type === "Lookup" && !allEntities) {
      fetchAllEntitiesForPicker(connectionId)
        .then(setAllEntities)
        .catch((err) => setSubmitError(err instanceof Error ? err.message : String(err)));
    }
    if (type === "Picklist" && useGlobalChoice && !globalOptionSets) {
      fetchGlobalOptionSets(connectionId)
        .then(setGlobalOptionSets)
        .catch((err) => setSubmitError(err instanceof Error ? err.message : String(err)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, useGlobalChoice]);

  function handleDisplayNameChange(value: string) {
    setDisplayName(value);
    if (!schemaNameTouched) setSchemaName(suggestSchemaName(publisherPrefix, value));
    if (!relationshipSchemaNameTouched && referencedEntity) {
      setRelationshipSchemaName(suggestSchemaName(publisherPrefix, `${referencedEntity}_${value}`));
    }
  }

  function handleReferencedEntityChange(value: string) {
    setReferencedEntity(value);
    if (!relationshipSchemaNameTouched && displayName) {
      setRelationshipSchemaName(suggestSchemaName(publisherPrefix, `${value}_${displayName}`));
    }
  }

  async function handleSubmit() {
    if (!displayName.trim() || !schemaName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (type === "Lookup") {
        if (!referencedEntity || !relationshipSchemaName.trim()) {
          setSubmitError("请选择目标表，并填写关系的 SchemaName。");
          setSubmitting(false);
          return;
        }
        await createLookupColumn(connectionId, solutionUniqueName, {
          schemaName: schemaName.trim(),
          displayName: displayName.trim(),
          description,
          required,
          referencedEntity,
          referencingEntity: entityLogicalName,
          relationshipSchemaName: relationshipSchemaName.trim(),
        });
      } else if (type === "Picklist" && useGlobalChoice) {
        if (!globalOptionSetId) {
          setSubmitError("请选择一个已有的全局选项集。");
          setSubmitting(false);
          return;
        }
        const params: NewColumnParams = { schemaName: schemaName.trim(), displayName: displayName.trim(), description, required };
        await createColumnWithGlobalChoice(connectionId, solutionUniqueName, entityLogicalName, globalOptionSetId, params);
      } else {
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
          options: type === "Picklist" || type === "MultiSelectPicklist" ? options.map((o) => o.trim()).filter(Boolean) : undefined,
        };
        await createColumn(connectionId, solutionUniqueName, entityLogicalName, type, params);
      }
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    displayName.trim() &&
    schemaName.trim() &&
    ((type !== "Picklist" && type !== "MultiSelectPicklist") || useGlobalChoice || options.some((o) => o.trim())) &&
    (type !== "Picklist" || !useGlobalChoice || !!globalOptionSetId) &&
    (type !== "Lookup" || (!!referencedEntity && !!relationshipSchemaName.trim()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">新建字段 · {entityLogicalName}</h3>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>类型</label>
            <select value={type} onChange={(e) => setType(e.target.value as DialogColumnType)} className={inputCls}>
              <option value="Lookup">查找（Lookup）</option>
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

          {type === "Lookup" && (
            <>
              <div>
                <label className={labelCls}>目标表（这个查找字段指向哪张表）</label>
                {!allEntities ? (
                  <p className="text-xs text-gray-400">加载表列表中…</p>
                ) : (
                  <select value={referencedEntity} onChange={(e) => handleReferencedEntityChange(e.target.value)} className={inputCls}>
                    <option value="">-- 选择目标表 --</option>
                    {allEntities.map((en) => (
                      <option key={en.logicalName} value={en.logicalName}>
                        {en.displayName} ({en.logicalName})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className={labelCls}>关系 SchemaName（1:N 关系自己的名字，创建后不可改）</label>
                <input
                  value={relationshipSchemaName}
                  onChange={(e) => {
                    setRelationshipSchemaName(e.target.value);
                    setRelationshipSchemaNameTouched(true);
                  }}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
                级联行为固定为安全默认值：删除目标表的记录只会清空这个查找字段（不会级联删除这张表上的记录）。
              </p>
            </>
          )}

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
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={useGlobalChoice} onChange={(e) => setUseGlobalChoice(e.target.checked)} />
              使用已有的全局选项集（而不是新建本地选项）
            </label>
          )}
          {type === "Picklist" && useGlobalChoice && (
            <div>
              <label className={labelCls}>全局选项集</label>
              {!globalOptionSets ? (
                <p className="text-xs text-gray-400">加载中…</p>
              ) : globalOptionSets.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">这个环境还没有任何全局选项集。</p>
              ) : (
                <select value={globalOptionSetId} onChange={(e) => setGlobalOptionSetId(e.target.value)} className={inputCls}>
                  <option value="">-- 选择 --</option>
                  {globalOptionSets.map((o) => (
                    <option key={o.metadataId} value={o.metadataId}>
                      {o.displayName} ({o.name})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {(type === "MultiSelectPicklist" || (type === "Picklist" && !useGlobalChoice)) && (
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
