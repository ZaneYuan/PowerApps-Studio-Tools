import { useActiveConnection } from "../native/activeConnection";
import { useTabManager } from "../native/tabs";
import { getToolById } from "../tools/registry";

const tabCls = (active: boolean) =>
  `flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm ${
    active
      ? "border-blue-600 font-medium text-blue-700 dark:text-blue-400"
      : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
  }`;

export default function TabBar() {
  const { openTabs, activeTabKey, activateTab, closeTab, activateHome, dirtyTabKeys } = useTabManager();
  const { connections } = useActiveConnection();

  return (
    <div className="flex flex-wrap items-center border-b border-gray-200 bg-white px-2 dark:border-gray-800 dark:bg-gray-950">
      <button onClick={activateHome} className={tabCls(activeTabKey === null)}>
        🧰 工具列表
      </button>
      {openTabs.map((tab) => {
        const tool = getToolById(tab.toolId);
        if (!tool) return null;
        const connectionName = tab.connectionId ? connections.find((c) => c.id === tab.connectionId)?.name : null;
        const isDirty = dirtyTabKeys.has(tab.tabKey);
        return (
          <div key={tab.tabKey} className={`group ${tabCls(activeTabKey === tab.tabKey)}`}>
            <button onClick={() => activateTab(tab.tabKey)} className="flex items-center gap-1.5">
              <span>{tool.icon}</span>
              {isDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="有未提交的改动" />}
              <span className="max-w-[14rem] truncate">
                {tool.name}
                {connectionName && <span className="text-gray-400">（{connectionName}）</span>}
              </span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isDirty && !confirm("该 Tab 有未提交的改动，关闭将放弃这些改动，确定关闭吗？")) return;
                closeTab(tab.tabKey);
              }}
              className="ml-1 rounded px-1 text-xs text-gray-400 opacity-0 hover:bg-gray-200 hover:text-gray-700 group-hover:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title="关闭"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
