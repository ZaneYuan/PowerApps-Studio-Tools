import { Suspense } from "react";
import type { ToolDefinition } from "../tools/types";

/** One tool's header + lazy-loaded component. Layout renders one of these per open tab and
 *  never unmounts it while the tab stays open (visibility is toggled by the parent, not by
 *  mounting/unmounting) — that's what keeps a tool's in-progress state alive across tab
 *  switches. */
export default function ToolPanel({ tool }: { tool: ToolDefinition }) {
  const { Component } = tool;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{tool.icon}</span>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{tool.name}</h1>
      </div>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{tool.description}</p>

      <div className="mt-6">
        <Suspense fallback={<div className="text-sm text-gray-400">加载中…</div>}>
          <Component />
        </Suspense>
      </div>
    </div>
  );
}
