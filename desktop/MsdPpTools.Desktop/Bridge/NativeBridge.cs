using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Web.WebView2.Core;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>
/// Simple async JSON-RPC-ish bridge over WebView2's postMessage channel.
/// JS -> native: window.chrome.webview.postMessage({ id, method, params })
/// native -> JS: CoreWebView2.PostWebMessageAsJson({ id, result } | { id, error })
///
/// A request can be cancelled mid-flight: JS posts { id: &lt;new&gt;, method: "bridge.cancel",
/// params: { requestId: &lt;the id to abort&gt; } } and the handler's CancellationToken fires.
/// </summary>
public sealed class NativeBridge
{
    /// <summary>Special method name the JS side posts to abort an in-flight request.</summary>
    public const string CancelMethod = "bridge.cancel";

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private sealed class BridgeRequest
    {
        public string Id { get; set; } = "";
        public string Method { get; set; } = "";
        public JsonElement Params { get; set; }
    }

    private readonly CoreWebView2 _webView;
    private readonly Dictionary<string, Func<JsonElement, CancellationToken, Task<object?>>> _handlers = new();
    /// <summary>In-flight request id -> its cancellation source, so a "bridge.cancel" message can abort it.</summary>
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _inFlight = new();

    public NativeBridge(CoreWebView2 webView)
    {
        _webView = webView;
        _webView.WebMessageReceived += OnWebMessageReceived;
    }

    /// <summary>Registers a handler for a bridge method (e.g. "auth.login"). Handlers must be async
    /// and must not block — they run on the WPF dispatcher thread via the WebView2 message pump.</summary>
    public void Register(string method, Func<JsonElement, Task<object?>> handler)
        => _handlers[method] = (@params, _) => handler(@params);

    /// <summary>Same, but the handler receives a CancellationToken that fires when the JS side aborts
    /// the request (see <see cref="CancelMethod"/>). Use for long-running network calls.</summary>
    public void Register(string method, Func<JsonElement, CancellationToken, Task<object?>> handler)
        => _handlers[method] = handler;

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        BridgeRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<BridgeRequest>(e.WebMessageAsJson, JsonOptions);
        }
        catch (JsonException)
        {
            return;
        }

        if (request is null || string.IsNullOrEmpty(request.Id))
        {
            return;
        }

        // Cancellation is fire-and-forget: abort the target request if it's still running, no response.
        if (request.Method == CancelMethod)
        {
            var targetId = request.Params.ValueKind == JsonValueKind.Object
                && request.Params.TryGetProperty("requestId", out var rid)
                ? rid.GetString()
                : null;
            if (!string.IsNullOrEmpty(targetId) && _inFlight.TryGetValue(targetId, out var target))
            {
                try { target.Cancel(); } catch (ObjectDisposedException) { /* already finished */ }
            }
            return;
        }

        object? result = null;
        string? error = null;

        if (_handlers.TryGetValue(request.Method, out var handler))
        {
            using var cts = new CancellationTokenSource();
            _inFlight[request.Id] = cts;
            try
            {
                result = await handler(request.Params, cts.Token);
            }
            catch (OperationCanceledException) when (cts.IsCancellationRequested)
            {
                error = "已取消";
            }
            catch (OperationCanceledException)
            {
                // The handler's own timeout (e.g. HttpClient.Timeout), not a user cancel.
                error = "请求超时：服务器响应时间过长，请缩小查询范围或稍后再试。";
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }
            finally
            {
                _inFlight.TryRemove(request.Id, out _);
            }
        }
        else
        {
            error = $"未知的桥接方法: {request.Method}";
        }

        var response = new BridgeResponse(request.Id, result, error);
        _webView.PostWebMessageAsJson(JsonSerializer.Serialize(response, JsonOptions));
    }

    private sealed record BridgeResponse(string Id, object? Result, string? Error);
}
