import { useContext, useEffect } from "react";
import { TabDirtyContext } from "../native/tabs";

/** Drop into any tool built on CheckableGrid's dirty-tracking (Data Migration/Data Copy/Data
 *  Edit) once, next to its own `rows.some(isRowDirty)` check — renders the "⚠ 有改动，待更新"
 *  floating badge (bottom-right, same amber convention as this app's other in-progress/warning
 *  states) while `dirty`, and reports `dirty` up through TabDirtyContext so TabBar can mark this
 *  tab and confirm before discarding its edits on close. Outside a tab (no Provider — shouldn't
 *  happen for these tools today, but kept safe) the reporting side is just a no-op and this stays
 *  a plain visual badge. Lives inside the tool's own `<div>` in Layout, which stays
 *  `display:none` while its tab isn't active — `position: fixed` still respects that, so an
 *  inactive tab's badge never shows even though the tool itself stays mounted. */
export default function UnsavedChangesBadge({ dirty }: { dirty: boolean }) {
  const setTabDirty = useContext(TabDirtyContext);

  useEffect(() => {
    setTabDirty?.(dirty);
  }, [dirty, setTabDirty]);

  if (!dirty) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 shadow-lg dark:border-amber-700 dark:bg-amber-900/95 dark:text-amber-300">
      <span aria-hidden="true">⚠</span> 有改动，待更新
    </div>
  );
}
