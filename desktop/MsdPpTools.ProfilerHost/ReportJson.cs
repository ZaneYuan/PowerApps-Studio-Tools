using System;
using System.Collections;
using System.IO;
using System.Runtime.Serialization;
using System.Xml;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Newtonsoft.Json.Linq;
using PluginProfiler.Plugins;
using PluginProfiler.Plugins.ServiceWrappers;

namespace MsdPpTools.ProfilerHost;

/// <summary>Turns a stored Profiler report into plain JSON for the desktop UI. SDK values are
/// flattened to their data (Entity → logicalName/id/attributes, EntityReference →
/// logicalName/id/name, OptionSetValue/Money → value) rather than serialized as .NET types.</summary>
internal static class ReportJson
{
    private const int MaxParentDepth = 8;

    public static JObject From(ProfilerPluginReport report)
    {
        var json = new JObject
        {
            ["typeName"] = report.TypeName,
            ["operationType"] = report.OperationType.ToString(),
            ["contextFormat"] = report.ExecutionContextFormat.ToString(),
            ["isolationMode"] = report.IsolationMode,
            ["executionStartTime"] = report.ExecutionStartTime,
            ["executionDurationMs"] = report.ExecutionDurationInMilliseconds,
            ["constructorException"] = report.ConstructorException,
            ["executionException"] = report.ExecutionException,
            ["replayEventCount"] = report.ReplayEvents?.Count ?? 0,
            ["unsecureConfiguration"] = report.Configuration,
        };
        if (report.OperationType == PluginProfiler.OperationType.Plugin && report.ExecutionContextFormat == ExecutionContextFormatType.Xml)
        {
            json["context"] = Context(DeserializeXmlContext(report.Context), 0);
        }
        else
        {
            json["rawContext"] = report.Context;
        }
        return json;
    }

    /// <summary>An Xml-format report stores the context as DataContract XML whose root is
    /// `z:anyType i:type="PluginExecutionContext"`, i.e. the Profiler's own wrapper type.</summary>
    private static IPluginExecutionContext DeserializeXmlContext(string xml)
    {
        var serializer = new DataContractSerializer(typeof(object), [typeof(PluginExecutionContextWrapper)]);
        using var reader = XmlReader.Create(new StringReader(xml));
        return (IPluginExecutionContext)serializer.ReadObject(reader);
    }

    private static JObject Context(IPluginExecutionContext context, int depth)
    {
        var json = new JObject
        {
            ["messageName"] = context.MessageName,
            ["stage"] = context.Stage,
            ["mode"] = context.Mode,
            ["depth"] = context.Depth,
            ["primaryEntityName"] = context.PrimaryEntityName,
            ["primaryEntityId"] = context.PrimaryEntityId,
            ["secondaryEntityName"] = context.SecondaryEntityName,
            ["userId"] = context.UserId,
            ["initiatingUserId"] = context.InitiatingUserId,
            ["businessUnitId"] = context.BusinessUnitId,
            ["organizationName"] = context.OrganizationName,
            ["correlationId"] = context.CorrelationId,
            ["requestId"] = context.RequestId,
            ["operationCreatedOn"] = context.OperationCreatedOn,
            ["isInTransaction"] = context.IsInTransaction,
            ["isolationMode"] = context.IsolationMode,
            ["inputParameters"] = Parameters(context.InputParameters),
            ["outputParameters"] = Parameters(context.OutputParameters),
            ["sharedVariables"] = Parameters(context.SharedVariables),
            ["preEntityImages"] = Images(context.PreEntityImages),
            ["postEntityImages"] = Images(context.PostEntityImages),
        };
        if (context.ParentContext is not null && depth < MaxParentDepth) json["parentContext"] = Context(context.ParentContext, depth + 1);
        return json;
    }

    private static JObject Parameters(ParameterCollection? parameters)
    {
        var json = new JObject();
        foreach (var p in parameters ?? []) json[p.Key] = Value(p.Value);
        return json;
    }

    private static JObject Images(EntityImageCollection? images)
    {
        var json = new JObject();
        foreach (var image in images ?? []) json[image.Key] = Value(image.Value);
        return json;
    }

    private static JToken Value(object? value) => value switch
    {
        null => JValue.CreateNull(),
        string or bool or int or long or decimal or double or float or Guid => new JValue(value),
        DateTime d => new JValue(d.ToString("o")),
        Entity e => new JObject
        {
            ["$type"] = "Entity",
            ["logicalName"] = e.LogicalName,
            ["id"] = e.Id,
            ["attributes"] = new JObject(e.Attributes.Select(a => new JProperty(a.Key, Value(a.Value)))),
        },
        EntityReference r => new JObject { ["$type"] = "EntityReference", ["logicalName"] = r.LogicalName, ["id"] = r.Id, ["name"] = r.Name },
        OptionSetValue o => new JObject { ["$type"] = "OptionSetValue", ["value"] = o.Value },
        Money m => new JObject { ["$type"] = "Money", ["value"] = m.Value },
        EntityCollection c => new JObject { ["$type"] = "EntityCollection", ["entityName"] = c.EntityName, ["entities"] = new JArray(c.Entities.Select(Value)) },
        IEnumerable list => new JArray(list.Cast<object?>().Select(Value)),
        _ => new JObject { ["$type"] = value.GetType().Name, ["value"] = value.ToString() },
    };
}
