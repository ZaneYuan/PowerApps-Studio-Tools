using System.Diagnostics;
using System.IO;
using System.Windows;

namespace MsdPpTools.Desktop.Update;

/// <summary>
/// Release-build-only: compares the git commit this exe was published from (stamped into
/// build-commit.txt by scripts/publish-desktop.ps1) against the source checkout's current
/// HEAD. If they differ, hands off to publish.bat to rebuild and relaunch, then exits this
/// process immediately so the exe file lock is released before publish.bat overwrites it.
/// </summary>
public static class UpdateChecker
{
    public static bool TryLaunchUpdateIfNeeded()
    {
        try
        {
            var exeDir = AppContext.BaseDirectory;
            var repoRoot = Path.GetFullPath(Path.Combine(exeDir, "..", ".."));
            var publishBat = Path.Combine(repoRoot, "publish.bat");

            if (!Directory.Exists(Path.Combine(repoRoot, ".git")) || !File.Exists(publishBat))
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

            // Wait a couple seconds so this process fully exits and releases the exe file
            // lock before publish.bat's dotnet publish tries to overwrite it. `< nul` makes
            // publish.bat's trailing `pause` no-op instead of hanging the auto-relaunch.
            var script =
                "timeout /t 2 /nobreak >nul & " +
                $"call \"{publishBat}\" < nul & " +
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
