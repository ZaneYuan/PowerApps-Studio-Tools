using System.Text.Json;

namespace MsdPpTools.Desktop.Bridge;

public static class DataverseHandlers
{
    private sealed class RequestParams
    {
        public string ConnectionId { get; set; } = "";
        public string Method { get; set; } = "GET";
        public string Path { get; set; } = "";
        public JsonElement? Body { get; set; }
    }

    public static void Register(NativeBridge bridge, DataverseApiClient client)
    {
        bridge.Register("dataverse.request", async @params =>
        {
            var input = @params.Deserialize<RequestParams>(NativeBridge.JsonOptions)
                ?? throw new ArgumentException("缺少请求参数");
            var result = await client.RequestAsync(input.ConnectionId, input.Method, input.Path, input.Body);
            return result;
        });
    }
}
