using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using MsdPpTools.Desktop.Auth;
using MsdPpTools.Desktop.Bridge;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop;

public partial class MainWindow : Window
{
    private NativeBridge? _bridge;
    private readonly ConnectionStore _connectionStore = new();
    private readonly AuthService _authService;
    private readonly DataverseApiClient _dataverseClient;

    public MainWindow()
    {
        InitializeComponent();
        _authService = new AuthService(_connectionStore);
        _dataverseClient = new DataverseApiClient(_authService, _connectionStore);
        Loaded += MainWindow_Loaded;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await Browser.EnsureCoreWebView2Async();

        _bridge = new NativeBridge(Browser.CoreWebView2);
        _bridge.Register("ping", _ => Task.FromResult<object?>(new { message = "pong", time = DateTimeOffset.Now }));
        ConnectionHandlers.Register(_bridge, _connectionStore);
        AuthHandlers.Register(_bridge, _authService);
        DataverseHandlers.Register(_bridge, _dataverseClient);

#if DEBUG
        // Dev mode: point straight at the Vite dev server so the existing `npm run dev`
        // workflow (hot reload etc.) keeps working unchanged.
        Browser.CoreWebView2.Navigate("http://localhost:5173");
#else
        // Prod: the built React app (npm run build output) is copied next to the exe as
        // wwwroot/ at publish time. SetVirtualHostNameToFolderMapping avoids the file://
        // scheme's fetch/relative-path quirks.
        var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        Browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "app.local", wwwroot, CoreWebView2HostResourceAccessKind.Allow);
        Browser.CoreWebView2.Navigate("https://app.local/index.html");
#endif
    }
}
