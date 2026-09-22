using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using MsdPpTools.Desktop.Auth;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>Registers profiler.* bridge methods. Microsoft's Plug-in Profiler only runs on .NET
/// Framework, so each call starts ProfilerHost\MsdPpTools.ProfilerHost.exe (net48), passes the
/// request as JSON on stdin — including this connection's access token, so the Profiler never
/// shows its own login — and reads one JSON result line back.</summary>
public static class ProfilerHandlers
{
    private const string PrtPackageId = "microsoft.crmsdk.xrmtooling.pluginregistrationtool";
    // The version ProfilerHost is compiled against; any other installed version is only a fallback.
    private const string PreferredPrtVersion = "9.1.0.200";

    private sealed class ProfilerParams
    {
        public string ConnectionId { get; set; } = "";
        public Guid StepId { get; set; }
        public Guid ProfilerStepId { get; set; }
        public string? Profile { get; set; }
        public string? AssemblyPath { get; set; }
        public string? TypeName { get; set; }
        public bool LaunchDebugger { get; set; }
    }

    public static void Register(NativeBridge bridge, ConnectionStore store, AuthService authService)
    {
        bridge.Register("profiler.environment", _ => Task.FromResult<object?>(new
        {
            prtDirectory = FindPrtDirectory(),
            hostAvailable = File.Exists(HostPath),
        }));

        foreach (var command in new[] { "install", "uninstall", "enable", "disable" })
        {
            bridge.Register($"profiler.{command}", async (@params, cancellationToken) =>
            {
                var input = Parse(@params);
                var connection = store.FindById(input.ConnectionId)
                    ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");
                if (!connection.AllowWrite)
                {
                    throw new InvalidOperationException($"连接 \"{connection.Name}\" 已关闭\"允许写入\"，当前为只读模式，无法修改 Profiler。");
                }
                var token = await authService.GetTokenAsync(input.ConnectionId);
                return await RunHostAsync(command, new
                {
                    orgUrl = connection.EnvironmentUrl,
                    accessToken = token.AccessToken,
                    stepId = input.StepId,
                    profilerStepId = input.ProfilerStepId,
                }, cancellationToken);
            });
        }

        bridge.Register("profiler.decode", (@params, cancellationToken) =>
            RunHostAsync("decode", new { profile = Parse(@params).Profile }, cancellationToken));

        bridge.Register("profiler.replay", (@params, cancellationToken) =>
        {
            var input = Parse(@params);
            return RunHostAsync("replay", new
            {
                profile = input.Profile,
                assemblyPath = input.AssemblyPath,
                typeName = input.TypeName,
                launchDebugger = input.LaunchDebugger,
            }, cancellationToken);
        });
    }

    private static ProfilerParams Parse(JsonElement @params) =>
        @params.Deserialize<ProfilerParams>(NativeBridge.JsonOptions) ?? throw new ArgumentException("缺少请求参数");

    private static string HostPath => Path.Combine(AppContext.BaseDirectory, "ProfilerHost", "MsdPpTools.ProfilerHost.exe");

    /// <summary>The official Plugin Registration Tool as restored by NuGet
    /// (`Microsoft.CrmSdk.XrmTooling.PluginRegistrationTool`). Its Profiler libraries are not
    /// redistributable, so they are used from the user's own copy rather than shipped.</summary>
    private static string? FindPrtDirectory()
    {
        var packagesRoot = Environment.GetEnvironmentVariable("NUGET_PACKAGES")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nuget", "packages");
        var packageDir = Path.Combine(packagesRoot, PrtPackageId);
        if (!Directory.Exists(packageDir)) return null;

        var candidates = Directory.GetDirectories(packageDir)
            .Select(dir => (dir, version: Version.TryParse(Path.GetFileName(dir), out var v) ? v : null))
            .Where(c => c.version is not null && File.Exists(Path.Combine(c.dir, "tools", "PluginProfiler.Library.dll")))
            .OrderByDescending(c => Path.GetFileName(c.dir) == PreferredPrtVersion)
            .ThenByDescending(c => c.version)
            .ToList();
        return candidates.Count > 0 ? Path.Combine(candidates[0].dir, "tools") : null;
    }

    private static async Task<object?> RunHostAsync(string command, object request, CancellationToken cancellationToken)
    {
        if (!File.Exists(HostPath)) throw new FileNotFoundException($"缺少 Profiler 辅助程序：{HostPath}");
        var prtDirectory = FindPrtDirectory()
            ?? throw new InvalidOperationException(
                $"没有找到官方 Plugin Registration Tool：NuGet 全局包目录（%USERPROFILE%\\.nuget\\packages）下需要有 {PrtPackageId}，Profiler 的程序集从那里加载。");

        var payload = JsonSerializer.SerializeToElement(request, NativeBridge.JsonOptions);
        var merged = new Dictionary<string, JsonElement> { ["prtDirectory"] = JsonSerializer.SerializeToElement(prtDirectory) };
        foreach (var property in payload.EnumerateObject()) merged[property.Name] = property.Value;

        using var process = new Process
        {
            StartInfo = new ProcessStartInfo(HostPath, command)
            {
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                UseShellExecute = false,
                CreateNoWindow = true,
            },
        };
        process.Start();
        await process.StandardInput.WriteAsync(JsonSerializer.Serialize(merged));
        process.StandardInput.Close();

        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        try
        {
            await process.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw;
        }

        var lastLine = (await stdoutTask).Split('\n', StringSplitOptions.RemoveEmptyEntries).LastOrDefault()?.Trim();
        if (string.IsNullOrEmpty(lastLine))
        {
            throw new InvalidOperationException($"Profiler 辅助程序没有返回结果（退出码 {process.ExitCode}）：{(await stderrTask).Trim()}");
        }
        using var result = JsonDocument.Parse(lastLine);
        if (!result.RootElement.GetProperty("ok").GetBoolean())
        {
            throw new InvalidOperationException(result.RootElement.GetProperty("error").GetString());
        }
        return result.RootElement.GetProperty("result").Clone();
    }
}
