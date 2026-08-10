import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

interface TabManagerContextValue {
  /** Tool ids currently open, in the order their tabs appear. */
  openTabs: string[];
  /** null = the home/tool-list tab is active. */
  activeTabId: string | null;
  /** Opens a tab for this tool if it isn't already open, and switches to it either way —
   *  this is what both the sidebar and the home page cards call. */
  openTab: (toolId: string) => void;
  closeTab: (toolId: string) => void;
  activateHome: () => void;
}

const TabManagerContext = createContext<TabManagerContextValue | null>(null);

/** Keeps every opened tool mounted (Layout renders one hidden `<div>` per open tab, toggling
 *  `display` instead of unmounting) so switching tabs never loses a tool's in-progress state —
 *  a half-filled form, a loaded tree, a running query. */
export function TabManagerProvider({ children }: { children: ReactNode }) {
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  function openTab(toolId: string) {
    setOpenTabs((tabs) => (tabs.includes(toolId) ? tabs : [...tabs, toolId]));
    setActiveTabId(toolId);
  }

  function closeTab(toolId: string) {
    setOpenTabs((tabs) => {
      const idx = tabs.indexOf(toolId);
      const next = tabs.filter((t) => t !== toolId);
      if (activeTabId === toolId) {
        setActiveTabId(next.length === 0 ? null : next[Math.max(0, idx - 1)]);
      }
      return next;
    });
  }

  function activateHome() {
    setActiveTabId(null);
  }

  return (
    <TabManagerContext.Provider value={{ openTabs, activeTabId, openTab, closeTab, activateHome }}>
      {children}
    </TabManagerContext.Provider>
  );
}

export function useTabManager(): TabManagerContextValue {
  const ctx = useContext(TabManagerContext);
  if (!ctx) throw new Error("useTabManager 必须在 TabManagerProvider 内使用");
  return ctx;
}
