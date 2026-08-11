import { isNativeBridgeAvailable } from "../native/bridge";
import { useActiveConnection } from "../native/activeConnection";

/** Picks the connection that seeds the *next* tab you open from the sidebar or home page —
 *  deliberately doesn't touch whatever tab is currently focused (that's what each tab's own
 *  connection switcher, rendered inside ToolPanel, is for — see req 3 vs req 4 in the doc
 *  comment there). Labeled "我的连接" rather than "当前连接" because there is no longer a
 *  single connection active for the whole app — each tab has its own. */
export default function ConnectionSwitcher() {
  const { connections, activeConnectionId, setActiveConnectionId } = useActiveConnection();

  if (!isNativeBridgeAvailable()) return null;

  return (
    <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">我的连接</label>
      <select
        value={activeConnectionId ?? ""}
        onChange={(e) => setActiveConnectionId(e.target.value || null)}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        <option value="">未选择</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {connections.length === 0 && (
        <p className="mt-1 text-xs text-gray-400">还没有连接，去"我的连接"里添加一个。</p>
      )}
    </div>
  );
}
