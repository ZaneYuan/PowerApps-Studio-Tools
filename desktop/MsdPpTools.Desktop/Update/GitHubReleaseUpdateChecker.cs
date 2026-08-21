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
/// checks GitHub Releases for a version confirmed newer than the exact commit this exe was
/// built from (build-commit.txt, stamped by scripts/publish-desktop.ps1), and only after the
/// user confirms in a dialog, downloads the release zip and swaps it into place before
/// relaunching.
///
/// "Confirmed newer" is a real commit-ancestry check via GitHub's compare API (resolve the
/// release tag to its commit, then GET .../compare/{localCommit}...{releaseCommit} and require
/// status "ahead"), not a string comparison against version.txt — version.txt is a `git
/// describe` string (see publish-desktop.ps1) purely for display in the dialog. Any string
/// comparison here would be wrong for two independent reasons: (1) `git describe` output isn't
/// ordered by string comparison in general, and (2) a release cut by tagging a commit with the
/// literal `git describe` output of an earlier build (rather than a fresh clean version) makes
/// git describe stack another "-N-gHASH" suffix on every later commit's version string,
/// compounding indefinitely - see the dev's own progress notes for how the current GitHub
/// release ended up tagged "1.0.0.0-20-gd275638". The ancestry check sidesteps that mess
/// entirely: it only cares about the two commits' real relationship, never the tag's spelling.
///
/// This is deliberately separate from UpdateChecker.cs, which App.xaml.cs runs first and gates
/// this one on: UpdateChecker.IsDevCheckout() is only true when the exe sits next to a local git
/// checkout + publish.bat (a developer's own machine). A dev checkout could in principle also
/// pass the ancestry check safely, but it's kept on the local-rebuild path instead - rebuilding
/// from the dev's own exact HEAD is always at least as fresh as whatever's on GitHub, and
/// swapping in a downloaded release binary next to a live git checkout is a confusing thing to
/// do to yourself. A real user's download has no .git/publish.bat, so IsDevCheckout() is false
/// and this runs for them instead.
/// </summary>
public static class GitHubReleaseUpdateChecker
{
    private const string Owner = "ZaneYuan";
    private const string Repo = "PowerApps-Studio-Tools";
    private const string ApiBase = $"https://api.github.com/repos/{Owner}/{Repo}";
    private const string ExeName = "PowerAppsStudioTools.exe";

    public static bool TryLaunchUpdateIfNeeded()
    {
        var exeDir = AppContext.BaseDirectory;
        CleanupPreviousExe(exeDir);

        try
        {
            var buildCommitPath = Path.Combine(exeDir, "build-commit.txt");
            if (!File.Exists(buildCommitPath))
                return false; // not a real published build (F5 debug, or a bare `dotnet build`) — nothing to compare

            var localCommit = File.ReadAllText(buildCommitPath).Trim();
            var versionPath = Path.Combine(exeDir, "version.txt");
            // Display-only label - never used for the update decision itself, see class remarks.
            var currentVersion = File.Exists(versionPath) ? File.ReadAllText(versionPath).Trim() : localCommit[..7];

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            // GitHub's API 4xx's any request with no User-Agent header.
            http.DefaultRequestHeaders.UserAgent.ParseAdd("PowerAppsStudioTools-UpdateChecker");

            var json = http.GetStringAsync($"{ApiBase}/releases/latest").GetAwaiter().GetResult();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var latestTag = root.TryGetProperty("tag_name", out var tagProp) ? tagProp.GetString() : null;
            if (string.IsNullOrEmpty(latestTag))
                return false; // repo has no releases yet

            var releaseCommit = ResolveTagCommit(http, latestTag);
            if (string.IsNullOrEmpty(releaseCommit) || releaseCommit == localCommit)
                return false; // couldn't resolve the tag, or it's exactly what's already running

            if (!IsAhead(http, baseSha: localCommit, headSha: releaseCommit))
                return false; // not confirmed ahead (behind/diverged/indeterminate) - never offer what could be a downgrade

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

    /// <summary>Resolves a tag name to the commit SHA it points at. A lightweight tag's ref
    /// object IS the commit (one hop); an annotated tag's ref object is a tag object that itself
    /// points at the commit (one more hop). Returns null on any unexpected shape rather than
    /// guessing - publish-desktop.ps1's documented process (`git tag 1.0.0.0`) always creates
    /// lightweight tags, so the single-hop case is what should normally happen in practice.</summary>
    private static string? ResolveTagCommit(HttpClient http, string tag)
    {
        var refJson = http.GetStringAsync($"{ApiBase}/git/ref/tags/{Uri.EscapeDataString(tag)}").GetAwaiter().GetResult();
        using var refDoc = JsonDocument.Parse(refJson);
        if (!refDoc.RootElement.TryGetProperty("object", out var obj))
            return null;

        var sha = obj.TryGetProperty("sha", out var shaProp) ? shaProp.GetString() : null;
        var type = obj.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null;
        if (string.IsNullOrEmpty(sha))
            return null;
        if (type == "commit")
            return sha;
        if (type != "tag")
            return null; // unexpected object type - don't guess

        var tagJson = http.GetStringAsync($"{ApiBase}/git/tags/{sha}").GetAwaiter().GetResult();
        using var tagDoc = JsonDocument.Parse(tagJson);
        return tagDoc.RootElement.TryGetProperty("object", out var tagTarget) && tagTarget.TryGetProperty("sha", out var tagSha)
            ? tagSha.GetString()
            : null;
    }

    /// <summary>True only when GitHub's compare API confirms `headSha` is a strict descendant of
    /// `baseSha` (status "ahead") - i.e. every commit reachable from baseSha is also reachable
    /// from headSha, plus more. "behind" (baseSha is actually the newer one), "diverged"
    /// (unrelated history), and any other/missing status all return false, so an indeterminate
    /// comparison never gets treated as "there's an update".</summary>
    private static bool IsAhead(HttpClient http, string baseSha, string headSha)
    {
        var compareJson = http.GetStringAsync($"{ApiBase}/compare/{baseSha}...{headSha}").GetAwaiter().GetResult();
        using var compareDoc = JsonDocument.Parse(compareJson);
        var status = compareDoc.RootElement.TryGetProperty("status", out var statusProp) ? statusProp.GetString() : null;
        return status == "ahead";
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
