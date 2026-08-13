using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
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

    public async Task<JsonElement?> RequestAsync(
        string connectionId, string method, string path, JsonElement? body, bool includeFormattedValues = false)
    {
        var connection = _store.FindById(connectionId)
            ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");
        var token = await _authService.GetTokenAsync(connectionId);

        var url = $"{connection.EnvironmentUrl}/api/data/v9.2/{path.TrimStart('/')}";
        using var request = new HttpRequestMessage(new HttpMethod(method), url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
        // IEEE754Compatible=false: per the OData v4 spec, Edm.Decimal/Edm.Int64 values are
        // string-encoded by default (arbitrary precision / 64-bit ints can't round-trip through
        // JSON numbers losslessly) unless the client opts out via this parameter. Without it,
        // Dataverse expects Decimal/Money fields as quoted strings — SQL4CDS sends them as plain
        // JSON numbers, which 400s with "Cannot convert ... 'Edm.Decimal' ... conflict ...
        // 'IEEE754Compatible' false/true". Setting this only on Accept (as a first attempt) did
        // NOT fix writes — confirmed against contoso-dev, still 400ing after that change shipped —
        // because Accept negotiates the *response* format; the *request body*'s format is
        // governed by Content-Type instead, which needs the same parameter (added below, once a
        // body exists). Both are set here for symmetry/correctness even though only Content-Type
        // turned out to matter for writes.
        var accept = new MediaTypeWithQualityHeaderValue("application/json");
        accept.Parameters.Add(new NameValueHeaderValue("IEEE754Compatible", "false"));
        request.Headers.Accept.Add(accept);
        request.Headers.Add("OData-MaxVersion", "4.0");
        request.Headers.Add("OData-Version", "4.0");
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
            // See the Accept-header comment above: this is the one that actually matters for
            // writes, since it's the request body's own format declaration.
            request.Content.Headers.ContentType!.Parameters.Add(new NameValueHeaderValue("IEEE754Compatible", "false"));
        }

        using var response = await Http.SendAsync(request);
        var responseText = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Dataverse 请求失败 ({(int)response.StatusCode}): {responseText}");
        }

        return string.IsNullOrWhiteSpace(responseText)
            ? null
            : JsonSerializer.Deserialize<JsonElement>(responseText);
    }
}
