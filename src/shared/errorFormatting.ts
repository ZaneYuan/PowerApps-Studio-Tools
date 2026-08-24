/** Matches the exact shape `DataverseApiClient.cs`'s `RequestAsync` throws for any non-2xx Web
 *  API response: `Dataverse 请求失败 ({状态码}): {原始响应体}` — that string travels unchanged
 *  through the native bridge into `err.message` (see native/bridge.ts's `reject(new
 *  Error(event.data.error))`), so this is the one place that knows how to pull a real HTTP status
 *  code and Dataverse's own OData error message back out of it. */
const DATAVERSE_ERROR_PATTERN = /^Dataverse 请求失败 \((\d+)\): ([\s\S]*)$/;

function statusPrefix(status: number): string {
  if (status === 401) return "认证失败（登录已过期或凭据无效）";
  if (status === 403) return "没有权限执行此操作";
  if (status === 404) return "未找到（请求的资源不存在）";
  if (status === 429) return "请求过于频繁，被 Dataverse 限流";
  if (status >= 500) return "Dataverse 服务器内部错误";
  return `请求失败（HTTP ${status}）`;
}

/** Best-effort pull of Dataverse's own `{"error":{"message":"..."}}` OData error envelope out of
 *  a raw response body — `null` when it isn't that shape (an HTML error page, a truncated body,
 *  ...), so the caller falls back to just the status-code prefix. */
function extractODataMessage(rawBody: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = (parsed as { error?: unknown }).error;
      if (error && typeof error === "object" && "message" in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
      }
    }
  } catch {
    // Not JSON (or not this shape) — nothing to extract.
  }
  return null;
}

/** Turns a raw caught error into a short, human Chinese summary plus (when there's something
 *  worth hiding behind a toggle) the original technical detail — used by ErrorMessage.tsx so
 *  every tool's error banner shows "认证失败（登录已过期或凭据无效）：Invalid access token" instead
 *  of dumping the full `Dataverse 请求失败 (401): {"error":{"code":"0x...","message":"..."}}`
 *  string straight at the user. Anything that doesn't match the Dataverse HTTP-failure shape (a
 *  local/native exception, "找不到该连接" and friends, a network error) is passed through as-is —
 *  there's nothing Dataverse-specific to translate, and `detail` stays `null` so ErrorMessage
 *  doesn't render a toggle with nothing new inside it. */
export function formatDataverseError(err: unknown): { summary: string; detail: string | null } {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(DATAVERSE_ERROR_PATTERN);
  if (!match) return { summary: raw, detail: null };

  const status = Number(match[1]);
  const odataMessage = extractODataMessage(match[2]);
  const summary = odataMessage ? `${statusPrefix(status)}：${odataMessage}` : statusPrefix(status);
  return { summary, detail: raw };
}
