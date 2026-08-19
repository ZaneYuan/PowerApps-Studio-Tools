#requires -Version 5.1
<#
Builds a standalone, double-click-runnable, self-contained copy of the desktop shell:
  npm run build (Vite prod bundle) -> dotnet publish (self-contained single-file Release
  exe - see the csproj's RuntimeIdentifier/SelfContained/PublishSingleFile properties) ->
  copy the bundle in next to the exe as wwwroot/, matching the
  SetVirtualHostNameToFolderMapping setup in MainWindow.xaml.cs's #else branch -> zip it up
  as a distributable release asset (skip this last step with -NoZip).

  The target machine needs nothing pre-installed (no .NET, no Node) - just the system's
  own Evergreen WebView2 Runtime, which Windows 11 ships with and Windows 10 gets via
  Edge/Windows Update on essentially every real machine.

Usage:
  powershell -File scripts\publish-desktop.ps1          (publish.bat's mode - also zips)
  powershell -File scripts\publish-desktop.ps1 -NoZip   (Update/UpdateChecker.cs's mode -
                                                          refreshes publish\MsdPpTools.Desktop\
                                                          only; that's all a same-machine
                                                          rebuild-and-relaunch needs, and
                                                          zipping ~65MB on every dev-machine
                                                          auto-update would just be wasted work)
Output:
  publish\MsdPpTools.Desktop\PowerAppsStudioTools.exe   (double-click to run locally)
  publish\PowerAppsStudioTools-<version>.zip            (unless -NoZip - upload this to a
                                                          GitHub Release)
#>

param(
    [switch]$NoZip
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$publishDir = Join-Path $repoRoot "publish\MsdPpTools.Desktop"
$csproj = Join-Path $repoRoot "desktop\MsdPpTools.Desktop\MsdPpTools.Desktop.csproj"
$headCommit = (git -C $repoRoot rev-parse HEAD).Trim()
# Falls back to a short commit hash when there's no tag yet (`git describe` errors on a
# tagless repo). GitHubReleaseUpdateChecker compares this string, as-is, against a GitHub
# Release's tag_name - so to make a locally-built exe report itself as "up to date" with a
# given Release, tag the exact commit you build from with that same tag name before publishing
# (e.g. `git tag 1.0.0.0`) - no particular prefix/format is required, it just has to match.
$version = git -C $repoRoot describe --tags --always 2>$null
if (-not $version) { $version = $headCommit.Substring(0, 7) }
$version = $version.Trim()

Write-Host "==> npm run build" -ForegroundColor Cyan
Push-Location $repoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host "==> dotnet publish (Release, self-contained single-file)" -ForegroundColor Cyan
if (Test-Path $publishDir) {
    # A previous run of the exe leaves a WebView2 user-data folder next to it
    # (PowerAppsStudioTools.exe.WebView2\...) whose cache/log files can stay locked for a
    # moment after the process exits. UpdateChecker's own relaunch already waits 2s before
    # getting here, but that's not a hard guarantee on a slower machine, so retry a few times
    # instead of failing the whole publish over a transient lock.
    for ($i = 1; $i -le 5; $i++) {
        try {
            Remove-Item $publishDir -Recurse -Force -ErrorAction Stop
            break
        } catch {
            if ($i -eq 5) { throw }
            Write-Host "   $publishDir is still in use (probably the app hasn't fully exited yet), retrying in 2s ($i/5)..." -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }
    }
}
dotnet publish $csproj -c Release -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (exit $LASTEXITCODE)" }

Write-Host "==> Copying frontend build into wwwroot/" -ForegroundColor Cyan
$wwwroot = Join-Path $publishDir "wwwroot"
if (Test-Path $wwwroot) { Remove-Item $wwwroot -Recurse -Force }
Copy-Item (Join-Path $repoRoot "dist") $wwwroot -Recurse

$exe = Join-Path $publishDir "PowerAppsStudioTools.exe"
if (-not (Test-Path $exe)) { throw "Expected exe not found at $exe" }

Write-Host "==> Stamping version ($version) / build commit ($headCommit)" -ForegroundColor Cyan
Set-Content -Path (Join-Path $publishDir "build-commit.txt") -Value $headCommit -NoNewline
Set-Content -Path (Join-Path $publishDir "version.txt") -Value $version -NoNewline

Write-Host ""
Write-Host "Done. Double-click to run locally:" -ForegroundColor Green
Write-Host "  $exe"

if ($NoZip) {
    Write-Host ""
    Write-Host "-NoZip: skipped packaging (this run was just refreshing publish\MsdPpTools.Desktop\)." -ForegroundColor Green
} else {
    Write-Host "==> Packaging release zip" -ForegroundColor Cyan
    $zipPath = Join-Path $repoRoot "publish\PowerAppsStudioTools-$version.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path (Join-Path $publishDir "*") -DestinationPath $zipPath

    Write-Host ""
    Write-Host "To publish a real release for other users, upload this zip to a new GitHub Release." -ForegroundColor Green
    Write-Host "Tag the release with this exact version string ($version) so GitHubReleaseUpdateChecker's comparison lines up:" -ForegroundColor Green
    Write-Host "  $zipPath"
}
