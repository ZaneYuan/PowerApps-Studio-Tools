import { Suspense } from "react";
import { isNativeBridgeAvailable } from "../native/bridge";
import { TabConnectionContext, useActiveConnection } from "../native/activeConnection";
import { useTabManager } from "../native/tabs";
import type { ToolDefinition } from "../tools/types";

const selectCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

/** One tool's header + lazy-loaded component. Layout renders one of these per open tab and
 *  never unmounts it while the tab stays open (visibility is toggled by the parent, not by
 *  mounting/unmounting) — that's what keeps a tool's in-progress state alive across tab
 *  switches. Binds the tool inside to this specific tab's connection via TabConnectionContext,
 *  so useActiveConnection() inside it resolves to `connectionId` instead of the global one.
 *
 *  Also renders this tab's own connection switcher — deliberately separate from the sidebar's
 *  ConnectionSwitcher (which only ever seeds *new* tabs). Changing the sidebar dropdown while
 *  this tab happens to be focused must not silently retarget it — that would make "pick a
 *  connection, then click a tool in the sidebar to open a second tab" (the point of having two
 *  tabs at all) actually mutate the first tab instead of opening a second one. So: rebinding an
 *  already-open tab only ever happens here, explicitly, scoped to this one tab. */
export default function ToolPanel({
  tool,
  tabKey,
  connectionId,
}: {
  tool: ToolDefinition;
  tabKey: string;
  connectionId: string | null;
}) {
  const { Component } = tool;
  const { connections } = useActiveConnection();
  const { setTabConnection } = useTabManager();

  return (
    <TabConnectionContext.Provider value={connectionId}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{tool.icon}</span>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{tool.name}</h1>
          </div>
          {isNativeBridgeAvailable() && tool.connectionScoped !== false && (
            <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              本页连接
              <select
                value={connectionId ?? ""}
                onChange={(e) => setTabConnection(tabKey, e.target.value || null)}
                className={selectCls}
              >
                <option value="">未选择</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{tool.description}</p>

        <div className="mt-6">
          <Suspense fallback={<div className="text-sm text-gray-400">加载中…</div>}>
            <Component />
          </Suspense>
        </div>
      </div>
    </TabConnectionContext.Provider>
  );
}
