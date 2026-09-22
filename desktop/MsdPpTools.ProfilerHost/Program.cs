using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.Serialization;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Tooling.Connector;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PluginProfiler.Library;
using PluginProfiler.Library.Reporting;
using PluginProfiler.Plugins;
using PluginProfiler.Plugins.ServiceWrappers;

namespace MsdPpTools.ProfilerHost;

/// <summary>Request read from stdin. Which fields are required depends on the command.</summary>
internal sealed class HostRequest
{
    public string PrtDirectory { get; set; } = "";
    public string? OrgUrl { get; set; }
    public string? AccessToken { get; set; }
    public Guid StepId { get; set; }
    public Guid ProfilerStepId { get; set; }
    public string? Profile { get; set; }
    public string? AssemblyPath { get; set; }
    public string? TypeName { get; set; }
    public bool LaunchDebugger { get; set; }
}

/// <summary>Hands the desktop shell's existing MSAL access token to CrmServiceClient, so the
/// Profiler reuses the signed-in connection instead of showing its own login.</summary>
internal sealed class ExternalTokenHook(string accessToken) : IOverrideAuthHookWrapper
{
    public string GetAuthToken(Uri connectedUri) => accessToken;
}

/// <summary>Replay runs the plug-in in its own AppDomain; deriving from MarshalByRefObject makes
/// its Trace calls come back to this instance instead of to a serialized copy.</summary>
internal sealed class CollectingTracingService : MarshalByRefObject, ITracingService, IProfilerTracingService
{
    public List<string> Lines { get; } = [];

    public void Trace(string format, params object[] args) =>
        Lines.Add(args is { Length: > 0 } ? string.Format(format, args) : format);
}

internal static class Program
{
    private static string _prtDirectory = "";

    /// <summary>Commands: install | uninstall | enable | disable | decode | replay. Writes exactly
    /// one JSON line to stdout: {"ok":true,"result":…} or {"ok":false,"error":"…"}.</summary>
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.Length != 1) throw new ArgumentException("Usage: MsdPpTools.ProfilerHost <command> < request.json");
            var request = JsonConvert.DeserializeObject<HostRequest>(Console.In.ReadToEnd())
                ?? throw new ArgumentException("Empty request.");
            if (!File.Exists(Path.Combine(request.PrtDirectory, "PluginProfiler.Library.dll")))
            {
                throw new FileNotFoundException($"在 {request.PrtDirectory} 下没有找到 PluginProfiler.Library.dll。");
            }
            _prtDirectory = request.PrtDirectory;
            AppDomain.CurrentDomain.AssemblyResolve += ResolveFromPrtDirectory;

            var result = Run(args[0], request);
            Console.WriteLine(new JObject { ["ok"] = true, ["result"] = result }.ToString(Formatting.None));
            return 0;
        }
        // Process boundary: every failure is reported to the desktop shell as a JSON error line.
        catch (Exception ex)
        {
            Console.WriteLine(new JObject { ["ok"] = false, ["error"] = Describe(ex) }.ToString(Formatting.None));
            return 1;
        }
    }

    private static Assembly? ResolveFromPrtDirectory(object sender, ResolveEventArgs e)
    {
        var path = Path.Combine(_prtDirectory, new AssemblyName(e.Name).Name + ".dll");
        return File.Exists(path) ? Assembly.LoadFrom(path) : null;
    }

    private static string Describe(Exception ex)
    {
        var messages = new List<string>();
        for (var current = ex; current is not null; current = current.InnerException) messages.Add(current.Message);
        return string.Join(" → ", messages.Distinct());
    }

    private static JToken Run(string command, HostRequest request)
    {
        switch (command)
        {
            case "install":
            {
                var solution = ProfilerManagementUtility.InstallProfiler(Connect(request), request.PrtDirectory);
                return new JObject { ["solutionId"] = solution?.Id };
            }
            case "uninstall":
                ProfilerManagementUtility.UninstallProfiler(Connect(request));
                return JValue.CreateNull();
            case "enable":
            {
                var profilerStepId = ProfilerManagementUtility.EnablePlugin(
                    Connect(request), request.StepId, persistToEntity: true, persistenceSessionKey: null,
                    maxNumberOfExecutions: null, includeSecureInformation: false);
                return new JObject { ["profilerStepId"] = profilerStepId };
            }
            case "disable":
                ProfilerManagementUtility.DisablePlugin(Connect(request), request.ProfilerStepId);
                return JValue.CreateNull();
            case "decode":
                return ReportJson.From(ReadStoredProfile(request));
            case "replay":
                return Replay(request);
            default:
                throw new ArgumentException($"Unknown command \"{command}\".");
        }
    }

    private static CrmServiceClient Connect(HostRequest request)
    {
        if (string.IsNullOrEmpty(request.OrgUrl) || string.IsNullOrEmpty(request.AccessToken))
        {
            throw new ArgumentException("orgUrl and accessToken are required for this command.");
        }
        CrmServiceClient.AuthOverrideHook = new ExternalTokenHook(request.AccessToken!);
        var client = new CrmServiceClient(new Uri(request.OrgUrl), useUniqueInstance: true);
        if (!client.IsReady) throw new InvalidOperationException($"连接 Dataverse 失败：{client.LastCrmError}");
        return client;
    }

    /// <summary>`mbs_pluginprofile.mbs_profile` is the report's DataContract XML, raw-deflate
    /// compressed and base64-encoded.</summary>
    private static ProfilerPluginReport ReadStoredProfile(HostRequest request)
    {
        if (string.IsNullOrEmpty(request.Profile)) throw new ArgumentException("profile is required for this command.");
        using var deflate = new DeflateStream(new MemoryStream(Convert.FromBase64String(request.Profile)), CompressionMode.Decompress);
        return (ProfilerPluginReport)new DataContractSerializer(typeof(ProfilerPluginReport)).ReadObject(deflate);
    }

    private static JToken Replay(HostRequest request)
    {
        if (string.IsNullOrEmpty(request.AssemblyPath) || !File.Exists(request.AssemblyPath))
        {
            throw new FileNotFoundException($"插件程序集不存在：{request.AssemblyPath}");
        }
        var typeName = string.IsNullOrEmpty(request.TypeName) ? ReadStoredProfile(request).TypeName : request.TypeName;
        var operation = new PluginOperationConfiguration(request.AssemblyPath, typeName, null, request.Profile);
        var tracing = new CollectingTracingService();

        // Stops here so the developer can pick a Visual Studio instance (with the plug-in's
        // source open) as the JIT debugger before the plug-in code runs.
        if (request.LaunchDebugger && !Debugger.IsAttached) Debugger.Launch();

        var watch = Stopwatch.StartNew();
        var report = ProfilerExecutionUtility.Replay(
            PluginPermissions.NonIsolated, operation, new ProfilerReportingConfiguration(tracing), tracing, null);
        return new JObject
        {
            ["typeName"] = typeName,
            ["durationMs"] = watch.ElapsedMilliseconds,
            ["fault"] = report.Fault is null ? null : report.Fault.Message,
            ["traces"] = new JArray(tracing.Lines),
            ["organizationServiceCalls"] = report.Operations?.Count ?? 0,
        };
    }
}
