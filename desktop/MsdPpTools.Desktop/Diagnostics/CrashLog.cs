using System.IO;

namespace MsdPpTools.Desktop.Diagnostics;

/// <summary>Appends an unhandled exception's details to %AppData%\MsdPpTools\crash.log — the one
/// piece of forensic evidence that survives after the fact. A third-party crash reporter (seen in
/// practice: Baidu's IME bundles one that fires for *any* process its DLLs get injected into, not
/// just its own) can generate a much more detailed dump, but it's that vendor's file in a temp
/// directory outside our control, and it disappears once the report dialog is dismissed — this
/// file is ours, stays put, and captures at least the exception type/message/stack every time.</summary>
public static class CrashLog
{
    public static void Write(string source, Exception ex)
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MsdPpTools");
            Directory.CreateDirectory(dir);
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {source}\r\n{ex}\r\n\r\n";
            File.AppendAllText(Path.Combine(dir, "crash.log"), line);
        }
        catch
        {
            // Logging the crash must never itself throw — a full disk or a locked file here
            // would just replace one unhandled exception with another.
        }
    }
}
