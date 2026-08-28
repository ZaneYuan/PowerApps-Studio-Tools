import { useState } from "react";
import { tools, getCategories, getToolById, isBetaCategory } from "../tools/registry";
import { useActiveConnection } from "../native/activeConnection";
import { useTabManager } from "../native/tabs";
import type { ToolDefinition } from "../tools/types";
import ConnectionSwitcher from "./ConnectionSwitcher";

function ToolButton({ tool, active, onOpen }: { tool: ToolDefinition; active: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
        active
          ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
          : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      }`}
    >
      <span>{tool.icon}</span>
      <span>{tool.name}</span>
    </button>
  );
}

export default function Sidebar() {
  const categories = getCategories();
  const { activeConnectionId } = useActiveConnection();
  const { openTabs, activeTabKey, openTab, activateHome, recentToolIds } = useTabManager();
  const activeToolId = openTabs.find((t) => t.tabKey === activeTabKey)?.toolId ?? null;
  const [search, setSearch] = useState("");

  function handleOpen(tool: ToolDefinition) {
    openTab(tool.id, tool.connectionScoped === false ? null : activeConnectionId);
  }

  const trimmedSearch = search.trim().toLowerCase();
  const searchResults = trimmedSearch
    ? tools.filter((t) => t.name.toLowerCase().includes(trimmedSearch) || t.description.toLowerCase().includes(trimmedSearch))
    : null;
  const recentTools = recentToolIds.map((id) => getToolById(id)).filter((t): t is ToolDefinition => !!t);

  return (
    <nav className="flex h-full flex-col overflow-y-auto">
      <button onClick={activateHome} className="flex items-center gap-2 px-4 pb-1 pt-4 text-left">
        <span className="text-xl">🧰</span>
        <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Power Apps Studio & Tools
        </span>
      </button>

      <ConnectionSwitcher />

      <div className="px-4 pt-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索工具…"
          aria-label="搜索工具"
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <div className="flex flex-col gap-6 p-4">
        {searchResults ? (
          <div>
            {searchResults.length === 0 ? (
              <p className="px-2 text-xs text-gray-400">没有匹配"{search}"的工具。</p>
            ) : (
              <ul className="space-y-1">
                {searchResults.map((tool) => (
                  <li key={tool.id}>
                    <ToolButton tool={tool} active={activeToolId === tool.id} onOpen={() => handleOpen(tool)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            {recentTools.length > 0 && (
              <div>
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  最近使用
                </div>
                <ul className="mt-2 space-y-1">
                  {recentTools.map((tool) => (
                    <li key={tool.id}>
                      <ToolButton tool={tool} active={activeToolId === tool.id} onOpen={() => handleOpen(tool)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {categories.map((category) => (
              <div key={category}>
                <div className="flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  <span>{category}</span>
                  {isBetaCategory(category) && (
                    <span className="rounded bg-amber-100 px-1 py-px text-[10px] font-semibold normal-case tracking-normal text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      beta
                    </span>
                  )}
                </div>
                <ul className="mt-2 space-y-1">
                  {tools
                    .filter((t) => t.category === category)
                    .map((tool) => (
                      <li key={tool.id}>
                        <ToolButton tool={tool} active={activeToolId === tool.id} onOpen={() => handleOpen(tool)} />
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </nav>
  );
}
