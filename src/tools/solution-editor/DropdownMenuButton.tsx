import { useEffect, useRef, useState, type ReactNode } from "react";

export interface DropdownMenuItem {
  key: string;
  label: string;
  group?: string;
}

export default function DropdownMenuButton({
  label,
  buttonClassName,
  items,
  onSelect,
}: {
  label: ReactNode;
  buttonClassName: string;
  items: readonly DropdownMenuItem[];
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} className={buttonClassName}>
        {label} <span className="ml-1 text-xs">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-40 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {items.map((item, i) => (
            <div key={item.key}>
              {item.group && item.group !== items[i - 1]?.group && (
                <div className={`px-3 pb-1 pt-2 text-[11px] font-semibold uppercase text-gray-400 ${i > 0 ? "mt-1 border-t border-gray-100 dark:border-gray-800" : ""}`}>
                  {item.group}
                </div>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onSelect(item.key);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
