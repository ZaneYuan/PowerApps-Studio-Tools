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
  /** Tab keys whose tool currently has unsaved grid edits (reported via TabDirtyContext/
   *  shared/UnsavedChangesBadge) — TabBar reads this to mark a dirty tab and to confirm before
   *  discarding its edits on close. */
  dirtyTabKeys: Set<string>;
  setTabDirty: (tabKey: string, dirty: boolean) => void;
}

const TabManagerContext = createContext<TabManagerContextValue | null>(null);

/** Set by ToolPanel (bound to that tab's own tabKey) so any tool can report "I have unsaved
 *  edits right now" without needing to know its own tabKey itself — same delegation shape as
 *  TabConnectionContext in native/activeConnection.tsx. `null` (no provider, e.g. a tool rendered
 *  outside a tab) makes reporting a no-op. */
export const TabDirtyContext = createContext<((dirty: boolean) => void) | null>(null);

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
  const [dirtyTabKeys, setDirtyTabKeys] = useState<Set<string>>(new Set());

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
    // The closed tab's tool unmounts along with it — nothing left to ever report this tabKey
    // clean again, so drop it here rather than leaving a stale entry in dirtyTabKeys forever.
    setDirtyTabKeys((prev) => {
      if (!prev.has(tabKey)) return prev;
      const next = new Set(prev);
      next.delete(tabKey);
      return next;
    });
  }

  function setTabDirty(tabKey: string, dirty: boolean) {
    setDirtyTabKeys((prev) => {
      if (prev.has(tabKey) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(tabKey);
      else next.delete(tabKey);
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
      value={{ openTabs, activeTabKey, openTab, activateTab, closeTab, activateHome, setTabConnection, dirtyTabKeys, setTabDirty }}
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
