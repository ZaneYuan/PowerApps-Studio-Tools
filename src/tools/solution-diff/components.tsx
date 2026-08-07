import { useState } from "react";
import type { DiffItem, DiffLine, ItemStatus, SectionDiff } from "./types";

const STATUS_STYLES: Record<ItemStatus, string> = {
  added: "text-green-700 dark:text-green-400",
  removed: "text-red-700 dark:text-red-400",
  modified: "text-amber-700 dark:text-amber-400",
  unchanged: "text-gray-400 dark:text-gray-500",
};

const STATUS_LABELS: Record<ItemStatus, string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  unchanged: "无变化",
};

export function DiffLinesView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 text-xs leading-5 dark:border-gray-800 dark:bg-gray-950">
      {lines.map((l, i) => (
        <div
          key={i}
          className={
            l.type === "add"
              ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
              : l.type === "remove"
                ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                : "text-gray-500 dark:text-gray-400"
          }
        >
          {l.type === "add" ? "+ " : l.type === "remove" ? "- " : "  "}
          {l.text}
        </div>
      ))}
    </pre>
  );
}

export function DiffItemRow({ item, depth = 0 }: { item: DiffItem; depth?: number }) {
  const [open, setOpen] = useState(false);
  const expandable = (item.diffLines && item.diffLines.length > 0) || (item.children && item.children.length > 0);

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
          expandable ? "hover:bg-gray-100 dark:hover:bg-gray-800" : "cursor-default"
        }`}
      >
        {expandable && <span className="w-3 text-gray-400">{open ? "▾" : "▸"}</span>}
        {!expandable && <span className="w-3" />}
        <span className={`w-12 shrink-0 text-xs font-medium ${STATUS_STYLES[item.status]}`}>
          {STATUS_LABELS[item.status]}
        </span>
        <span className="truncate font-mono text-gray-800 dark:text-gray-200">{item.displayName}</span>
      </button>

      {open && item.diffLines && item.diffLines.length > 0 && (
        <div className="ml-9 mt-1">
          <DiffLinesView lines={item.diffLines} />
        </div>
      )}

      {open &&
        item.children &&
        item.children.map((child) => <DiffItemRow key={child.key} item={child} depth={depth + 1} />)}
    </div>
  );
}

export function SectionPanel({ section }: { section: SectionDiff }) {
  const hasChanges = section.addedCount + section.removedCount + section.modifiedCount > 0;
  const [open, setOpen] = useState(hasChanges);
  const changedItems = section.items.filter((i) => i.status !== "unchanged");

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-medium text-gray-900 dark:text-gray-100">{section.label}</span>
        <span className="flex items-center gap-3 text-xs">
          {section.addedCount > 0 && (
            <span className="text-green-600 dark:text-green-400">+{section.addedCount}</span>
          )}
          {section.removedCount > 0 && (
            <span className="text-red-600 dark:text-red-400">-{section.removedCount}</span>
          )}
          {section.modifiedCount > 0 && (
            <span className="text-amber-600 dark:text-amber-400">~{section.modifiedCount}</span>
          )}
          {!hasChanges && <span className="text-gray-400">无变化（{section.unchangedCount} 项）</span>}
          <span className="text-gray-400">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-200 p-2 dark:border-gray-800">
          {changedItems.length === 0 ? (
            <p className="px-2 py-2 text-xs text-gray-400">没有新增/删除/修改的项。</p>
          ) : (
            changedItems.map((item) => <DiffItemRow key={item.key} item={item} />)
          )}
        </div>
      )}
    </div>
  );
}
