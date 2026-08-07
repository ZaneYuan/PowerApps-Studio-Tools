using System.IO;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Auth;

public sealed class AuthService
{
    // TODO: replace with the real Entra ID App Registration client id (public client,
    // "Mobile and desktop applications" redirect URI http://localhost, Dataverse delegated
    // permission). Interactive login cannot work until this is a real, registered app id —
    // see 技术设计方案.md's prerequisite note. Placeholder deliberately fails loudly rather
    // than silently mis-authenticating.
    private const string InteractiveClientId = "00000000-0000-0000-0000-000000000000";
    private const string CommonAuthority = "https://login.microsoftonline.com/common";

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
            .WithAuthority(CommonAuthority)
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
