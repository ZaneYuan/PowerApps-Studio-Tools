using System.Text.Json;
using MsdPpTools.Desktop.Auth;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>Registers the auth.* bridge methods. Access tokens never cross the bridge — JS only
/// ever learns whether login succeeded; DataverseApiClient fetches the token natively.</summary>
public static class AuthHandlers
{
    private sealed class ConnectionIdParams
    {
        public string ConnectionId { get; set; } = "";
    }

    public static void Register(NativeBridge bridge, AuthService authService)
    {
        bridge.Register("auth.login", async @params =>
        {
            var input = @params.Deserialize<ConnectionIdParams>(NativeBridge.JsonOptions)
                ?? throw new ArgumentException("缺少 connectionId");
            var token = await authService.GetTokenAsync(input.ConnectionId);
            return new { success = true, expiresOn = token.ExpiresOn };
        });
    }
}
