import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface ConfirmOptions {
  title?: string;
  message: string;
  /** Extra itemized detail (e.g. SQL4CDS's per-statement batch preview) rendered as its own
   *  scrollable monospace list below `message` — instead of every call site having to squeeze a
   *  multi-line preview into one `\n`-joined string the way the native `confirm()` this replaces
   *  forced them to. */
  detail?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for a destructive action (delete) — same visual convention this app
   *  already uses for "停止"/delete buttons elsewhere (`border-red-300`/`text-red-700`). */
  danger?: boolean;
}

type PendingDialog =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "alert"; message: string; resolve: () => void };

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alertMsg: (message: string) => Promise<void>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

const dialogButtonCls =
  "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const cancelButtonCls =
  `${dialogButtonCls} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800`;

/** App-wide replacement for the native `confirm()`/`alert()` this app used to call directly —
 *  those are unstyled (no dark-mode support), block the JS thread, and (SQL4CDS's own batch
 *  preview) had no way to show a long itemized list without cramming it into one giant `\n`-joined
 *  string. Mount `<ConfirmDialogProvider>` once near the app root (see App.tsx); any component
 *  below it calls `useConfirmDialog()`/`useAlertDialog()` to get a promise-based function with the
 *  exact same "await it, branch on the result" shape `if (!confirm(...)) return;` already had —
 *  every existing call site just adds `await` and swaps the string for an options object. */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const resolved = typeof options === "string" ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      setPending({ kind: "confirm", options: resolved, resolve });
    });
  }, []);

  const alertMsg = useCallback((message: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      setPending({ kind: "alert", message, resolve });
    });
  }, []);

  function close(result: boolean) {
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(result);
    else pending.resolve();
    setPending(null);
  }

  useEffect(() => {
    if (!pending) return;
    confirmBtnRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter") close(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return (
    <ConfirmDialogContext.Provider value={{ confirm, alertMsg }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900"
          >
            {pending.kind === "confirm" && pending.options.title && (
              <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{pending.options.title}</h2>
            )}
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
              {pending.kind === "confirm" ? pending.options.message : pending.message}
            </p>
            {pending.kind === "confirm" && pending.options.detail && pending.options.detail.length > 0 && (
              <div className="mt-2 max-h-48 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
                {pending.options.detail.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap">
                    {line}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              {pending.kind === "confirm" && (
                <button onClick={() => close(false)} className={cancelButtonCls}>
                  {pending.options.cancelLabel ?? "取消"}
                </button>
              )}
              <button
                ref={confirmBtnRef}
                onClick={() => close(true)}
                className={`${dialogButtonCls} text-white ${
                  pending.kind === "confirm" && pending.options.danger
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {pending.kind === "confirm" ? (pending.options.confirmLabel ?? "确定") : "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}

function useConfirmDialogContext(): ConfirmDialogContextValue {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) throw new Error("useConfirmDialog/useAlertDialog 必须在 ConfirmDialogProvider 内使用");
  return ctx;
}

export function useConfirmDialog(): (options: ConfirmOptions | string) => Promise<boolean> {
  return useConfirmDialogContext().confirm;
}

export function useAlertDialog(): (message: string) => Promise<void> {
  return useConfirmDialogContext().alertMsg;
}
