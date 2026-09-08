using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MsdPpTools.Desktop.Auth;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>Makes authenticated Dataverse Web API calls natively — the WebView2's JS never
/// fetches Dataverse directly, which is what sidesteps its per-environment CORS allow-list.</summary>
public sealed class DataverseApiClient
{
    // Default HttpClient timeout is 100s. Solution export/import (Ribbon Workbench) can run
    // longer than that on a real org — without this, the request gets aborted here right as
    // the JS-side caller's own (longer, explicitly-opted-in) timeout is still waiting on it.
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(5) };

    private readonly AuthService _authService;
    private readonly ConnectionStore _store;

    public DataverseApiClient(AuthService authService, ConnectionStore store)
    {
        _authService = authService;
        _store = store;
    }

    // Matches the trailing `(<guid>)` in an OData-EntityId response header, e.g.
    // ".../EntityDefinitions(00aa00aa-bb11-cc22-dd33-44ee44ee44ee)" or
    // ".../EntityDefinitions(LogicalName='x')/Attributes(11bb...)" — always the last parenthesized
    // GUID regardless of which collection (EntityDefinitions vs its Attributes nav property) or
    // key style (MetadataId vs LogicalName=' ') precedes it.
    private static readonly Regex EntityIdGuidPattern = new(@"\(([0-9a-fA-F-]{36})\)(?!.*\()", RegexOptions.Compiled);

    /// <summary>Returns a <see cref="RawJson"/> wrapping the response body verbatim (or a small
    /// synthesized object for a 204 metadata write, or null). The bridge splices RawJson straight
    /// into its outgoing message without re-parsing — a query result can be tens of MB, and
    /// deserializing it to a JsonElement here just to re-serialize it in NativeBridge was a
    /// multi-second UI-thread stall per page once the paged-query loop started firing several such
    /// responses in a row.</summary>
    public async Task<object?> RequestAsync(
        string connectionId, string method, string path, JsonElement? body, bool includeFormattedValues = false,
        string? solutionUniqueName = null, CancellationToken cancellationToken = default)
    {
        var connection = _store.FindById(connectionId)
            ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");

        // System-level write gate (Connection.AllowWrite). GET is the only verb the Web API ever
        // uses for reads here — every write call site in the app (create/update/delete/associate/
        // executeaction/publish/etc.) uses POST, PATCH or DELETE, so blocking non-GET is a
        // complete, tool-agnostic enforcement point.
        if (!connection.AllowWrite && !string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"连接 \"{connection.Name}\" 已关闭\"允许写入\"，当前为只读模式，无法执行 {method} 操作。");
        }

        var token = await _authService.GetTokenAsync(connectionId).ConfigureAwait(false);

        var url = $"{connection.EnvironmentUrl}/api/data/v9.2/{path.TrimStart('/')}";
        using var request = new HttpRequestMessage(new HttpMethod(method), url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("OData-MaxVersion", "4.0");
        request.Headers.Add("OData-Version", "4.0");
        // Associates a solution component created by this request (table/column/etc.) with a
        // specific unmanaged solution — the Web API metadata docs' documented mechanism, an
        // optional request header rather than a query parameter or body property.
        if (!string.IsNullOrEmpty(solutionUniqueName))
        {
            request.Headers.Add("MSCRM.SolutionUniqueName", solutionUniqueName);
        }
        // return=representation: without this, POST creates return 204 + empty body (new id only
        // in the OData-EntityId response header). Plugin Registration needs the created record's
        // id back inline to chain the next create, so ask for the full representation always.
        // odata.include-annotations: opt-in per-call (Record Explorer) — adds FormattedValue
        // (human-readable picklist/lookup labels) and lookuplogicalname (which entity a
        // polymorphic lookup actually points to) annotations to the response. Left off by
        // default since it adds extra `@...` keys other tools' result tables don't expect.
        var prefer = includeFormattedValues
            ? "return=representation,odata.include-annotations=\"OData.Community.Display.V1.FormattedValue,Microsoft.Dynamics.CRM.lookuplogicalname\""
            : "return=representation";
        request.Headers.Add("Prefer", prefer);

        if (body.HasValue)
        {
            request.Content = new StringContent(body.Value.GetRawText(), Encoding.UTF8, "application/json");
        }

        // Default completion option (ResponseContentRead): the whole body is buffered before this
        // returns, so HttpClient.Timeout covers the full download. ResponseHeadersRead would stop
        // the timeout applying once headers arrive, letting a stalled body transfer hang until the
        // JS-side timeout — only worth it for streaming, which this isn't.
        using var response = await Http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Dataverse 请求失败 ({(int)response.StatusCode}): {responseText}");
        }

        if (!string.IsNullOrWhiteSpace(responseText))
        {
            return new RawJson(responseText);
        }

        // Metadata writes (POST EntityDefinitions / its Attributes nav property) don't honor
        // `Prefer: return=representation` the way normal record writes do — they always answer
        // 204 No Content, with the new MetadataId only in the OData-EntityId response header, per
        // Microsoft's current Web API docs. Synthesize a small body from that header so callers
        // (solution-editor's createTable/createColumn) can still get the new id back; every other
        // caller either gets a real body already (normal POST/PATCH) or has never sent a
        // metadata-write request, so this branch is unreachable for existing call sites.
        if (response.Headers.TryGetValues("OData-EntityId", out var entityIdHeaderValues))
        {
            var match = EntityIdGuidPattern.Match(entityIdHeaderValues.FirstOrDefault() ?? "");
            if (match.Success)
            {
                return new { odataEntityId = match.Groups[1].Value };
            }
        }

        return null;
    }
}
