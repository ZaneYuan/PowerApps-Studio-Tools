import { tools, getCategories } from "../tools/registry";
import { useActiveConnection } from "../native/activeConnection";
import { useTabManager } from "../native/tabs";
import ConnectionSwitcher from "./ConnectionSwitcher";

export default function Sidebar() {
  const categories = getCategories();
  const { activeConnectionId } = useActiveConnection();
  const { openTabs, activeTabKey, openTab, activateHome } = useTabManager();
  const activeToolId = openTabs.find((t) => t.tabKey === activeTabKey)?.toolId ?? null;

  return (
    <nav className="flex h-full flex-col overflow-y-auto">
      <button onClick={activateHome} className="flex items-center gap-2 px-4 pb-1 pt-4 text-left">
        <span className="text-xl">🧰</span>
        <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Power Apps Studio & Tools
        </span>
      </button>

      <ConnectionSwitcher />

      <div className="flex flex-col gap-6 p-4">
        {categories.map((category) => (
          <div key={category}>
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {category}
            </div>
            <ul className="mt-2 space-y-1">
              {tools
                .filter((t) => t.category === category)
                .map((tool) => (
                  <li key={tool.id}>
                    <button
                      onClick={() => openTab(tool.id, tool.connectionScoped === false ? null : activeConnectionId)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                        activeToolId === tool.id
                          ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span>{tool.icon}</span>
                      <span>{tool.name}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
