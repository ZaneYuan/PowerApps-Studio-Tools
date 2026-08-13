using System.IO;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Auth;

public sealed class AuthService
{
    private static readonly string CacheDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MsdPpTools", "msal_cache");

    private readonly ConnectionStore _store;
    private readonly Dictionary<string, TokenResult> _tokenCache = new();
    // Keyed by "{clientId}|{authority}" — different connections can point at different app
    // registrations/tenants now, so this can no longer be a single shared instance. All
    // instances still share the same on-disk MSAL cache file; MSAL partitions it internally
    // by client id/authority/account, so this is safe.
    private readonly Dictionary<string, IPublicClientApplication> _publicClientApps = new();

    public AuthService(ConnectionStore store)
    {
        _store = store;
    }

    /// <summary>Drops a connection's cached token — call after editing a connection's auth
    /// fields (environment URL / tenant / client id / secret / certificate), otherwise
    /// GetTokenAsync would keep returning a token acquired under the old identity/audience
    /// until it naturally expires.</summary>
    public void InvalidateToken(string connectionId)
    {
        _tokenCache.Remove(connectionId);
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
            ConnectionAuthType.Interactive => await AcquireInteractiveTokenAsync(connection),
            ConnectionAuthType.ClientSecret => await AcquireClientSecretTokenAsync(connection),
            ConnectionAuthType.Certificate => await AcquireCertificateTokenAsync(connection),
            _ => throw new NotSupportedException($"不支持的认证方式: {connection.AuthType}"),
        };

        _tokenCache[connectionId] = token;
        return token;
    }

    /// <summary>Direct username/password sign-in (no browser popup) — mirrors the classic XRM
    /// "Microsoft Login Control" username/password fields. Only works for accounts *without*
    /// MFA/Conditional Access; those throw MsalUiRequiredException from MSAL, which is
    /// translated into a message pointing back at the normal interactive login. Credentials are
    /// used for this one token acquisition only and never persisted anywhere.</summary>
    public async Task<TokenResult> LoginWithUsernamePasswordAsync(string connectionId, string username, string password)
    {
        var connection = _store.FindById(connectionId)
            ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");
        if (connection.AuthType != ConnectionAuthType.Interactive)
        {
            throw new InvalidOperationException("只有交互式登录类型的连接支持用户名密码直接登录。");
        }

        var (clientId, authority) = ResolveInteractiveClientAndAuthority(connection);
        var app = await GetPublicClientAppAsync(clientId, authority);
        var scopes = new[] { $"{connection.EnvironmentUrl.TrimEnd('/')}/.default" };

        AuthenticationResult result;
        try
        {
            result = await app.AcquireTokenByUsernamePassword(scopes, username, password).ExecuteAsync();
        }
        catch (MsalUiRequiredException ex)
        {
            throw new InvalidOperationException(
                "这个账号需要 MFA / 条件访问，用户名密码直接登录不支持——请改用普通的\"登录 + WhoAmI\"（会弹出浏览器完成 MFA）。", ex);
        }

        var token = new TokenResult { AccessToken = result.AccessToken, ExpiresOn = result.ExpiresOn };
        _tokenCache[connectionId] = token;
        return token;
    }

    // No fallback app registration — a public-client app registration is only usable (and
    // consentable) in the tenant it was created in, so a single hardcoded default could only
    // ever work for one specific tenant and silently fails (AADSTS700016) for every other
    // account, with no indication *why* short of reading the raw AAD error. Requiring each
    // connection to state its own tenant + app registration makes that explicit instead.
    private static (string ClientId, string Authority) ResolveInteractiveClientAndAuthority(Connection connection)
    {
        if (string.IsNullOrEmpty(connection.ClientId) || string.IsNullOrEmpty(connection.TenantId))
        {
            throw new InvalidOperationException(
                "此连接缺少 Tenant ID / Client ID。交互式登录需要一个在目标租户里注册好的 App Registration" +
                "（\"Mobile and desktop applications\" 平台、redirect URI http://localhost、允许 public client flow、" +
                "并已同意 Dynamics CRM API 的委托权限）——去 Entra 后台注册一个，或者问问这个环境的管理员是不是已经有现成的，" +
                "把 Tenant ID / Client ID 填到连接里。");
        }
        return (connection.ClientId, $"https://login.microsoftonline.com/{connection.TenantId}");
    }

    private async Task<IPublicClientApplication> GetPublicClientAppAsync(string clientId, string authority)
    {
        var key = $"{clientId}|{authority}";
        if (_publicClientApps.TryGetValue(key, out var existing))
        {
            return existing;
        }

        var app = PublicClientApplicationBuilder.Create(clientId)
            .WithAuthority(authority)
            .WithRedirectUri("http://localhost")
            .Build();

        Directory.CreateDirectory(CacheDir);
        var storageProperties = new StorageCreationPropertiesBuilder("msal.cache", CacheDir).Build();
        var cacheHelper = await MsalCacheHelper.CreateAsync(storageProperties);
        cacheHelper.RegisterCache(app.UserTokenCache);

        _publicClientApps[key] = app;
        return app;
    }

    private async Task<TokenResult> AcquireInteractiveTokenAsync(Connection connection)
    {
        var (clientId, authority) = ResolveInteractiveClientAndAuthority(connection);
        var app = await GetPublicClientAppAsync(clientId, authority);
        var scopes = new[] { $"{connection.EnvironmentUrl.TrimEnd('/')}/.default" };

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

    private static async Task<TokenResult> AcquireCertificateTokenAsync(Connection connection)
    {
        if (string.IsNullOrEmpty(connection.CertificateFilePath) ||
            string.IsNullOrEmpty(connection.EncryptedCertificatePassword) ||
            string.IsNullOrEmpty(connection.ClientId) ||
            string.IsNullOrEmpty(connection.TenantId))
        {
            throw new InvalidOperationException("此连接缺少证书文件 / 证书密码 / client id / tenant id。");
        }

        var password = SecretProtector.Unprotect(connection.EncryptedCertificatePassword);

        // X509CertificateLoader (not the obsolete X509Certificate2(path, password) constructor,
        // which SYSLIB0057 deprecates from .NET 9 on) — EphemeralKeySet avoids persisting the
        // private key to the Windows key store just to acquire a token.
        var certificate = X509CertificateLoader.LoadPkcs12FromFile(
            connection.CertificateFilePath, password, X509KeyStorageFlags.EphemeralKeySet);

        var authority = $"https://login.microsoftonline.com/{connection.TenantId}";

        var app = ConfidentialClientApplicationBuilder.Create(connection.ClientId)
            .WithCertificate(certificate)
            .WithAuthority(authority)
            .Build();

        var scopes = new[] { $"{connection.EnvironmentUrl.TrimEnd('/')}/.default" };
        var result = await app.AcquireTokenForClient(scopes).ExecuteAsync();

        return new TokenResult { AccessToken = result.AccessToken, ExpiresOn = result.ExpiresOn };
    }
}
