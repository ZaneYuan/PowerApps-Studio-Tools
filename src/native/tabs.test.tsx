// @vitest-environment jsdom
import { act, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActiveConnectionProvider } from "./activeConnection";
import { TabKeyContext, TabManagerProvider, usePendingMigrationSql, useTabManager } from "./tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let manager: ReturnType<typeof useTabManager>;
const received: Record<string, string[][]> = {};

function Inbox() {
  const tabKey = useContext(TabKeyContext) ?? "";
  usePendingMigrationSql((statements) => {
    (received[tabKey] ??= []).push(statements);
  });
  return null;
}

function Harness() {
  manager = useTabManager();
  return (
    <>
      {manager.openTabs.map((tab) => (
        <TabKeyContext.Provider key={tab.tabKey} value={tab.tabKey}>
          <Inbox />
        </TabKeyContext.Provider>
      ))}
    </>
  );
}

beforeEach(() => {
  for (const key of Object.keys(received)) delete received[key];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ActiveConnectionProvider>
        <TabManagerProvider>
          <Harness />
        </TabManagerProvider>
      </ActiveConnectionProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe("temporary Data Migration tab (Requirements/9.15 #3)", () => {
  it("opens one temporary tab on the writing connection, in the background, even for two writes before a render", () => {
    let first = "";
    let second = "";
    act(() => {
      first = manager.queueTemporaryMigrationSql("conn-dev", ["select * from a where aid in ('1')"]);
      second = manager.queueTemporaryMigrationSql("conn-dev", ["select name from b where bid in ('2')"]);
    });
    expect(second).toBe(first);
    expect(manager.openTabs).toEqual([{ tabKey: first, toolId: "data-migration", connectionId: "conn-dev", temporary: true }]);
    expect(manager.activeTabKey).toBeNull();
  });

  it("keeps a separate temporary tab per connection, since each SELECT only finds records in its own environment", () => {
    let dev = "";
    let sit = "";
    act(() => {
      dev = manager.queueTemporaryMigrationSql("conn-dev", ["s-dev"]);
      sit = manager.queueTemporaryMigrationSql("conn-sit", ["s-sit"]);
    });
    expect(sit).not.toBe(dev);
    expect(manager.openTabs.map((t) => [t.connectionId, t.temporary])).toEqual([
      ["conn-dev", true],
      ["conn-sit", true],
    ]);
    expect(received[dev]).toEqual([["s-dev"]]);
    expect(received[sit]).toEqual([["s-sit"]]);
  });

  it("delivers queued statements to the tab once, then clears them", () => {
    let tabKey = "";
    act(() => {
      tabKey = manager.queueTemporaryMigrationSql("conn-dev", ["s1"]);
    });
    act(() => {
      manager.queueTemporaryMigrationSql("conn-dev", ["s2", "s3"]);
    });
    expect(received[tabKey]).toEqual([["s1"], ["s2", "s3"]]);
    expect(manager.pendingMigrationSql).toEqual({});
  });

  it("is never reused by a normal openTab, and a new one opens after it's closed", () => {
    let tabKey = "";
    act(() => {
      tabKey = manager.queueTemporaryMigrationSql("conn-dev", ["s1"]);
    });
    act(() => manager.openTab("data-migration", "conn-dev"));
    expect(manager.openTabs).toHaveLength(2);
    expect(manager.activeTabKey).not.toBe(tabKey);

    act(() => manager.closeTab(tabKey));
    let next = "";
    act(() => {
      next = manager.queueTemporaryMigrationSql("conn-dev", ["s2"]);
    });
    expect(next).not.toBe(tabKey);
    expect(manager.openTabs.filter((t) => t.temporary)).toHaveLength(1);
  });
});
