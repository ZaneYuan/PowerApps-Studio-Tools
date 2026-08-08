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

    public async Task<JsonElement?> RequestAsync(string connectionId, string method, string path, JsonElement? body)
    {
        var connection = _store.FindById(connectionId)
            ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");
        var token = await _authService.GetTokenAsync(connectionId);

        var url = $"{connection.EnvironmentUrl}/api/data/v9.2/{path.TrimStart('/')}";
        using var request = new HttpRequestMessage(new HttpMethod(method), url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("OData-MaxVersion", "4.0");
        request.Headers.Add("OData-Version", "4.0");
        // Without this, POST creates return 204 + empty body (new id only in the OData-EntityId
        // response header). Plugin Registration needs the created record's id back inline to
        // chain the next create, so ask Dataverse to return the full representation instead.
        request.Headers.Add("Prefer", "return=representation");

        if (body.HasValue)
        {
            request.Content = new StringContent(body.Value.GetRawText(), Encoding.UTF8, "application/json");
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
