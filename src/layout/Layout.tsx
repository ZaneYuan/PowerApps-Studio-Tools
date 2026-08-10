import { useTabManager } from "../native/tabs";
import { getToolById } from "../tools/registry";
import Home from "../pages/Home";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import ToolPanel from "./ToolPanel";

export default function Layout() {
  const { openTabs, activeTabId } = useTabManager();

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <aside className="hidden w-64 shrink-0 border-r border-gray-200 dark:border-gray-800 md:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <main className="min-w-0 flex-1 overflow-auto p-6 md:p-10">
          <div style={{ display: activeTabId === null ? "block" : "none" }}>
            <Home />
          </div>
          {openTabs.map((id) => {
            const tool = getToolById(id);
            if (!tool) return null;
            return (
              <div key={id} style={{ display: activeTabId === id ? "block" : "none" }}>
                <ToolPanel tool={tool} />
              </div>
            );
          })}
        </main>
      </div>
    </div>
  );
}
