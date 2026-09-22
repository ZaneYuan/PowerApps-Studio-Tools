import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const DATA_MIGRATION_TOOL_ID = "data-migration";

export interface TabInstance {
  /** Opaque unique identity for this open tab — stable even if its connectionId is later
   *  changed via setTabConnection, so a manual in-tab connection switch doesn't get confused
   *  with "this is now a different tab." */
  tabKey: string;
  toolId: string;
  connectionId: string | null;
  /** A Data Migration tab that collects SELECTs for records just written by Data Edit / Data Copy
   *  (Requirements/9.15 #3). One per connection, since the SELECTs only find the records in the
   *  environment that wrote them; labelled "temporary" and never reused by openTab. */
  temporary?: boolean;
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
  closeTabs: (tabKeys: string[]) => void;
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
  /** Tool ids, most-recently-opened first, capped at RECENT_TOOL_LIMIT — Sidebar's own "最近使用"
   *  section reads this. Updated from `openTab` itself (not duplicated in Sidebar) so it reflects
   *  every entry point (sidebar click, home page card, ...) consistently. */
  recentToolIds: string[];
  /** Appends SELECTs to `connectionId`'s temporary Data Migration tab, opening it in the background
   *  when none is open. Returns that tab's key. */
  queueTemporaryMigrationSql: (connectionId: string, statements: string[]) => string;
  /** Statements queued for a temporary tab that its Data Migration hasn't picked up yet. */
  pendingMigrationSql: Record<string, string[]>;
  clearPendingMigrationSql: (tabKey: string) => void;
}

const TabManagerContext = createContext<TabManagerContextValue | null>(null);

const RECENT_TOOLS_STORAGE_KEY = "msdpptools.recentToolIds";
const RECENT_TOOL_LIMIT = 3;

function loadRecentToolIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_TOOLS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, RECENT_TOOL_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Set by ToolPanel (bound to that tab's own tabKey) so any tool can report "I have unsaved
 *  edits right now" without needing to know its own tabKey itself — same delegation shape as
 *  TabConnectionContext in native/activeConnection.tsx. `null` (no provider, e.g. a tool rendered
 *  outside a tab) makes reporting a no-op. */
export const TabDirtyContext = createContext<((dirty: boolean) => void) | null>(null);

/** Set by Layout to each tab's own key, for tools that need to know which tab they live in. */
export const TabKeyContext = createContext<string | null>(null);

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
  const [recentToolIds, setRecentToolIds] = useState<string[]>(loadRecentToolIds);
  const [pendingMigrationSql, setPendingMigrationSql] = useState<Record<string, string[]>>({});
  // A ref rather than a lookup in openTabs: two writes finishing before the next render must still
  // land in one temporary tab instead of each opening its own.
  const temporaryTabKeysRef = useRef(new Map<string, string>());

  function recordRecentTool(toolId: string) {
    setRecentToolIds((prev) => {
      const next = [toolId, ...prev.filter((id) => id !== toolId)].slice(0, RECENT_TOOL_LIMIT);
      localStorage.setItem(RECENT_TOOLS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function openTab(toolId: string, connectionId: string | null) {
    recordRecentTool(toolId);
    const existing = openTabs.find((t) => t.toolId === toolId && t.connectionId === connectionId && !t.temporary);
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

  function queueTemporaryMigrationSql(connectionId: string, statements: string[]): string {
    let tabKey = temporaryTabKeysRef.current.get(connectionId);
    if (!tabKey) {
      const newKey = makeTabKey(DATA_MIGRATION_TOOL_ID);
      tabKey = newKey;
      temporaryTabKeysRef.current.set(connectionId, newKey);
      setOpenTabs((tabs) => [...tabs, { tabKey: newKey, toolId: DATA_MIGRATION_TOOL_ID, connectionId, temporary: true }]);
    }
    const key = tabKey;
    setPendingMigrationSql((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...statements] }));
    return key;
  }

  function clearPendingMigrationSql(tabKey: string) {
    setPendingMigrationSql((prev) => {
      if (!(tabKey in prev)) return prev;
      const next = { ...prev };
      delete next[tabKey];
      return next;
    });
  }

  function closeTabs(tabKeys: string[]) {
    const closingKeys = new Set(tabKeys);
    if (closingKeys.size === 0) return;
    for (const [connectionId, tabKey] of temporaryTabKeysRef.current) {
      if (closingKeys.has(tabKey)) temporaryTabKeysRef.current.delete(connectionId);
    }
    closingKeys.forEach(clearPendingMigrationSql);
    setOpenTabs((tabs) => {
      const activeIndex = tabs.findIndex((t) => t.tabKey === activeTabKey);
      const next = tabs.filter((t) => !closingKeys.has(t.tabKey));
      if (activeTabKey !== null && closingKeys.has(activeTabKey)) {
        const preceding = tabs.slice(0, Math.max(0, activeIndex)).reverse().find((t) => !closingKeys.has(t.tabKey));
        const following = tabs.slice(activeIndex + 1).find((t) => !closingKeys.has(t.tabKey));
        setActiveTabKey(preceding?.tabKey ?? following?.tabKey ?? null);
      }
      return next;
    });
    setDirtyTabKeys((prev) => {
      if (![...closingKeys].some((key) => prev.has(key))) return prev;
      const next = new Set(prev);
      closingKeys.forEach((key) => next.delete(key));
      return next;
    });
  }

  function closeTab(tabKey: string) {
    closeTabs([tabKey]);
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
      value={{
        openTabs,
        activeTabKey,
        openTab,
        activateTab,
        closeTab,
        closeTabs,
        activateHome,
        setTabConnection,
        dirtyTabKeys,
        setTabDirty,
        recentToolIds,
        queueTemporaryMigrationSql,
        pendingMigrationSql,
        clearPendingMigrationSql,
      }}
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

/** Hands statements queued for the calling tool's tab (see queueTemporaryMigrationSql) to
 *  `onStatements`, once each. A no-op outside a tab or when nothing is queued. */
export function usePendingMigrationSql(onStatements: (statements: string[]) => void) {
  const tabKey = useContext(TabKeyContext);
  const ctx = useContext(TabManagerContext);
  const pending = tabKey && ctx ? ctx.pendingMigrationSql[tabKey] : undefined;
  const onStatementsRef = useRef(onStatements);
  onStatementsRef.current = onStatements;
  // StrictMode runs effects twice before the clear below lands; the batch's identity marks it handled.
  const handledRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (!tabKey || !ctx || !pending || pending.length === 0 || handledRef.current === pending) return;
    handledRef.current = pending;
    onStatementsRef.current(pending);
    ctx.clearPendingMigrationSql(tabKey);
  }, [tabKey, ctx, pending]);
}
