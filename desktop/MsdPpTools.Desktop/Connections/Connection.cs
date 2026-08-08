namespace MsdPpTools.Desktop.Connections;

public enum ConnectionAuthType
{
    Interactive,
    ClientSecret,
    Certificate,
}

public sealed class Connection
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string EnvironmentUrl { get; set; } = "";
    public ConnectionAuthType AuthType { get; set; }

    // ClientSecret and Certificate auth.
    public string? TenantId { get; set; }
    public string? ClientId { get; set; }

    /// <summary>DPAPI-protected (CurrentUser scope), base64-encoded. Never sent to the JS side —
    /// see NativeBridge's connection-listing handler, which strips this field.</summary>
    public string? EncryptedClientSecret { get; set; }

    // Certificate auth only. The .pfx path itself isn't secret (no key material), only its
    // password is — protected the same way as EncryptedClientSecret.
    public string? CertificateFilePath { get; set; }
    public string? EncryptedCertificatePassword { get; set; }
}
