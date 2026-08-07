using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Web.WebView2.Core;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>
/// Simple async JSON-RPC-ish bridge over WebView2's postMessage channel.
/// JS -> native: window.chrome.webview.postMessage({ id, method, params })
/// native -> JS: CoreWebView2.PostWebMessageAsJson({ id, result } | { id, error })
/// </summary>
public sealed class NativeBridge
{
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
    private readonly Dictionary<string, Func<JsonElement, Task<object?>>> _handlers = new();

    public NativeBridge(CoreWebView2 webView)
    {
        _webView = webView;
        _webView.WebMessageReceived += OnWebMessageReceived;
    }

    /// <summary>Registers a handler for a bridge method (e.g. "auth.login"). Handlers must be async
    /// and must not block — they run on the WPF dispatcher thread via the WebView2 message pump.</summary>
    public void Register(string method, Func<JsonElement, Task<object?>> handler)
    {
        _handlers[method] = handler;
    }

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

        object? result = null;
        string? error = null;

        if (_handlers.TryGetValue(request.Method, out var handler))
        {
            try
            {
                result = await handler(request.Params);
            }
            catch (Exception ex)
            {
                error = ex.Message;
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
