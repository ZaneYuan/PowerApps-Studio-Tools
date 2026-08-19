using System.Diagnostics;
using System.IO;
using System.Windows;

namespace MsdPpTools.Desktop.Update;

/// <summary>
/// Release-build-only: compares the git commit this exe was published from (stamped into
/// build-commit.txt by scripts/publish-desktop.ps1) against the source checkout's current
/// HEAD. If they differ, rebuilds via `publish-desktop.ps1 -NoZip` — this is a same-machine
/// dev-loop refresh (rebuild publish\MsdPpTools.Desktop\ in place and relaunch), not a release,
/// so it deliberately skips publish.bat's zip-packaging step; that only matters when someone's
/// deliberately preparing a GitHub Release (see publish.bat itself, and
/// GitHubReleaseUpdateChecker for the update path real end users without a source checkout get
/// instead). Exits this process immediately after handing off so the exe file lock is released
/// before the rebuild tries to overwrite it.
/// </summary>
public static class UpdateChecker
{
    public static bool TryLaunchUpdateIfNeeded()
    {
        try
        {
            var exeDir = AppContext.BaseDirectory;
            var repoRoot = Path.GetFullPath(Path.Combine(exeDir, "..", ".."));
            var publishScript = Path.Combine(repoRoot, "scripts", "publish-desktop.ps1");

            if (!Directory.Exists(Path.Combine(repoRoot, ".git")) || !File.Exists(publishScript))
                return false; // not running next to a source checkout; nothing to compare against

            var currentHead = RunGit(repoRoot, "rev-parse HEAD");
            if (currentHead is null)
                return false;

            var stampPath = Path.Combine(exeDir, "build-commit.txt");
            var builtHead = File.Exists(stampPath) ? File.ReadAllText(stampPath).Trim() : null;

            if (builtHead == currentHead)
                return false; // already up to date

            var exePath = Path.Combine(exeDir, "PowerAppsStudioTools.exe");

            MessageBox.Show(
                "检测到源码有更新，将自动重新发布并重启，请稍候（会弹出一个命令行窗口显示进度）。",
                "Power Apps Studio & Tools",
                MessageBoxButton.OK,
                MessageBoxImage.Information);

            // Wait a couple seconds so this process fully exits and releases the exe file lock
            // before dotnet publish tries to overwrite it.
            var script =
                "timeout /t 2 /nobreak >nul & " +
                $"powershell -NoProfile -ExecutionPolicy Bypass -File \"{publishScript}\" -NoZip & " +
                $"if errorlevel 1 (pause) else (start \"\" \"{exePath}\")";

            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{script}\"",
                WorkingDirectory = repoRoot,
                UseShellExecute = true,
            });

            return true;
        }
        catch
        {
            return false; // never block a normal launch on update-check failures
        }
    }

    private static string? RunGit(string repoRoot, string arguments)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = arguments,
                WorkingDirectory = repoRoot,
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var process = Process.Start(psi);
            if (process is null)
                return null;

            var output = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit(5000);
            return process.ExitCode == 0 ? output : null;
        }
        catch
        {
            return null;
        }
    }
}
