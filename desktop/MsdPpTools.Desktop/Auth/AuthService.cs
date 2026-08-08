using System.IO;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Auth;

public sealed class AuthService
{
    // ApplicationUser1 (zane-yuan tenant) — "Mobile and desktop applications" platform with
    // redirect URI http://localhost, "Allow public client flows" enabled. See 技术设计方案.md.
    private const string InteractiveClientId = "490264e0-fa67-4eb2-ae24-0a4a918de366";

    // /organizations lets any work/school account from any tenant sign in — requires the app
    // registration itself to be set to multi-tenant ("Accounts in any organizational
    // directory") in Entra, and Dynamics CRM API permission consented in each tenant that
    // signs in. (Previously hardcoded to one specific tenant's authority, which is why this
    // was AADSTS50194 with /common — a genuinely single-tenant app rejects that endpoint. Now
    // that the app itself is multi-tenant, /organizations is the correct — not "common" —
    // choice: it excludes personal Microsoft accounts, which Dataverse never accepts anyway.)
    private const string InteractiveAuthority = "https://login.microsoftonline.com/organizations";

    private static readonly string CacheDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MsdPpTools", "msal_cache");

    private readonly ConnectionStore _store;
    private readonly Dictionary<string, TokenResult> _tokenCache = new();
    private IPublicClientApplication? _publicClientApp;

    public AuthService(ConnectionStore store)
    {
        _store = store;
    }

    /// <summary>Returns a cached token for the connection if it's still valid for at least two
    /// more minutes, otherwise acquires a new one (silently from the persisted cache when
    /// possible, falling back to an interactive prompt only when required).</summary>
    public async Task<TokenResult> GetTokenAsync(string connectionId)
    {
        if (_tokenCache.TryGetValue(connectionId, out var cached) &&
            cached.ExpiresOn > DateTimeOffset.UtcNow.AddMinutes(2))
        {
            return cached;
        }

        var connection = _store.FindById(connectionId)
            ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");

        var token = connection.AuthType switch
        {
            ConnectionAuthType.Interactive => await AcquireInteractiveTokenAsync(connection.EnvironmentUrl),
            ConnectionAuthType.ClientSecret => await AcquireClientSecretTokenAsync(connection),
            _ => throw new NotSupportedException($"不支持的认证方式: {connection.AuthType}"),
        };

        _tokenCache[connectionId] = token;
        return token;
    }

    private async Task<IPublicClientApplication> GetPublicClientAppAsync()
    {
        if (_publicClientApp is not null)
        {
            return _publicClientApp;
        }

        var app = PublicClientApplicationBuilder.Create(InteractiveClientId)
            .WithAuthority(InteractiveAuthority)
            .WithRedirectUri("http://localhost")
            .Build();

        Directory.CreateDirectory(CacheDir);
        var storageProperties = new StorageCreationPropertiesBuilder("msal.cache", CacheDir).Build();
        var cacheHelper = await MsalCacheHelper.CreateAsync(storageProperties);
        cacheHelper.RegisterCache(app.UserTokenCache);

        _publicClientApp = app;
        return app;
    }

    private async Task<TokenResult> AcquireInteractiveTokenAsync(string environmentUrl)
    {
        var app = await GetPublicClientAppAsync();
        var scopes = new[] { $"{environmentUrl.TrimEnd('/')}/.default" };

        AuthenticationResult result;
        var accounts = await app.GetAccountsAsync();
        try
        {
            result = await app.AcquireTokenSilent(scopes, accounts.FirstOrDefault()).ExecuteAsync();
        }
        catch (MsalUiRequiredException)
        {
            result = await app.AcquireTokenInteractive(scopes).ExecuteAsync();
        }

        return new TokenResult { AccessToken = result.AccessToken, ExpiresOn = result.ExpiresOn };
    }

    private static async Task<TokenResult> AcquireClientSecretTokenAsync(Connection connection)
    {
        if (string.IsNullOrEmpty(connection.EncryptedClientSecret) ||
            string.IsNullOrEmpty(connection.ClientId) ||
            string.IsNullOrEmpty(connection.TenantId))
        {
            throw new InvalidOperationException("此连接缺少 client secret / client id / tenant id。");
        }

        var secret = SecretProtector.Unprotect(connection.EncryptedClientSecret);
        var authority = $"https://login.microsoftonline.com/{connection.TenantId}";

        var app = ConfidentialClientApplicationBuilder.Create(connection.ClientId)
            .WithClientSecret(secret)
            .WithAuthority(authority)
            .Build();

        var scopes = new[] { $"{connection.EnvironmentUrl.TrimEnd('/')}/.default" };
        var result = await app.AcquireTokenForClient(scopes).ExecuteAsync();

        return new TokenResult { AccessToken = result.AccessToken, ExpiresOn = result.ExpiresOn };
    }
}
