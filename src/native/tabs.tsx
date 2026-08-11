import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export interface TabInstance {
  /** Opaque unique identity for this open tab — stable even if its connectionId is later
   *  changed via setTabConnection, so a manual in-tab connection switch doesn't get confused
   *  with "this is now a different tab." */
  tabKey: string;
  toolId: string;
  connectionId: string | null;
}

interface TabManagerContextValue {
  /** Open tabs, in the order they appear. */
  openTabs: TabInstance[];
  /** null = the home/tool-list tab is active. */
  activeTabKey: string | null;
  /** Activates an existing tab for (toolId, connectionId) if one's already open, otherwise
   *  opens and activates a new one — this is what the sidebar and home page cards call. Two
   *  tabs for the same tool are allowed as long as they're bound to different connections. */
  openTab: (toolId: string, connectionId: string | null) => void;
  /** Switches to an already-open tab by its key (what clicking a tab in the bar itself does). */
  activateTab: (tabKey: string) => void;
  closeTab: (tabKey: string) => void;
  activateHome: () => void;
  /** Rebinds an open tab to a different connection without closing/reopening it — used when the
   *  sidebar's connection switcher changes value while that tab is focused. The tool inside
   *  re-fetches on its own because the connectionId it reads (via TabConnectionContext) changes;
   *  no remount needed. */
  setTabConnection: (tabKey: string, connectionId: string | null) => void;
}

const TabManagerContext = createContext<TabManagerContextValue | null>(null);

let tabKeySeq = 0;
function makeTabKey(toolId: string): string {
  tabKeySeq += 1;
  return `${toolId}:${tabKeySeq}`;
}

/** Keeps every opened tool mounted (Layout renders one hidden `<div>` per open tab, toggling
 *  `display` instead of unmounting) so switching tabs never loses a tool's in-progress state —
 *  a half-filled form, a loaded tree, a running query. */
export function TabManagerProvider({ children }: { children: ReactNode }) {
  const [openTabs, setOpenTabs] = useState<TabInstance[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);

  function openTab(toolId: string, connectionId: string | null) {
    const existing = openTabs.find((t) => t.toolId === toolId && t.connectionId === connectionId);
    if (existing) {
      setActiveTabKey(existing.tabKey);
      return;
    }
    const tabKey = makeTabKey(toolId);
    setOpenTabs((tabs) => [...tabs, { tabKey, toolId, connectionId }]);
    setActiveTabKey(tabKey);
  }

  function activateTab(tabKey: string) {
    setActiveTabKey(tabKey);
  }

  function closeTab(tabKey: string) {
    setOpenTabs((tabs) => {
      const idx = tabs.findIndex((t) => t.tabKey === tabKey);
      const next = tabs.filter((t) => t.tabKey !== tabKey);
      if (activeTabKey === tabKey) {
        setActiveTabKey(next.length === 0 ? null : next[Math.max(0, idx - 1)].tabKey);
      }
      return next;
    });
  }

  function activateHome() {
    setActiveTabKey(null);
  }

  function setTabConnection(tabKey: string, connectionId: string | null) {
    setOpenTabs((tabs) => tabs.map((t) => (t.tabKey === tabKey ? { ...t, connectionId } : t)));
  }

  return (
    <TabManagerContext.Provider
      value={{ openTabs, activeTabKey, openTab, activateTab, closeTab, activateHome, setTabConnection }}
    >
      {children}
    </TabManagerContext.Provider>
  );
}

export function useTabManager(): TabManagerContextValue {
  const ctx = useContext(TabManagerContext);
  if (!ctx) throw new Error("useTabManager 必须在 TabManagerProvider 内使用");
  return ctx;
}
