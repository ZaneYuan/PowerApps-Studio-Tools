interface WebView2Message {
  id: string;
  result?: unknown;
  error?: string;
}

interface WebView2 {
  postMessage: (message: unknown) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent<WebView2Message>) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent<WebView2Message>) => void) => void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebView2 };
  }
}

const NATIVE_CALL_TIMEOUT_MS = 30_000;

/** Long timeout for a data query — a wide SELECT over thousands of rows (especially with
 *  `includeFormattedValues`, which triples every Lookup/OptionSet column) can be a multi-MB
 *  response that takes well over the 30s default just to transfer + parse. Sits just past the C#
 *  side's `HttpClient.Timeout` (5 min) so the native layer is the one that gives up first, with a
 *  clearer message, instead of this timer firing and orphaning a request that's still running. */
export const QUERY_TIMEOUT_MS = 5 * 60_000 + 20_000;

/** Method name the native bridge special-cases to abort an in-flight request (NativeBridge.cs). */
const CANCEL_METHOD = "bridge.cancel";

export function isNativeBridgeAvailable(): boolean {
  return typeof window !== "undefined" && !!window.chrome?.webview;
}

export function callNative<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const bridge = window.chrome?.webview;
  if (!bridge) {
    return Promise.reject(new Error("当前不在桌面壳中运行，原生桥不可用。"));
  }

  const { signal } = options;
  if (signal?.aborted) {
    return Promise.reject(new DOMException("查询已取消", "AbortError"));
  }

  const id = crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? NATIVE_CALL_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      bridge.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };

    const onMessage = (event: MessageEvent<WebView2Message>) => {
      if (!event.data || event.data.id !== id) return;
      cleanup();
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.result as T);
      }
    };

    const onAbort = () => {
      cleanup();
      // Best-effort: tell the native side to abort the underlying HTTP request. Fire-and-forget —
      // the native side sends no response to a cancel message.
      try {
        bridge.postMessage({ id: crypto.randomUUID(), method: CANCEL_METHOD, params: { requestId: id } });
      } catch {
        /* ignore — we're rejecting anyway */
      }
      reject(new DOMException("查询已取消", "AbortError"));
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`调用 "${method}" 超时`));
    }, timeoutMs);

    if (signal) signal.addEventListener("abort", onAbort);
    bridge.addEventListener("message", onMessage);
    bridge.postMessage({ id, method, params });
  });
}
