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

export function isNativeBridgeAvailable(): boolean {
  return typeof window !== "undefined" && !!window.chrome?.webview;
}

export function callNative<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const bridge = window.chrome?.webview;
  if (!bridge) {
    return Promise.reject(new Error("当前不在桌面壳中运行，原生桥不可用。"));
  }

  const id = crypto.randomUUID();

  return new Promise<T>((resolve, reject) => {
    const onMessage = (event: MessageEvent<WebView2Message>) => {
      if (!event.data || event.data.id !== id) return;
      clearTimeout(timeoutId);
      bridge.removeEventListener("message", onMessage);
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.result as T);
      }
    };

    const timeoutId = setTimeout(() => {
      bridge.removeEventListener("message", onMessage);
      reject(new Error(`调用 "${method}" 超时`));
    }, NATIVE_CALL_TIMEOUT_MS);

    bridge.addEventListener("message", onMessage);
    bridge.postMessage({ id, method, params });
  });
}
