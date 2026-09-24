using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.Web.WebView2.Core;
using MsdPpTools.Desktop.Auth;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>Runs Develop1's Ribbon Workbench 2016 against a connection without the user opening
/// (or installing it in) the environment — the same idea as XrmToolBox's RWB plugin. The SPA
/// iframes <c>https://{label}.rwb.local/...</c>, a host that only exists inside this WebView2, and
/// every request to it is answered here:
/// <list type="bullet">
/// <item>rwb_ web resources come from the managed solution package the XrmToolBox plugin keeps
/// locally (read at runtime, never shipped with this app);</item>
/// <item>the rwb_CustomiseRibbon action — the part of RWB that actually exports, edits and imports
/// the solution, normally a plug-in installed with RWB — runs from that same package in
/// ProfilerHost, against the connection;</item>
/// <item>everything else (ClientGlobalContext.js.aspx, /_imgs, the page's other SOAP calls) is
/// forwarded to the environment with the connection's own bearer token.</item>
/// </list>
/// Without a local package the page and the action both come from the environment's own RWB
/// install instead, keeping the UI and plug-in versions paired.</summary>
public sealed class RibbonWorkbenchHost
{
    private const string HostSuffix = ".rwb.local";
    private const string StartPage = "WebResources/rwb_/html/EditCommandBar.htm";
    private const string ActionRequestMarker = "<a:RequestName>rwb_CustomiseRibbon</a:RequestName>";

    private static readonly string LocalPackagePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "MscrmTools", "XrmToolBox", "Plugins", "RibbonWorkbench", "RibbonWorkbench2016_managed.zip");

    // Responses are handed to WebView2 with only a Content-Type header, so the body must already be
    // decoded: Dataverse brotli-compresses ClientGlobalContext.js.aspx and friends whenever the
    // request offers it, and passing those bytes through left RWB stuck on its loading spinner.
    private static readonly HttpClient Http = new(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All })
    {
        Timeout = TimeSpan.FromMinutes(5),
    };

    private static readonly HashSet<string> SkippedRequestHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Host", "Origin", "Referer", "Cookie", "Authorization", "Content-Length", "Connection", "Accept-Encoding",
    };

    private sealed class OpenParams
    {
        public string ConnectionId { get; set; } = "";
    }

    private sealed record PackageFile(byte[] Content, string ContentType);

    private sealed record Package(string Version, Dictionary<string, PackageFile> Files, string PluginAssemblyPath, string PluginTypeName);

    private readonly CoreWebView2 _webView;
    private readonly AuthService _authService;
    private readonly ConnectionStore _connectionStore;
    private readonly Dictionary<string, string> _connectionByLabel = new();
    private readonly Dictionary<string, string> _labelByConnection = new();
    private readonly ActionHostProcess _actionHost = new();
    private Package? _package;

    private RibbonWorkbenchHost(CoreWebView2 webView, AuthService authService, ConnectionStore connectionStore)
    {
        _webView = webView;
        _authService = authService;
        _connectionStore = connectionStore;
    }

    public static void Register(NativeBridge bridge, CoreWebView2 webView, AuthService authService, ConnectionStore connectionStore)
    {
        var host = new RibbonWorkbenchHost(webView, authService, connectionStore);
        webView.AddWebResourceRequestedFilter(
            $"https://*{HostSuffix}/*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
        webView.WebResourceRequested += host.OnWebResourceRequested;

        bridge.Register("ribbonWorkbench.open", @params =>
        {
            var input = @params.Deserialize<OpenParams>(NativeBridge.JsonOptions)
                ?? throw new ArgumentException("缺少参数。");
            var connection = connectionStore.FindById(input.ConnectionId)
                ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");
            // RWB publishes through the calls proxied below; refusing up front is clearer than
            // letting its first read (also a SOAP POST) fail against the per-request gate.
            if (!connection.AllowWrite)
            {
                throw new InvalidOperationException($"连接\"{connection.Name}\"已关闭\"允许写入\"，Ribbon Workbench 需要写入权限才能保存和发布。");
            }
            if (!host._labelByConnection.TryGetValue(connection.Id, out var label))
            {
                label = Guid.NewGuid().ToString("N");
                host._labelByConnection[connection.Id] = label;
                host._connectionByLabel[label] = connection.Id;
            }
            var package = host.LoadPackage();
            return Task.FromResult<object?>(new
            {
                url = $"https://{label}{HostSuffix}/{StartPage}",
                localPackageVersion = package?.Version,
                localPackagePath = LocalPackagePath,
            });
        });
    }

    private async void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var uri = new Uri(e.Request.Uri);
        if (!uri.Host.EndsWith(HostSuffix, StringComparison.OrdinalIgnoreCase)) return;
        var label = uri.Host[..^HostSuffix.Length];
        if (!_connectionByLabel.TryGetValue(label, out var connectionId))
        {
            e.Response = CreateResponse(404, "Not Found", "text/plain", Encoding.UTF8.GetBytes("Unknown Ribbon Workbench host."));
            return;
        }

        var body = ReadRequestBody(e.Request);
        var headers = e.Request.Headers.Select(h => new KeyValuePair<string, string>(h.Key, h.Value)).ToList();
        var method = e.Request.Method;
        var deferral = e.GetDeferral();
        // The page's own fetch/XHR is the only consumer of this response, so any failure is
        // reported to it as a 502 rather than surfacing as an unhandled async-void exception.
        try
        {
            var packageFile = FindPackageFile(uri.AbsolutePath);
            e.Response = packageFile is not null
                ? CreateResponse(200, "OK", packageFile.ContentType, packageFile.Content)
                : await HandleEnvironmentRequestAsync(connectionId, label, uri, method, headers, body);
        }
        catch (Exception ex)
        {
            e.Response = CreateResponse(502, "Bad Gateway", "text/plain", Encoding.UTF8.GetBytes(ex.Message));
        }
        finally
        {
            deferral.Complete();
        }
    }

    private async Task<CoreWebView2WebResourceResponse> HandleEnvironmentRequestAsync(
        string connectionId, string label, Uri uri, string method, List<KeyValuePair<string, string>> headers, byte[]? body)
    {
        var connection = _connectionStore.FindById(connectionId)
            ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");
        if (!connection.AllowWrite && !string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase))
        {
            return CreateResponse(403, "Forbidden", "text/plain", Encoding.UTF8.GetBytes($"连接\"{connection.Name}\"已关闭\"允许写入\"。"));
        }

        var token = await _authService.GetTokenAsync(connectionId);
        var package = LoadPackage();
        if (package is not null && body is not null
            && uri.AbsolutePath.EndsWith("/Organization.svc/web", StringComparison.OrdinalIgnoreCase)
            && Encoding.UTF8.GetString(body) is var soap && soap.Contains(ActionRequestMarker, StringComparison.Ordinal))
        {
            return await ExecuteActionLocallyAsync(connection, token.AccessToken, package, soap);
        }
        return await ProxyAsync(connection, token.AccessToken, label, uri, method, headers, body);
    }

    private async Task<CoreWebView2WebResourceResponse> ExecuteActionLocallyAsync(Connection connection, string accessToken, Package package, string soapRequest)
    {
        var parameters = XDocument.Parse(soapRequest).Descendants()
            .Where(e => e.Name.LocalName == "KeyValuePairOfstringanyType")
            .ToDictionary(
                e => e.Elements().First(c => c.Name.LocalName == "key").Value,
                e => e.Elements().First(c => c.Name.LocalName == "value").Value);

        var result = await _actionHost.ExecuteAsync(new
        {
            orgUrl = connection.EnvironmentUrl,
            accessToken,
            assemblyPath = package.PluginAssemblyPath,
            typeName = package.PluginTypeName,
            operation = parameters.GetValueOrDefault("Operation") ?? "",
            data = parameters.GetValueOrDefault("Data") ?? "",
        });

        // The two envelope shapes RWB's SOAP client reads: ExecuteResult/Results/…/key=Result for
        // success, s:Fault/faultstring for an error.
        var xml = result.Error is null
            ? "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body>"
              + "<ExecuteResponse xmlns=\"http://schemas.microsoft.com/xrm/2011/Contracts/Services\">"
              + "<ExecuteResult xmlns:a=\"http://schemas.microsoft.com/xrm/2011/Contracts\" xmlns:i=\"http://www.w3.org/2001/XMLSchema-instance\">"
              + "<a:ResponseName>rwb_CustomiseRibbon</a:ResponseName>"
              + "<a:Results xmlns:b=\"http://schemas.datacontract.org/2004/07/System.Collections.Generic\"><a:KeyValuePairOfstringanyType>"
              + $"<b:key>Result</b:key><b:value i:type=\"c:string\" xmlns:c=\"http://www.w3.org/2001/XMLSchema\">{SecurityElement.Escape(result.Result ?? "")}</b:value>"
              + "</a:KeyValuePairOfstringanyType></a:Results></ExecuteResult></ExecuteResponse></s:Body></s:Envelope>"
            : "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><s:Fault>"
              + $"<faultcode>s:Client</faultcode><faultstring>{SecurityElement.Escape(result.Error)}</faultstring>"
              + "</s:Fault></s:Body></s:Envelope>";
        return CreateResponse(result.Error is null ? 200 : 500, result.Error is null ? "OK" : "Internal Server Error", "text/xml; charset=utf-8", Encoding.UTF8.GetBytes(xml));
    }

    private async Task<CoreWebView2WebResourceResponse> ProxyAsync(
        Connection connection, string accessToken, string label, Uri uri, string method, List<KeyValuePair<string, string>> headers, byte[]? body)
    {
        var environmentOrigin = connection.EnvironmentUrl.TrimEnd('/');
        using var request = new HttpRequestMessage(new HttpMethod(method), environmentOrigin + uri.PathAndQuery);
        if (body is not null) request.Content = new ByteArrayContent(body);
        foreach (var (name, value) in headers)
        {
            if (SkippedRequestHeaders.Contains(name)) continue;
            if (!request.Headers.TryAddWithoutValidation(name, value))
            {
                request.Content?.Headers.TryAddWithoutValidation(name, value);
            }
        }
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        using var response = await Http.SendAsync(request);
        var content = await response.Content.ReadAsByteArrayAsync();
        var contentType = response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";

        // ClientGlobalContext.js.aspx bakes the environment's absolute URL in (getClientUrl);
        // pointing it back at the virtual host keeps RWB's follow-up SOAP calls coming through here.
        if (contentType.Contains("javascript", StringComparison.OrdinalIgnoreCase) || contentType.Contains("html", StringComparison.OrdinalIgnoreCase))
        {
            var text = Encoding.UTF8.GetString(content);
            content = Encoding.UTF8.GetBytes(text.Replace(environmentOrigin, $"https://{label}{HostSuffix}", StringComparison.OrdinalIgnoreCase));
        }

        return CreateResponse((int)response.StatusCode, response.ReasonPhrase ?? "", contentType, content);
    }

    private PackageFile? FindPackageFile(string absolutePath)
    {
        const string marker = "/webresources/";
        var index = absolutePath.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return null;
        var name = Uri.UnescapeDataString(absolutePath[(index + marker.Length)..]);
        if (!name.StartsWith("rwb_/", StringComparison.OrdinalIgnoreCase)) return null;
        return LoadPackage()?.Files.GetValueOrDefault(name);
    }

    private Package? LoadPackage()
    {
        if (_package is not null) return _package;
        if (!File.Exists(LocalPackagePath)) return null;

        using var zip = ZipFile.OpenRead(LocalPackagePath);
        var customizations = XDocument.Load(OpenEntry(zip, "customizations.xml"));
        var solution = XDocument.Load(OpenEntry(zip, "solution.xml"));
        var version = solution.Descendants("Version").FirstOrDefault()?.Value ?? "";

        var files = new Dictionary<string, PackageFile>(StringComparer.OrdinalIgnoreCase);
        foreach (var webResource in customizations.Descendants("WebResource"))
        {
            var name = webResource.Element("Name")?.Value;
            var fileName = webResource.Element("FileName")?.Value.TrimStart('/');
            var entry = fileName is null ? null : zip.GetEntry(fileName);
            if (name is null || entry is null) continue;
            files[name] = new PackageFile(ReadEntry(entry), ContentTypeFor(webResource.Element("WebResourceType")?.Value));
        }

        // The action's step names the plug-in type; its assembly file is extracted once per package
        // version for ProfilerHost to load.
        var pluginTypeName = customizations.Descendants("PluginTypeName").FirstOrDefault()?.Value.Split(',')[0].Trim()
            ?? throw new InvalidDataException($"{LocalPackagePath} 里没有 Ribbon Workbench 的插件步骤。");
        var assemblyFileName = customizations.Descendants("PluginAssembly").Elements("FileName").FirstOrDefault()?.Value.TrimStart('/')
            ?? throw new InvalidDataException($"{LocalPackagePath} 里没有 Ribbon Workbench 的插件程序集。");
        var assemblyPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MsdPpTools", "RibbonWorkbench", version, Path.GetFileName(assemblyFileName));
        if (!File.Exists(assemblyPath))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(assemblyPath)!);
            File.WriteAllBytes(assemblyPath, ReadEntry(zip.GetEntry(assemblyFileName)
                ?? throw new InvalidDataException($"{LocalPackagePath} 里缺少 {assemblyFileName}。")));
        }

        _package = new Package(version, files, assemblyPath, pluginTypeName);
        return _package;
    }

    private static Stream OpenEntry(ZipArchive zip, string name)
        => (zip.GetEntry(name) ?? throw new InvalidDataException($"{LocalPackagePath} 里缺少 {name}，不是有效的 solution 包。")).Open();

    private static byte[] ReadEntry(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    /// <summary>Dataverse's webresourcetype choice values.</summary>
    private static string ContentTypeFor(string? webResourceType) => webResourceType switch
    {
        "1" => "text/html; charset=utf-8",
        "2" => "text/css; charset=utf-8",
        "3" => "text/javascript; charset=utf-8",
        "4" => "text/xml; charset=utf-8",
        "5" => "image/png",
        "6" => "image/jpeg",
        "7" => "image/gif",
        "9" => "text/xsl; charset=utf-8",
        "10" => "image/x-icon",
        "11" => "image/svg+xml",
        _ => "application/octet-stream",
    };

    private static byte[]? ReadRequestBody(CoreWebView2WebResourceRequest request)
    {
        if (request.Content is null) return null;
        using var buffer = new MemoryStream();
        request.Content.CopyTo(buffer);
        return buffer.ToArray();
    }

    private CoreWebView2WebResourceResponse CreateResponse(int status, string reason, string contentType, byte[] content)
        => _webView.Environment.CreateWebResourceResponse(new MemoryStream(content), status, reason, $"Content-Type: {contentType}");

    /// <summary>One long-running `ProfilerHost rwb-serve` process, so the plug-in assembly and the
    /// Dataverse connection are loaded once rather than per call. Requests are serialized: the
    /// host answers one line per request line, in order. It exits on its own when this app does
    /// (its stdin closes).</summary>
    private sealed class ActionHostProcess
    {
        private readonly SemaphoreSlim _gate = new(1, 1);
        private readonly StringBuilder _stderrTail = new();
        private Process? _process;

        public sealed record ActionResult(string? Result, string? Error);

        public async Task<ActionResult> ExecuteAsync(object request)
        {
            await _gate.WaitAsync();
            try
            {
                var process = EnsureStarted();
                await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(request, NativeBridge.JsonOptions));
                await process.StandardInput.FlushAsync();
                var line = await process.StandardOutput.ReadLineAsync()
                    ?? throw new InvalidOperationException($"Ribbon Workbench 辅助进程意外退出：{StderrTail()}");
                using var response = JsonDocument.Parse(line);
                var root = response.RootElement;
                return root.GetProperty("ok").GetBoolean()
                    ? new ActionResult(root.GetProperty("result").GetProperty("result").GetString(), null)
                    : new ActionResult(null, root.GetProperty("error").GetString() ?? "未知错误");
            }
            finally
            {
                _gate.Release();
            }
        }

        private Process EnsureStarted()
        {
            if (_process is { HasExited: false }) return _process;
            _process?.Dispose();
            var hostPath = ProfilerHandlers.HostPath;
            if (!File.Exists(hostPath)) throw new FileNotFoundException($"缺少辅助程序：{hostPath}");
            _process = Process.Start(new ProcessStartInfo(hostPath, "rwb-serve")
            {
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardInputEncoding = new UTF8Encoding(false),
                UseShellExecute = false,
                CreateNoWindow = true,
            }) ?? throw new InvalidOperationException("无法启动 Ribbon Workbench 辅助进程。");
            // Drained continuously so a chatty stderr can't fill the pipe and stall the host.
            _process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                lock (_stderrTail)
                {
                    _stderrTail.AppendLine(e.Data);
                    if (_stderrTail.Length > 4000) _stderrTail.Remove(0, _stderrTail.Length - 4000);
                }
            };
            _process.BeginErrorReadLine();
            return _process;
        }

        private string StderrTail()
        {
            lock (_stderrTail) return _stderrTail.ToString().Trim();
        }
    }
}
