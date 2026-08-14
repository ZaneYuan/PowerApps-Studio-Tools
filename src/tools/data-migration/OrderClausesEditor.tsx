import { newOrderClause, type OrderClause } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

export default function OrderClausesEditor({ orders, onChange }: { orders: OrderClause[]; onChange: (orders: OrderClause[]) => void }) {
  function update(id: string, patch: Partial<OrderClause>) {
    onChange(orders.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <div key={o.id} className="flex items-center gap-2">
          <input
            type="text"
            value={o.field}
            onChange={(e) => update(o.id, { field: e.target.value })}
            placeholder="字段名"
            className={`${inputCls} w-44`}
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={o.descending} onChange={(e) => update(o.id, { descending: e.target.checked })} />
            降序
          </label>
          <button
            type="button"
            onClick={() => onChange(orders.filter((x) => x.id !== o.id))}
            className="text-xs text-gray-400 hover:text-red-500"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...orders, newOrderClause()])}
        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        + 添加排序字段
      </button>
    </div>
  );
}
