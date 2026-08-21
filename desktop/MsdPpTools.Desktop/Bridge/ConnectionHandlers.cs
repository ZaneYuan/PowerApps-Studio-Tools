using System.Text.Json;
using MsdPpTools.Desktop.Auth;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>Registers the connections.* bridge methods. Secrets never leave this process —
/// list/add/update responses only ever carry a hasSecret flag, never the encrypted or plaintext
/// value; correspondingly, an empty secret field on update means "leave it unchanged", not
/// "clear it" — there's no way for the JS side to send back a secret it was never given.</summary>
public static class ConnectionHandlers
{
    private sealed record ConnectionDto(
        string Id,
        string Name,
        string EnvironmentUrl,
        string AuthType,
        string? TenantId,
        string? ClientId,
        bool HasSecret,
        string? CertificateFilePath,
        bool HasCertificatePassword,
        bool AllowWrite);

    private class AddConnectionParams
    {
        public string Name { get; set; } = "";
        public string EnvironmentUrl { get; set; } = "";
        public string AuthType { get; set; } = "";
        public string? TenantId { get; set; }
        public string? ClientId { get; set; }
        public string? ClientSecret { get; set; }
        public string? CertificateFilePath { get; set; }
        public string? CertificatePassword { get; set; }
        public bool AllowWrite { get; set; } = true;
    }

    private sealed class UpdateConnectionParams : AddConnectionParams
    {
        public string Id { get; set; } = "";
    }

    private sealed class IdParams
    {
        public string Id { get; set; } = "";
    }

    public static void Register(NativeBridge bridge, ConnectionStore store, AuthService authService)
    {
        bridge.Register("connections.list", _ =>
        {
            var dtos = store.Load().Select(ToDto).ToArray();
            return Task.FromResult<object?>(dtos);
        });

        bridge.Register("connections.add", @params =>
        {
            var input = @params.Deserialize<AddConnectionParams>(NativeBridge.JsonOptions)
                ?? throw new ArgumentException("缺少连接参数");

            if (!Enum.TryParse<ConnectionAuthType>(input.AuthType, ignoreCase: true, out var authType))
            {
                throw new ArgumentException($"未知的认证方式: {input.AuthType}");
            }

            var connection = new Connection
            {
                Name = input.Name,
                EnvironmentUrl = input.EnvironmentUrl.TrimEnd('/'),
                AuthType = authType,
                TenantId = input.TenantId,
                ClientId = input.ClientId,
                EncryptedClientSecret = string.IsNullOrEmpty(input.ClientSecret)
                    ? null
                    : SecretProtector.Protect(input.ClientSecret),
                CertificateFilePath = input.CertificateFilePath,
                EncryptedCertificatePassword = string.IsNullOrEmpty(input.CertificatePassword)
                    ? null
                    : SecretProtector.Protect(input.CertificatePassword),
                AllowWrite = input.AllowWrite,
            };

            store.Add(connection);
            return Task.FromResult<object?>(ToDto(connection));
        });

        bridge.Register("connections.update", @params =>
        {
            var input = @params.Deserialize<UpdateConnectionParams>(NativeBridge.JsonOptions)
                ?? throw new ArgumentException("缺少连接参数");

            var existing = store.FindById(input.Id)
                ?? throw new InvalidOperationException("找不到该连接，可能已被删除。");

            if (!Enum.TryParse<ConnectionAuthType>(input.AuthType, ignoreCase: true, out var authType))
            {
                throw new ArgumentException($"未知的认证方式: {input.AuthType}");
            }

            existing.Name = input.Name;
            existing.EnvironmentUrl = input.EnvironmentUrl.TrimEnd('/');
            existing.AuthType = authType;
            existing.TenantId = input.TenantId;
            existing.ClientId = input.ClientId;
            existing.CertificateFilePath = input.CertificateFilePath;
            existing.AllowWrite = input.AllowWrite;
            if (!string.IsNullOrEmpty(input.ClientSecret))
            {
                existing.EncryptedClientSecret = SecretProtector.Protect(input.ClientSecret);
            }
            if (!string.IsNullOrEmpty(input.CertificatePassword))
            {
                existing.EncryptedCertificatePassword = SecretProtector.Protect(input.CertificatePassword);
            }

            store.Update(existing);
            authService.InvalidateToken(existing.Id);
            return Task.FromResult<object?>(ToDto(existing));
        });

        bridge.Register("connections.remove", @params =>
        {
            var input = @params.Deserialize<IdParams>(NativeBridge.JsonOptions)
                ?? throw new ArgumentException("缺少连接 id");
            store.Remove(input.Id);
            return Task.FromResult<object?>(null);
        });
    }

    private static ConnectionDto ToDto(Connection c) => new(
        c.Id,
        c.Name,
        c.EnvironmentUrl,
        c.AuthType.ToString(),
        c.TenantId,
        c.ClientId,
        !string.IsNullOrEmpty(c.EncryptedClientSecret),
        c.CertificateFilePath,
        !string.IsNullOrEmpty(c.EncryptedCertificatePassword),
        c.AllowWrite);
}
