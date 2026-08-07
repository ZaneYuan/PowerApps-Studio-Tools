import { useMemo, useState } from "react";
import { buildFilter, validateConditions } from "./build";
import {
  FUNCTION_OPERATORS,
  OPERATOR_LABELS,
  VALUELESS_OPERATORS,
  VALUE_TYPE_LABELS,
  type Condition,
  type ConditionGroup,
  type LogicOp,
  type Operator,
  type ValueType,
} from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

function newCondition(): Condition {
  return {
    id: crypto.randomUUID(),
    field: "",
    operator: "eq",
    valueType: "string",
    value: "",
  };
}

function newGroup(): ConditionGroup {
  return { id: crypto.randomUUID(), logic: "and", conditions: [newCondition()] };
}

function LogicToggle({
  value,
  onChange,
}: {
  value: LogicOp;
  onChange: (v: LogicOp) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs dark:border-gray-600">
      {(["and", "or"] as const).map((op) => (
        <button
          key={op}
          type="button"
          onClick={() => onChange(op)}
          className={`px-2 py-1 font-medium uppercase ${
            value === op
              ? "bg-blue-600 text-white"
              : "bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          {op}
        </button>
      ))}
    </div>
  );
}

function ValueInput({ condition, onChange }: { condition: Condition; onChange: (v: string) => void }) {
  if (VALUELESS_OPERATORS.includes(condition.operator)) return null;

  if (condition.valueType === "boolean" && !FUNCTION_OPERATORS.includes(condition.operator)) {
    return (
      <select value={condition.value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">选择值…</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (condition.valueType === "date" && !FUNCTION_OPERATORS.includes(condition.operator)) {
    return (
      <input
        type="datetime-local"
        value={condition.value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    );
  }

  return (
    <input
      type="text"
      value={condition.value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="值"
      className={`${inputCls} flex-1`}
    />
  );
}

export default function OdataFilterBuilder() {
  const [topLogic, setTopLogic] = useState<LogicOp>("and");
  const [groups, setGroups] = useState<ConditionGroup[]>([newGroup()]);

  const filter = useMemo(() => buildFilter(groups, topLogic), [groups, topLogic]);
  const warnings = useMemo(() => validateConditions(groups), [groups]);

  function updateGroup(groupId: string, patch: Partial<ConditionGroup>) {
    setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));
  }

  function updateCondition(groupId: string, condId: string, patch: Partial<Condition>) {
    setGroups((gs) =>
      gs.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              conditions: g.conditions.map((c) => (c.id === condId ? { ...c, ...patch } : c)),
            },
      ),
    );
  }

  function addCondition(groupId: string) {
    updateGroup(groupId, {
      conditions: [...groups.find((g) => g.id === groupId)!.conditions, newCondition()],
    });
  }

  function removeCondition(groupId: string, condId: string) {
    const g = groups.find((g) => g.id === groupId)!;
    if (g.conditions.length === 1) {
      setGroups((gs) => gs.filter((x) => x.id !== groupId));
      return;
    }
    updateGroup(groupId, { conditions: g.conditions.filter((c) => c.id !== condId) });
  }

  function addGroup() {
    setGroups((gs) => [...gs, newGroup()]);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span>共 {groups.length} 组条件</span>
        {groups.length > 1 && (
          <>
            <span>·组间关系</span>
            <LogicToggle value={topLogic} onChange={setTopLogic} />
          </>
        )}
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <div
            key={group.id}
            className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>组内关系</span>
                <LogicToggle
                  value={group.logic}
                  onChange={(v) => updateGroup(group.id, { logic: v })}
                />
              </div>
              {groups.length > 1 && (
                <button
                  type="button"
                  onClick={() => setGroups((gs) => gs.filter((g) => g.id !== group.id))}
                  className="text-xs text-red-500 hover:underline"
                >
                  删除整组
                </button>
              )}
            </div>

            <div className="space-y-2">
              {group.conditions.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={c.field}
                    onChange={(e) => updateCondition(group.id, c.id, { field: e.target.value })}
                    placeholder="字段名 (schema name)"
                    className={`${inputCls} w-44`}
                  />
                  <select
                    value={c.operator}
                    onChange={(e) => {
                      const operator = e.target.value as Operator;
                      const valueType = FUNCTION_OPERATORS.includes(operator)
                        ? ("string" as ValueType)
                        : c.valueType;
                      updateCondition(group.id, c.id, { operator, valueType });
                    }}
                    className={inputCls}
                  >
                    {(Object.keys(OPERATOR_LABELS) as Operator[]).map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>

                  {!FUNCTION_OPERATORS.includes(c.operator) &&
                    !VALUELESS_OPERATORS.includes(c.operator) && (
                      <select
                        value={c.valueType}
                        onChange={(e) =>
                          updateCondition(group.id, c.id, {
                            valueType: e.target.value as ValueType,
                            value: "",
                          })
                        }
                        className={inputCls}
                      >
                        {(Object.keys(VALUE_TYPE_LABELS) as ValueType[]).map((vt) => (
                          <option key={vt} value={vt}>
                            {VALUE_TYPE_LABELS[vt]}
                          </option>
                        ))}
                      </select>
                    )}

                  <ValueInput
                    condition={c}
                    onChange={(v) => updateCondition(group.id, c.id, { value: v })}
                  />

                  <button
                    type="button"
                    onClick={() => removeCondition(group.id, c.id)}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => addCondition(group.id)}
              className="mt-3 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              + 添加条件
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addGroup}
        className="rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:text-gray-400"
      >
        + 添加一组条件
      </button>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          {warnings.map((w, i) => (
            <div key={i}>⚠ {w.message}</div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            $filter 输出
          </span>
          {filter && (
            <button
              onClick={() => navigator.clipboard.writeText(filter)}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              复制
            </button>
          )}
        </div>
        <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          {filter || "（暂无有效条件）"}
        </pre>

        {filter && (
          <p className="mt-2 break-all text-xs text-gray-400">
            示例：GET [organization uri]/api/data/v9.2/&#123;entity set&#125;?$filter=
            {encodeURIComponent(filter)}
          </p>
        )}
      </div>
    </div>
  );
}
