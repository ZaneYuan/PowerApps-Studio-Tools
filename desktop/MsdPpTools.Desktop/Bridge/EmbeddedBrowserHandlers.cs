using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Wpf;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>Registers embeddedBrowser.* bridge methods — native WebView2 controls laid over the
/// main WebView2 to host a page served by a connection's own environment (e.g. an installed
/// solution's web resource UI). Dynamics pages refuse to render inside a cross-origin iframe and
/// need the environment's own sign-in cookies, so they can't live inside the SPA itself; the SPA
/// instead reports where its placeholder sits and this positions a real browser over it.
/// The URL is always built here from the connection's EnvironmentUrl plus a WebResources/ path,
/// so the JS side can't point it at an arbitrary site.</summary>
public static class EmbeddedBrowserHandlers
{
    private sealed class ShowParams
    {
        public string Key { get; set; } = "";
        public string ConnectionId { get; set; } = "";
        public string Path { get; set; } = "";
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
    }

    private sealed class KeyParams
    {
        public string Key { get; set; } = "";
    }

    private sealed class Entry(WebView2 view, Task ready, string url)
    {
        public WebView2 View { get; } = view;
        public Task Ready { get; } = ready;
        public string Url { get; set; } = url;
    }

    public static void Register(NativeBridge bridge, WebView2 mainBrowser, ConnectionStore connectionStore)
    {
        var host = (Grid)mainBrowser.Parent;
        var entries = new Dictionary<string, Entry>();

        bridge.Register("embeddedBrowser.show", async @params =>
        {
            var input = @params.Deserialize<ShowParams>(NativeBridge.JsonOptions)
                ?? throw new ArgumentException("缺少参数。");
            var url = BuildUrl(connectionStore, input.ConnectionId, input.Path);

            if (!entries.TryGetValue(input.Key, out var entry))
            {
                var view = new WebView2
                {
                    HorizontalAlignment = HorizontalAlignment.Left,
                    VerticalAlignment = VerticalAlignment.Top,
                };
                host.Children.Add(view);
                entry = new Entry(view, InitializeAsync(view, mainBrowser, url), url);
                entries[input.Key] = entry;
            }

            // The SPA reports CSS pixels; the main WebView2 fills the grid from its origin, so
            // grid DIPs are CSS pixels times the main page's zoom.
            var zoom = mainBrowser.ZoomFactor;
            entry.View.Margin = new Thickness(input.X * zoom, input.Y * zoom, 0, 0);
            entry.View.Width = Math.Max(0, input.Width * zoom);
            entry.View.Height = Math.Max(0, input.Height * zoom);
            entry.View.Visibility = Visibility.Visible;

            await entry.Ready;
            if (entry.Url != url)
            {
                entry.Url = url;
                entry.View.CoreWebView2.Navigate(url);
            }
            return null;
        });

        bridge.Register("embeddedBrowser.hide", @params =>
        {
            var input = @params.Deserialize<KeyParams>(NativeBridge.JsonOptions);
            if (input is not null && entries.TryGetValue(input.Key, out var entry))
            {
                entry.View.Visibility = Visibility.Collapsed;
            }
            return Task.FromResult<object?>(null);
        });

        bridge.Register("embeddedBrowser.close", @params =>
        {
            var input = @params.Deserialize<KeyParams>(NativeBridge.JsonOptions);
            if (input is not null && entries.Remove(input.Key, out var entry))
            {
                host.Children.Remove(entry.View);
                entry.View.Dispose();
            }
            return Task.FromResult<object?>(null);
        });
    }

    private static async Task InitializeAsync(WebView2 view, WebView2 mainBrowser, string url)
    {
        // Same environment (and so the same profile/cookie store) as the main browser: an
        // environment sign-in done once survives app restarts.
        await view.EnsureCoreWebView2Async(mainBrowser.CoreWebView2.Environment);
        view.CoreWebView2.Navigate(url);
    }

    private static string BuildUrl(ConnectionStore connectionStore, string connectionId, string path)
    {
        if (!path.StartsWith("WebResources/", StringComparison.Ordinal) || path.Contains("..") || path.Contains("://"))
        {
            throw new ArgumentException("只允许打开环境内 WebResources/ 下的页面。");
        }
        var connection = connectionStore.FindById(connectionId)
            ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");
        // Whatever runs in the embedded page writes through its own browser session, not through
        // DataverseApiClient, so the connection's read-only gate can't reach it.
        if (!connection.AllowWrite)
        {
            throw new InvalidOperationException($"连接\"{connection.Name}\"已关闭\"允许写入\"，嵌入页面的修改无法被拦截，所以不打开。");
        }
        return $"{connection.EnvironmentUrl.TrimEnd('/')}/{path}";
    }
}
