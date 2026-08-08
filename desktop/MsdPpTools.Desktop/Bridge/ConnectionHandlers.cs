using System.Text.Json;
using MsdPpTools.Desktop.Connections;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>Registers the connections.* bridge methods. Secrets never leave this process —
/// list/add responses only ever carry a hasSecret flag, never the encrypted or plaintext value.</summary>
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
        bool HasCertificatePassword);

    private sealed class AddConnectionParams
    {
        public string Name { get; set; } = "";
        public string EnvironmentUrl { get; set; } = "";
        public string AuthType { get; set; } = "";
        public string? TenantId { get; set; }
        public string? ClientId { get; set; }
        public string? ClientSecret { get; set; }
        public string? CertificateFilePath { get; set; }
        public string? CertificatePassword { get; set; }
    }

    private sealed class IdParams
    {
        public string Id { get; set; } = "";
    }

    public static void Register(NativeBridge bridge, ConnectionStore store)
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
            };

            store.Add(connection);
            return Task.FromResult<object?>(ToDto(connection));
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
        !string.IsNullOrEmpty(c.EncryptedCertificatePassword));
}
