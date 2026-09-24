using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Tooling.Connector;
using Newtonsoft.Json.Linq;

namespace MsdPpTools.ProfilerHost;

/// <summary>Runs Ribbon Workbench's rwb_CustomiseRibbon action locally: loads the RWB2016 plug-in
/// assembly from its managed solution package and executes it with a hand-built execution context
/// whose organization service is the connection's own CrmServiceClient — so RWB works against an
/// environment that never had its solution installed (the same approach as XrmToolBox's plugin).</summary>
internal static class RibbonWorkbenchAction
{
    public const string MessageName = "rwb_CustomiseRibbon";

    /// <summary>CrmServiceClient asks the hook for a token on each call, so a long-lived client keeps
    /// working as the desktop shell hands over refreshed tokens with later requests.</summary>
    private sealed class TokenHook : IOverrideAuthHookWrapper
    {
        public string Token { get; set; } = "";
        public string GetAuthToken(Uri connectedUri) => Token;
    }

    private static readonly TokenHook Hook = new();
    private static readonly Dictionary<string, CrmServiceClient> Clients = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, IPlugin> Plugins = new(StringComparer.OrdinalIgnoreCase);
    private static bool _sdkRedirectInstalled;

    public static JToken Execute(HostRequest request)
    {
        if (string.IsNullOrEmpty(request.OrgUrl) || string.IsNullOrEmpty(request.AccessToken)
            || string.IsNullOrEmpty(request.AssemblyPath) || string.IsNullOrEmpty(request.TypeName)
            || request.Operation is null || request.Data is null)
        {
            throw new ArgumentException("orgUrl, accessToken, assemblyPath, typeName, operation and data are required.");
        }

        Hook.Token = request.AccessToken!;
        CrmServiceClient.AuthOverrideHook = Hook;
        if (!Clients.TryGetValue(request.OrgUrl!, out var client) || !client.IsReady)
        {
            client = new CrmServiceClient(new Uri(request.OrgUrl), useUniqueInstance: true);
            if (!client.IsReady) throw new InvalidOperationException($"连接 Dataverse 失败：{client.LastCrmError}");
            Clients[request.OrgUrl!] = client;
        }

        var plugin = LoadPlugin(request.AssemblyPath!, request.TypeName!);
        var context = new ActionExecutionContext(client, request.Operation, request.Data);
        var tracing = new TracingService();
        plugin.Execute(new ServiceProvider(context, tracing, client));

        return new JObject
        {
            ["result"] = context.OutputParameters.TryGetValue("Result", out var result) ? result as string : null,
            ["traces"] = new JArray(tracing.Lines),
        };
    }

    private static IPlugin LoadPlugin(string assemblyPath, string typeName)
    {
        var key = assemblyPath + "|" + typeName;
        if (Plugins.TryGetValue(key, out var cached)) return cached;

        // The plug-in is compiled against an older Microsoft.Xrm.Sdk / Crm.Sdk.Proxy than the one
        // this host ships; hand back the loaded copy instead of failing the strong-name bind.
        if (!_sdkRedirectInstalled)
        {
            var sdkAssemblies = new[] { typeof(IPlugin).Assembly, typeof(Microsoft.Crm.Sdk.Messages.WhoAmIRequest).Assembly };
            AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
                sdkAssemblies.FirstOrDefault(a => a.GetName().Name == new AssemblyName(e.Name).Name);
            _sdkRedirectInstalled = true;
        }

        var type = Assembly.LoadFrom(assemblyPath).GetType(typeName, throwOnError: true)!;
        var plugin = (IPlugin)(type.GetConstructor([typeof(string), typeof(string)]) is { } withConfig
            ? withConfig.Invoke([null, null])
            : Activator.CreateInstance(type));
        Plugins[key] = plugin;
        return plugin;
    }

    /// <summary>Program's CollectingTracingService also implements a PluginProfiler interface,
    /// which would drag in PluginProfiler.Library — not loaded for this command.</summary>
    private sealed class TracingService : ITracingService
    {
        public List<string> Lines { get; } = [];

        public void Trace(string format, params object[] args) =>
            Lines.Add(args is { Length: > 0 } ? string.Format(format, args) : format);
    }

    private sealed class ServiceProvider(IPluginExecutionContext context, ITracingService tracing, IOrganizationService service) : IServiceProvider
    {
        public object? GetService(Type serviceType)
        {
            if (serviceType == typeof(IPluginExecutionContext) || serviceType == typeof(IExecutionContext)) return context;
            if (serviceType == typeof(ITracingService)) return tracing;
            if (serviceType == typeof(IOrganizationServiceFactory)) return new ServiceFactory(service);
            return null;
        }
    }

    private sealed class ServiceFactory(IOrganizationService service) : IOrganizationServiceFactory
    {
        public IOrganizationService CreateOrganizationService(Guid? userId) => service;
    }

    /// <summary>What the platform would pass a synchronous post-operation step on an unbound
    /// custom action.</summary>
    private sealed class ActionExecutionContext : IPluginExecutionContext
    {
        public ActionExecutionContext(CrmServiceClient client, string operation, string data)
        {
            UserId = InitiatingUserId = client.GetMyCrmUserId();
            OrganizationId = client.ConnectedOrgId;
            OrganizationName = client.ConnectedOrgUniqueName;
            InputParameters = new ParameterCollection { ["Operation"] = operation, ["Data"] = data };
        }

        public int Stage => 40;
        public IPluginExecutionContext? ParentContext => null;
        public int Mode => 0;
        public int IsolationMode => 1;
        public int Depth => 1;
        public string MessageName => RibbonWorkbenchAction.MessageName;
        public string PrimaryEntityName => "none";
        public Guid? RequestId { get; } = Guid.NewGuid();
        public string SecondaryEntityName => "none";
        public ParameterCollection InputParameters { get; }
        public ParameterCollection OutputParameters { get; } = new();
        public ParameterCollection SharedVariables { get; } = new();
        public Guid UserId { get; }
        public Guid InitiatingUserId { get; }
        public Guid BusinessUnitId => Guid.Empty;
        public Guid OrganizationId { get; }
        public string OrganizationName { get; }
        public Guid PrimaryEntityId => Guid.Empty;
        public EntityImageCollection PreEntityImages { get; } = new();
        public EntityImageCollection PostEntityImages { get; } = new();
        public EntityReference? OwningExtension => null;
        public Guid CorrelationId { get; } = Guid.NewGuid();
        public bool IsExecutingOffline => false;
        public bool IsOfflinePlayback => false;
        public bool IsInTransaction => false;
        public Guid OperationId { get; } = Guid.NewGuid();
        public DateTime OperationCreatedOn { get; } = DateTime.UtcNow;
    }
}
