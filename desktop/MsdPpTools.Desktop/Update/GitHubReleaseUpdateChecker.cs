using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Windows;

namespace MsdPpTools.Desktop.Update;

/// <summary>
/// Release-build-only: the update path for a real end user's self-contained download —
/// checks GitHub Releases for a version newer than the one stamped into version.txt at
/// publish time (see scripts/publish-desktop.ps1), and only after the user confirms in a
/// dialog, downloads the release zip and swaps it into place before relaunching.
///
/// This is deliberately separate from UpdateChecker.cs, which App.xaml.cs runs first and gates
/// this one on: UpdateChecker.IsDevCheckout() is only true when the exe sits next to a local
/// git checkout + publish.bat (a developer's own machine), which is where this checker must NOT
/// run — comparison here is a plain string match against the GitHub Release's tag_name, and a
/// dev checkout's version.txt (a `git describe` string, see publish-desktop.ps1) can be ahead of
/// the latest release by untagged commits, which this plain comparison can't distinguish from
/// "behind" — offering to "update" would actually downgrade to the last tagged release. A real
/// user's download has no .git/publish.bat, so IsDevCheckout() is false and this runs for them
/// instead. A release's tag has to exactly match what publish-desktop.ps1 stamped (i.e. publish
/// it from a checkout that's actually at that tag) for the "already latest" comparison to work.
/// </summary>
public static class GitHubReleaseUpdateChecker
{
    private const string LatestReleaseApiUrl = "https://api.github.com/repos/ZaneYuan/PowerApps-Studio-Tools/releases/latest";
    private const string ExeName = "PowerAppsStudioTools.exe";

    public static bool TryLaunchUpdateIfNeeded()
    {
        var exeDir = AppContext.BaseDirectory;
        CleanupPreviousExe(exeDir);

        try
        {
            var versionPath = Path.Combine(exeDir, "version.txt");
            if (!File.Exists(versionPath))
                return false; // not a real published build (F5 debug, or a bare `dotnet build`) — nothing to compare

            var currentVersion = File.ReadAllText(versionPath).Trim();

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            // GitHub's API 4xx's any request with no User-Agent header.
            http.DefaultRequestHeaders.UserAgent.ParseAdd("PowerAppsStudioTools-UpdateChecker");

            var json = http.GetStringAsync(LatestReleaseApiUrl).GetAwaiter().GetResult();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var latestTag = root.TryGetProperty("tag_name", out var tagProp) ? tagProp.GetString() : null;
            if (string.IsNullOrEmpty(latestTag) || latestTag == currentVersion)
                return false; // already latest, or the repo has no releases yet

            if (!root.TryGetProperty("assets", out var assetsProp))
                return false;
            var asset = assetsProp.EnumerateArray()
                .FirstOrDefault(a => (a.TryGetProperty("name", out var n) ? n.GetString() : null)
                    ?.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) == true);
            var downloadUrl = asset.ValueKind == JsonValueKind.Object && asset.TryGetProperty("browser_download_url", out var urlProp)
                ? urlProp.GetString()
                : null;
            if (string.IsNullOrEmpty(downloadUrl))
                return false; // release exists but has no zip asset attached (yet)

            var choice = MessageBox.Show(
                $"检测到新版本 {latestTag}（当前 {currentVersion}）。\n\n下载更新会关闭并重启应用，当前未保存的内容会丢失。是否现在更新？",
                "Power Apps Studio & Tools",
                MessageBoxButton.YesNo,
                MessageBoxImage.Information);
            if (choice != MessageBoxResult.Yes)
                return false;

            return DownloadAndSwap(http, downloadUrl, exeDir);
        }
        catch
        {
            return false; // update checking is best-effort — never block a normal launch
        }
    }

    /// <summary>Removes the previous update's renamed-out exe, now unlocked since that old
    /// process has long since exited. Runs unconditionally on every startup, independent of
    /// whether *this* launch finds a further update.</summary>
    private static void CleanupPreviousExe(string exeDir)
    {
        try
        {
            var oldExe = Path.Combine(exeDir, "PowerAppsStudioTools.old.exe");
            if (File.Exists(oldExe)) File.Delete(oldExe);
        }
        catch
        {
            // Still locked somehow, or no permission — harmless, try again next launch.
        }
    }

    private static bool DownloadAndSwap(HttpClient http, string downloadUrl, string exeDir)
    {
        var tempZip = Path.Combine(Path.GetTempPath(), $"PowerAppsStudioTools-update-{Guid.NewGuid():N}.zip");
        var tempExtractDir = Path.Combine(Path.GetTempPath(), $"PowerAppsStudioTools-update-{Guid.NewGuid():N}");
        try
        {
            using (var response = http.GetAsync(downloadUrl).GetAwaiter().GetResult())
            {
                response.EnsureSuccessStatusCode();
                using var fileStream = File.Create(tempZip);
                response.Content.CopyToAsync(fileStream).GetAwaiter().GetResult();
            }

            Directory.CreateDirectory(tempExtractDir);
            ZipFile.ExtractToDirectory(tempZip, tempExtractDir);

            var newExe = Path.Combine(tempExtractDir, ExeName);
            var newWwwroot = Path.Combine(tempExtractDir, "wwwroot");
            if (!File.Exists(newExe) || !Directory.Exists(newWwwroot))
                return false; // malformed/unexpected zip layout — bail instead of half-applying

            var currentExe = Path.Combine(exeDir, ExeName);
            var oldExe = Path.Combine(exeDir, "PowerAppsStudioTools.old.exe");
            if (File.Exists(oldExe)) File.Delete(oldExe);
            // Windows allows renaming a file that's currently executing (this process's own
            // exe) — it just can't be overwritten in place. This frees up the original path
            // for the new version without needing a second helper process.
            File.Move(currentExe, oldExe);

            File.Copy(newExe, currentExe, overwrite: true);
            ReplaceDirectory(newWwwroot, Path.Combine(exeDir, "wwwroot"));
            foreach (var stamp in new[] { "version.txt", "build-commit.txt" })
            {
                var src = Path.Combine(tempExtractDir, stamp);
                if (File.Exists(src)) File.Copy(src, Path.Combine(exeDir, stamp), overwrite: true);
            }

            Process.Start(new ProcessStartInfo { FileName = currentExe, UseShellExecute = true });
            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            try { File.Delete(tempZip); } catch { /* best-effort cleanup */ }
            try { Directory.Delete(tempExtractDir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    /// <summary>Replaces `destination` with a full copy of `source` — deletes any stale files
    /// the previous version left behind (a plain overwrite-copy wouldn't remove files a newer
    /// wwwroot no longer has) rather than trying to reconcile the two trees.</summary>
    private static void ReplaceDirectory(string source, string destination)
    {
        if (Directory.Exists(destination)) Directory.Delete(destination, recursive: true);
        Directory.CreateDirectory(destination);
        foreach (var dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(dir.Replace(source, destination));
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            File.Copy(file, file.Replace(source, destination), overwrite: true);
    }
}
