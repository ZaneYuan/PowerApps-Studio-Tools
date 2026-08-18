#requires -Version 5.1
<#
Builds a standalone, double-click-runnable, self-contained copy of the desktop shell:
  npm run build (Vite prod bundle) -> dotnet publish (self-contained single-file Release
  exe — see the csproj's RuntimeIdentifier/SelfContained/PublishSingleFile properties) ->
  copy the bundle in next to the exe as wwwroot/, matching the
  SetVirtualHostNameToFolderMapping setup in MainWindow.xaml.cs's #else branch -> zip it up
  as a distributable release asset.

  The target machine needs nothing pre-installed (no .NET, no Node) — just the system's
  own Evergreen WebView2 Runtime, which Windows 11 ships with and Windows 10 gets via
  Edge/Windows Update on essentially every real machine.

Usage: powershell -File scripts\publish-desktop.ps1
Output:
  publish\MsdPpTools.Desktop\PowerAppsStudioTools.exe   (double-click to run locally)
  publish\PowerAppsStudioTools-<version>.zip            (upload this to a GitHub Release)
#>

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$publishDir = Join-Path $repoRoot "publish\MsdPpTools.Desktop"
$csproj = Join-Path $repoRoot "desktop\MsdPpTools.Desktop\MsdPpTools.Desktop.csproj"
$headCommit = (git -C $repoRoot rev-parse HEAD).Trim()
# Falls back to a short commit hash when there's no tag yet (`git describe` errors on a
# tagless repo) — GitHubReleaseUpdateChecker only ever compares this against a GitHub
# Release's own tag_name, so it doesn't need to be a tag to work locally.
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
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
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

Write-Host "==> Packaging release zip" -ForegroundColor Cyan
$zipPath = Join-Path $repoRoot "publish\PowerAppsStudioTools-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $publishDir "*") -DestinationPath $zipPath

Write-Host ""
Write-Host "Done. Double-click to run locally:" -ForegroundColor Green
Write-Host "  $exe"
Write-Host ""
Write-Host "To publish a real release for other users, upload this zip to a new GitHub Release" -ForegroundColor Green
Write-Host "(tag it v<version> so GitHubReleaseUpdateChecker's comparison lines up):" -ForegroundColor Green
Write-Host "  $zipPath"
