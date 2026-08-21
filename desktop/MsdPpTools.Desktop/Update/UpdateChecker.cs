using System.Diagnostics;
using System.IO;
using System.Windows;

namespace MsdPpTools.Desktop.Update;

/// <summary>
/// Release-build-only: compares the git commit this exe was published from (stamped into
/// build-commit.txt by scripts/publish-desktop.ps1) against the source checkout's current HEAD,
/// confirming via `git merge-base --is-ancestor` that HEAD is a genuine descendant (not just a
/// different commit - a `git reset`/checkout to an unrelated or earlier commit shouldn't read as
/// "needs rebuilding"). If confirmed behind, rebuilds via `publish-desktop.ps1 -NoZip` — this is
/// a same-machine dev-loop refresh (rebuild publish\MsdPpTools.Desktop\ in place and relaunch),
/// not a release, so it deliberately skips publish.bat's zip-packaging step; that only matters
/// when someone's deliberately preparing a GitHub Release (see publish.bat itself, and
/// GitHubReleaseUpdateChecker for the update path real end users without a source checkout get
/// instead). Exits this process immediately after handing off so the exe file lock is released
/// before the rebuild tries to overwrite it.
/// </summary>
public static class UpdateChecker
{
    /// <summary>True when the exe is sitting next to a source checkout it can rebuild from
    /// (dev machine). App.xaml.cs uses this to gate GitHubReleaseUpdateChecker: that checker's
    /// plain string comparison against the latest GitHub Release tag assumes version.txt only
    /// ever came from a past release build, which isn't true here — a dev checkout's
    /// `git describe`-based version.txt (see publish-desktop.ps1) can be *ahead* of the last
    /// release by some number of untagged commits, and a naive "different string = new version"
    /// check would offer to "update" by downloading and installing that older release over the
    /// dev's newer local build.</summary>
    public static bool IsDevCheckout()
    {
        var exeDir = AppContext.BaseDirectory;
        var repoRoot = Path.GetFullPath(Path.Combine(exeDir, "..", ".."));
        var publishScript = Path.Combine(repoRoot, "scripts", "publish-desktop.ps1");
        return Directory.Exists(Path.Combine(repoRoot, ".git")) && File.Exists(publishScript);
    }

    public static bool TryLaunchUpdateIfNeeded()
    {
        try
        {
            var exeDir = AppContext.BaseDirectory;
            var repoRoot = Path.GetFullPath(Path.Combine(exeDir, "..", ".."));
            var publishScript = Path.Combine(repoRoot, "scripts", "publish-desktop.ps1");

            if (!IsDevCheckout())
                return false; // not running next to a source checkout; nothing to compare against

            var currentHead = RunGit(repoRoot, "rev-parse HEAD");
            if (currentHead is null)
                return false;

            var stampPath = Path.Combine(exeDir, "build-commit.txt");
            var builtHead = File.Exists(stampPath) ? File.ReadAllText(stampPath).Trim() : null;

            if (builtHead == currentHead)
                return false; // already up to date

            // builtHead != currentHead alone doesn't mean "currentHead is newer" - a `git
            // reset`/checkout to an earlier or unrelated commit produces the same inequality
            // without the build actually being behind. Only prompt when currentHead is a
            // confirmed descendant of builtHead (or builtHead is missing entirely, i.e. never
            // built at all - vacuously "behind").
            if (builtHead is not null && IsAncestor(repoRoot, ancestor: builtHead, descendant: currentHead) != true)
                return false;

            var exePath = Path.Combine(exeDir, "PowerAppsStudioTools.exe");

            var result = MessageBox.Show(
                $"检测到源码有更新（当前 {builtHead?[..7]} → {currentHead[..7]}）。重新发布并重启会关闭并重启应用，当前未保存的内容会丢失（会弹出一个命令行窗口显示进度）。是否现在更新？",
                "Power Apps Studio & Tools",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (result != MessageBoxResult.Yes)
                return false;

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

    /// <summary>True/false is a confirmed answer from `git merge-base --is-ancestor` (exit 0/1);
    /// null means the command couldn't give one (missing process, invalid/unreachable commit,
    /// timeout) and callers should treat that as "don't know" rather than guessing either way.</summary>
    private static bool? IsAncestor(string repoRoot, string ancestor, string descendant)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = $"merge-base --is-ancestor {ancestor} {descendant}",
                WorkingDirectory = repoRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var process = Process.Start(psi);
            if (process is null)
                return null;

            process.WaitForExit(5000);
            return process.ExitCode switch
            {
                0 => true,
                1 => false,
                _ => null, // invalid/unknown commit or other git error - not a yes/no answer
            };
        }
        catch
        {
            return null;
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
