using Microsoft.Win32;

namespace MsdPpTools.Desktop.Bridge;

/// <summary>Registers dialog.* bridge methods — native file pickers the JS side can't do itself.</summary>
public static class DialogHandlers
{
    public static void Register(NativeBridge bridge)
    {
        bridge.Register("dialog.pickFile", _ =>
        {
            var dialog = new OpenFileDialog
            {
                Title = "选择插件程序集 (.dll)",
                Filter = "程序集文件 (*.dll)|*.dll|所有文件 (*.*)|*.*",
                CheckFileExists = true,
            };

            var owner = System.Windows.Application.Current?.MainWindow;
            var ok = owner is not null ? dialog.ShowDialog(owner) : dialog.ShowDialog();

            object result = ok == true
                ? new { filePath = (string?)dialog.FileName, fileName = (string?)System.IO.Path.GetFileName(dialog.FileName) }
                : new { filePath = (string?)null, fileName = (string?)null };

            return Task.FromResult<object?>(result);
        });
    }
}
