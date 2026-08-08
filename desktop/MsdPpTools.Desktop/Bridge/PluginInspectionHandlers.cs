using System.Text.Json;
using MsdPpTools.Desktop.Plugins;

namespace MsdPpTools.Desktop.Bridge;

public static class PluginInspectionHandlers
{
    private sealed class InspectParams
    {
        public string FilePath { get; set; } = "";
    }

    public static void Register(NativeBridge bridge)
    {
        bridge.Register("plugin.inspectAssembly", async @params =>
        {
            var input = @params.Deserialize<InspectParams>(NativeBridge.JsonOptions)
                ?? throw new ArgumentException("缺少 filePath");
            if (string.IsNullOrWhiteSpace(input.FilePath))
            {
                throw new ArgumentException("缺少 filePath");
            }

            // File I/O + type-walking a possibly-large DLL — handlers must not block per
            // NativeBridge's own contract, so push this off the WPF dispatcher thread.
            return (object?)await Task.Run(() => PluginAssemblyInspector.Inspect(input.FilePath));
        });
    }
}
