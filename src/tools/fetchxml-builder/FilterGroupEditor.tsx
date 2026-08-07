import {
  OPERATOR_LABELS,
  VALUELESS_OPERATORS,
  newCondition,
  newFilterGroup,
  type Condition,
  type ConditionOperator,
  type FilterGroup,
} from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={condition.attribute}
        onChange={(e) => onChange({ ...condition, attribute: e.target.value })}
        placeholder="字段名"
        className={`${inputCls} w-40`}
      />
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionOperator })}
        className={inputCls}
      >
        {(Object.keys(OPERATOR_LABELS) as ConditionOperator[]).map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>
      {!VALUELESS_OPERATORS.includes(condition.operator) && (
        <input
          type="text"
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          placeholder="值"
          className={`${inputCls} min-w-32 flex-1`}
        />
      )}
      <button onClick={onRemove} className="text-xs text-gray-400 hover:text-red-500">
        ✕
      </button>
    </div>
  );
}

export default function FilterGroupEditor({
  group,
  onChange,
  onRemove,
  depth = 0,
}: {
  group: FilterGroup;
  onChange: (g: FilterGroup) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  function updateCondition(id: string, updated: Condition) {
    onChange({ ...group, conditions: group.conditions.map((c) => (c.id === id ? updated : c)) });
  }
  function removeCondition(id: string) {
    onChange({ ...group, conditions: group.conditions.filter((c) => c.id !== id) });
  }
  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, newCondition()] });
  }
  function updateNestedGroup(id: string, updated: FilterGroup) {
    onChange({ ...group, groups: group.groups.map((g) => (g.id === id ? updated : g)) });
  }
  function removeNestedGroup(id: string) {
    onChange({ ...group, groups: group.groups.filter((g) => g.id !== id) });
  }
  function addNestedGroup() {
    onChange({ ...group, groups: [...group.groups, newFilterGroup()] });
  }

  return (
    <div
      className={`space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800 ${
        depth > 0 ? "bg-gray-50 dark:bg-gray-900/50" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs dark:border-gray-600">
          {(["and", "or"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ ...group, type: t })}
              className={`px-2 py-1 font-medium uppercase ${
                group.type === t
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {onRemove && depth > 0 && (
          <button onClick={onRemove} className="text-xs text-red-500 hover:underline">
            删除这组
          </button>
        )}
      </div>

      <div className="space-y-2">
        {group.conditions.map((c) => (
          <ConditionRow
            key={c.id}
            condition={c}
            onChange={(updated) => updateCondition(c.id, updated)}
            onRemove={() => removeCondition(c.id)}
          />
        ))}
      </div>

      {group.groups.map((g) => (
        <FilterGroupEditor
          key={g.id}
          group={g}
          onChange={(updated) => updateNestedGroup(g.id, updated)}
          onRemove={() => removeNestedGroup(g.id)}
          depth={depth + 1}
        />
      ))}

      <div className="flex gap-3">
        <button
          onClick={addCondition}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          + 添加条件
        </button>
        <button
          onClick={addNestedGroup}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          + 添加嵌套分组
        </button>
      </div>
    </div>
  );
}
