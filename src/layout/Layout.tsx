import { useState } from "react";
import { useTabManager } from "../native/tabs";
import { getToolById } from "../tools/registry";
import Home from "../pages/Home";
import ErrorBoundary from "../shared/ErrorBoundary";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import ToolPanel from "./ToolPanel";
import SvgIcon from "../shared/SvgIcon";
import Dialog from "../shared/Dialog";

export default function Layout() {
  const { openTabs, activeTabKey } = useTabManager();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-800 md:block">
        <Sidebar />
      </aside>
      {mobileSidebarOpen && (
        <Dialog
          ariaLabel="工具导航"
          onClose={() => setMobileSidebarOpen(false)}
          closeOnBackdrop
          overlayClassName="fixed inset-0 z-50 bg-black/40 md:hidden"
          panelClassName="relative h-full w-72 max-w-[85vw] overflow-y-auto border-r border-gray-200 bg-gray-50 shadow-2xl dark:border-gray-800 dark:bg-gray-950"
        >
          <aside>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              aria-label="关闭工具导航"
              title="关闭"
            >
              <SvgIcon name="close" className="h-4 w-4" />
            </button>
            <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
          </aside>
        </Dialog>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TabBar onToggleSidebar={() => setMobileSidebarOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto p-6 md:p-10">
          <div style={{ display: activeTabKey === null ? "block" : "none" }}>
            <Home />
          </div>
          {openTabs.map((tab) => {
            const tool = getToolById(tab.toolId);
            if (!tool) return null;
            return (
              <div key={tab.tabKey} style={{ display: activeTabKey === tab.tabKey ? "block" : "none" }}>
                <ErrorBoundary label={tool.name}>
                  <ToolPanel tool={tool} tabKey={tab.tabKey} connectionId={tab.connectionId} />
                </ErrorBoundary>
              </div>
            );
          })}
        </main>
      </div>
    </div>
  );
}
