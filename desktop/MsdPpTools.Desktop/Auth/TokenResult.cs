namespace MsdPpTools.Desktop.Auth;

public sealed class TokenResult
{
    public required string AccessToken { get; init; }
    public required DateTimeOffset ExpiresOn { get; init; }
}
