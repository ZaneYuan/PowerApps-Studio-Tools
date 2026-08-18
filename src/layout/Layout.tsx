import { useTabManager } from "../native/tabs";
import { getToolById } from "../tools/registry";
import Home from "../pages/Home";
import ErrorBoundary from "../shared/ErrorBoundary";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import ToolPanel from "./ToolPanel";

export default function Layout() {
  const { openTabs, activeTabKey } = useTabManager();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-800 md:block">
        <Sidebar />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TabBar />
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
