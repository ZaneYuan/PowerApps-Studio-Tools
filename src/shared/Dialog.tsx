import { useEffect, useRef, type ReactNode } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function Dialog({
  ariaLabel,
  onClose,
  overlayClassName = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4",
  panelClassName,
  role = "dialog",
  closeOnBackdrop = false,
  children,
}: {
  ariaLabel: string;
  onClose: () => void;
  overlayClassName?: string;
  panelClassName: string;
  role?: "dialog" | "alertdialog";
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const previouslyFocusedRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    const panel = panelRef.current;
    const initialFocus = panel?.querySelector<HTMLElement>("[autofocus]") ?? panel?.querySelector<HTMLElement>(focusableSelector) ?? panel;
    initialFocus?.focus();

    function isTopDialog() {
      const dialogs = document.querySelectorAll<HTMLElement>("[aria-modal='true']");
      return dialogs[dialogs.length - 1] === panelRef.current;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className={overlayClassName}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} role={role} aria-modal="true" aria-label={ariaLabel} tabIndex={-1} className={panelClassName}>
        {children}
      </div>
    </div>
  );
}
