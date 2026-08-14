import {
  FUNCTION_OPERATORS,
  OPERATOR_LABELS,
  VALUELESS_OPERATORS,
  VALUE_TYPE_LABELS,
  newCondition,
  newConditionGroup,
  type Condition,
  type ConditionGroup,
  type LogicOp,
  type Operator,
  type ValueType,
} from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

function LogicToggle({ value, onChange }: { value: LogicOp; onChange: (v: LogicOp) => void }) {
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
    return <input type="datetime-local" value={condition.value} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
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

/** Visual editor for a top-level list of AND/OR'd condition groups — one flat level of grouping,
 *  no nested sub-groups (unlike FetchXML Builder's FilterGroupEditor), since an OData `$filter`
 *  against a single table doesn't need that depth for the "and this group, or that group" shape
 *  most source-query filters actually need. */
export default function ConditionGroupsEditor({
  groups,
  topLogic,
  onGroupsChange,
  onTopLogicChange,
}: {
  groups: ConditionGroup[];
  topLogic: LogicOp;
  onGroupsChange: (groups: ConditionGroup[]) => void;
  onTopLogicChange: (logic: LogicOp) => void;
}) {
  function updateGroup(groupId: string, patch: Partial<ConditionGroup>) {
    onGroupsChange(groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));
  }

  function updateCondition(groupId: string, condId: string, patch: Partial<Condition>) {
    onGroupsChange(
      groups.map((g) =>
        g.id !== groupId ? g : { ...g, conditions: g.conditions.map((c) => (c.id === condId ? { ...c, ...patch } : c)) },
      ),
    );
  }

  function addCondition(groupId: string) {
    updateGroup(groupId, { conditions: [...groups.find((g) => g.id === groupId)!.conditions, newCondition()] });
  }

  function removeCondition(groupId: string, condId: string) {
    const g = groups.find((g) => g.id === groupId)!;
    if (g.conditions.length === 1) {
      onGroupsChange(groups.filter((x) => x.id !== groupId));
      return;
    }
    updateGroup(groupId, { conditions: g.conditions.filter((c) => c.id !== condId) });
  }

  function addGroup() {
    onGroupsChange([...groups, newConditionGroup()]);
  }

  return (
    <div className="space-y-3">
      {groups.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>组间关系</span>
          <LogicToggle value={topLogic} onChange={onTopLogicChange} />
        </div>
      )}

      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.id} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>组内关系</span>
                <LogicToggle value={group.logic} onChange={(v) => updateGroup(group.id, { logic: v })} />
              </div>
              {groups.length > 1 && (
                <button
                  type="button"
                  onClick={() => onGroupsChange(groups.filter((g) => g.id !== group.id))}
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
                      const valueType = FUNCTION_OPERATORS.includes(operator) ? ("string" as ValueType) : c.valueType;
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

                  {!FUNCTION_OPERATORS.includes(c.operator) && !VALUELESS_OPERATORS.includes(c.operator) && (
                    <select
                      value={c.valueType}
                      onChange={(e) => updateCondition(group.id, c.id, { valueType: e.target.value as ValueType, value: "" })}
                      className={inputCls}
                    >
                      {(Object.keys(VALUE_TYPE_LABELS) as ValueType[]).map((vt) => (
                        <option key={vt} value={vt}>
                          {VALUE_TYPE_LABELS[vt]}
                        </option>
                      ))}
                    </select>
                  )}

                  <ValueInput condition={c} onChange={(v) => updateCondition(group.id, c.id, { value: v })} />

                  <button type="button" onClick={() => removeCondition(group.id, c.id)} className="text-xs text-gray-400 hover:text-red-500">
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => addCondition(group.id)}
              className="mt-2 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
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
    </div>
  );
}
