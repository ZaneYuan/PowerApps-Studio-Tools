import { useEffect, useRef } from "react";
import { useActiveConnection } from "../native/activeConnection";
import { useTabManager, type TabInstance } from "../native/tabs";
import { getToolById } from "../tools/registry";
import { useConfirmDialog } from "../shared/ConfirmDialog";
import SvgIcon from "../shared/SvgIcon";

const tabCls = (active: boolean) =>
  `flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm ${
    active
      ? "border-blue-600 font-medium text-blue-700 dark:text-blue-400"
      : "border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200"
  }`;

export default function TabBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { openTabs, activeTabKey, activateTab, closeTabs, activateHome, dirtyTabKeys } = useTabManager();
  const { connections } = useActiveConnection();
  const confirmDialog = useConfirmDialog();
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDetailsElement | null>(null);

  function connectionName(tab: TabInstance): string | null {
    return tab.connectionId ? connections.find((connection) => connection.id === tab.connectionId)?.name ?? null : null;
  }

  function tabLabel(tab: TabInstance): string {
    const toolName = getToolById(tab.toolId)?.name ?? tab.toolId;
    const scopedConnectionName = connectionName(tab);
    return scopedConnectionName ? `${toolName}（${scopedConnectionName}）` : toolName;
  }

  async function confirmAndClose(tabKeys: string[], message: string) {
    const tabsToClose = openTabs.filter((tab) => tabKeys.includes(tab.tabKey));
    const dirtyTabs = tabsToClose.filter((tab) => dirtyTabKeys.has(tab.tabKey));
    if (
      dirtyTabs.length > 0 &&
      !(await confirmDialog({
        title: "关闭标签页",
        message: `${message}，其中 ${dirtyTabs.length} 个标签页有未提交的改动。确定放弃这些改动吗？`,
        detail: dirtyTabs.map(tabLabel),
        confirmLabel: "关闭",
        danger: true,
      }))
    ) {
      return;
    }
    closeTabs(tabKeys);
    if (menuRef.current) menuRef.current.open = false;
  }

  useEffect(() => {
    const activeKey = activeTabKey ?? "home";
    const activeElement = tabStripRef.current?.querySelector<HTMLElement>(`[data-tab-key="${activeKey}"]`);
    activeElement?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabKey]);

  const activeIndex = activeTabKey === null ? -1 : openTabs.findIndex((tab) => tab.tabKey === activeTabKey);
  const tabsToRight = activeIndex >= 0 ? openTabs.slice(activeIndex + 1) : [];
  const otherTabs = activeIndex >= 0 ? openTabs.filter((tab) => tab.tabKey !== activeTabKey) : [];

  return (
    <div className="relative z-30 flex min-w-0 shrink-0 items-stretch border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <button
        onClick={onToggleSidebar}
        className="flex h-10 w-10 shrink-0 items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200 md:hidden"
        aria-label="打开工具导航"
        title="打开工具导航"
      >
        <SvgIcon name="menu" className="h-5 w-5" />
      </button>

      <div ref={tabStripRef} className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button data-tab-key="home" onClick={activateHome} className={tabCls(activeTabKey === null)}>
          <SvgIcon name="app-tools" className="h-4 w-4" />
          工具列表
        </button>
        {openTabs.map((tab) => {
          const tool = getToolById(tab.toolId);
          if (!tool) return null;
          const scopedConnectionName = connectionName(tab);
          const isDirty = dirtyTabKeys.has(tab.tabKey);
          return (
            <div key={tab.tabKey} data-tab-key={tab.tabKey} className={tabCls(activeTabKey === tab.tabKey)}>
              <button onClick={() => activateTab(tab.tabKey)} className="flex min-w-0 items-center gap-1.5">
                <SvgIcon name={tool.icon} className="h-4 w-4" />
                {isDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="有未提交的改动" />}
                <span className="max-w-40 truncate">{tool.name}</span>
                {scopedConnectionName && (
                  <span className="max-w-24 truncate rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-normal text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {scopedConnectionName}
                  </span>
                )}
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void confirmAndClose([tab.tabKey], `关闭“${tabLabel(tab)}”`);
                }}
                className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                title="关闭"
                aria-label={`关闭 ${tabLabel(tab)}`}
              >
                <SvgIcon name="close" className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {openTabs.length > 0 && (
        <details
          ref={menuRef}
          className="relative shrink-0"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }}
        >
          <summary
            className="flex h-10 cursor-pointer list-none items-center gap-1 border-l border-gray-200 px-3 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200 [&::-webkit-details-marker]:hidden"
            aria-label="管理标签页"
            title="管理标签页"
          >
            <SvgIcon name="tabs" className="h-4 w-4" />
            <span className="hidden sm:inline">{openTabs.length}</span>
          </summary>
          <div className="absolute right-1 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <div className="max-h-80 overflow-y-auto p-1">
              {openTabs.map((tab) => {
                const tool = getToolById(tab.toolId);
                if (!tool) return null;
                return (
                  <button
                    key={tab.tabKey}
                    onClick={() => {
                      activateTab(tab.tabKey);
                      if (menuRef.current) menuRef.current.open = false;
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                      activeTabKey === tab.tabKey
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    <SvgIcon name={tool.icon} className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
                    {dirtyTabKeys.has(tab.tabKey) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="有未提交的改动" />}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-1 border-t border-gray-200 p-2 dark:border-gray-700">
              <button
                onClick={() => void confirmAndClose(otherTabs.map((tab) => tab.tabKey), "关闭其他标签页")}
                disabled={otherTabs.length === 0}
                className="rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                关闭其他
              </button>
              <button
                onClick={() => void confirmAndClose(tabsToRight.map((tab) => tab.tabKey), "关闭右侧标签页")}
                disabled={tabsToRight.length === 0}
                className="rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                关闭右侧
              </button>
              <button
                onClick={() => void confirmAndClose(openTabs.map((tab) => tab.tabKey), "关闭全部标签页")}
                className="rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                关闭全部
              </button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
