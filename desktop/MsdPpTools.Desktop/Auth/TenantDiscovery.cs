using System.Collections.Concurrent;
using System.Net.Http;
using System.Text.RegularExpressions;

namespace MsdPpTools.Desktop.Auth;

/// <summary>Works out which Entra tenant (and sign-in host, for sovereign clouds) an environment
/// belongs to, so a connection never has to carry a hand-typed Tenant ID. Any Dataverse Web API
/// endpoint, hit without a token, answers 401 with a
/// <c>WWW-Authenticate: Bearer authorization_uri=https://login.microsoftonline.com/&lt;tenant&gt;/oauth2/authorize, resource_id=...</c>
/// header — the same discovery the official ServiceClient and XrmToolBox use. Client-credentials
/// flows (secret / certificate) *can't* fall back to a /common or /organizations authority, so
/// this is the only way to drop the field for them. An environment's authority never changes, so
/// results are cached for the life of the process.</summary>
public sealed class TenantDiscovery
{
    // Short timeout: one unauthenticated round-trip to the very host we're about to talk to
    // anyway, sitting in front of every token acquisition.
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    // authorization_uri=<value>, value ending at the next comma / quote / whitespace.
    private static readonly Regex AuthorizationUriPattern = new(
        @"authorization_uri\s*=\s*""?(?<uri>[^,""\s]+)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly ConcurrentDictionary<string, Task<string>> _authorityByEnvironment =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>The MSAL authority for an environment, e.g.
    /// <c>https://login.microsoftonline.com/&lt;tenant-guid&gt;</c>. The first call for a given
    /// environment does one HTTP round-trip; later calls are free. Throws with an actionable
    /// message when the environment URL is wrong/unreachable or the challenge header is missing.</summary>
    public Task<string> ResolveAuthorityAsync(string environmentUrl)
    {
        var key = environmentUrl.TrimEnd('/');
        // GetOrAdd stores the Task itself, so concurrent callers for the same env share one probe.
        return _authorityByEnvironment.GetOrAdd(key, DiscoverAsync);
    }

    private static async Task<string> DiscoverAsync(string environmentUrl)
    {
        var probeUrl = $"{environmentUrl}/api/data/v9.2/WhoAmI";

        HttpResponseMessage response;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, probeUrl);
            response = await Http.SendAsync(request).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"无法访问环境 {environmentUrl} 来自动识别 Entra 租户，请确认环境 URL 是否正确、网络是否可达。({ex.Message})", ex);
        }

        using (response)
        {
            var header = response.Headers.NonValidated.TryGetValues("WWW-Authenticate", out var values)
                ? string.Join(", ", values)
                : null;

            var match = header is null ? null : AuthorizationUriPattern.Match(header);
            if (match is not { Success: true })
            {
                throw new InvalidOperationException(
                    $"环境 {environmentUrl} 没有返回预期的登录质询（HTTP {(int)response.StatusCode}），无法自动识别租户。" +
                    "请确认这是一个有效的 Dataverse 环境 URL。");
            }

            // e.g. https://login.microsoftonline.com/<guid>/oauth2/authorize
            //   -> https://login.microsoftonline.com/<guid>
            var authority = match.Groups["uri"].Value;
            const string suffix = "/oauth2/authorize";
            if (authority.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            {
                authority = authority[..^suffix.Length];
            }
            // Older environments hand back login.windows.net; MSAL wants the current host.
            authority = authority.Replace(
                "login.windows.net", "login.microsoftonline.com", StringComparison.OrdinalIgnoreCase);
            return authority.TrimEnd('/');
        }
    }
}
