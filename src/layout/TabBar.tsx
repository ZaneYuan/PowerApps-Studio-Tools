import { useTabManager } from "../native/tabs";
import { getToolById } from "../tools/registry";

const tabCls = (active: boolean) =>
  `flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm ${
    active
      ? "border-blue-600 font-medium text-blue-700 dark:text-blue-400"
      : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
  }`;

export default function TabBar() {
  const { openTabs, activeTabId, openTab, closeTab, activateHome } = useTabManager();

  return (
    <div className="flex items-center overflow-x-auto border-b border-gray-200 bg-white px-2 dark:border-gray-800 dark:bg-gray-950">
      <button onClick={activateHome} className={tabCls(activeTabId === null)}>
        🧰 工具列表
      </button>
      {openTabs.map((id) => {
        const tool = getToolById(id);
        if (!tool) return null;
        return (
          <div key={id} className={`group ${tabCls(activeTabId === id)}`}>
            <button onClick={() => openTab(id)} className="flex items-center gap-1.5">
              <span>{tool.icon}</span>
              <span className="max-w-[10rem] truncate">{tool.name}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(id);
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
