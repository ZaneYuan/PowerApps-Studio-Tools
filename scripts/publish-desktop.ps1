#requires -Version 5.1
<#
Builds a standalone, double-click-runnable local copy of the desktop shell:
  npm run build (Vite prod bundle) -> dotnet publish (Release exe) -> copy the
  bundle in next to the exe as wwwroot/, matching the SetVirtualHostNameToFolderMapping
  setup in MainWindow.xaml.cs's #else branch.

Usage: powershell -File scripts\publish-desktop.ps1
Output: publish\MsdPpTools.Desktop\PowerAppsStudioTools.exe
#>

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$publishDir = Join-Path $repoRoot "publish\MsdPpTools.Desktop"
$csproj = Join-Path $repoRoot "desktop\MsdPpTools.Desktop\MsdPpTools.Desktop.csproj"

Write-Host "==> npm run build" -ForegroundColor Cyan
Push-Location $repoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host "==> dotnet publish (Release)" -ForegroundColor Cyan
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
dotnet publish $csproj -c Release -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (exit $LASTEXITCODE)" }

Write-Host "==> Copying frontend build into wwwroot/" -ForegroundColor Cyan
$wwwroot = Join-Path $publishDir "wwwroot"
if (Test-Path $wwwroot) { Remove-Item $wwwroot -Recurse -Force }
Copy-Item (Join-Path $repoRoot "dist") $wwwroot -Recurse

$exe = Join-Path $publishDir "PowerAppsStudioTools.exe"
if (-not (Test-Path $exe)) { throw "Expected exe not found at $exe" }

Write-Host ""
Write-Host "Done. Double-click to run:" -ForegroundColor Green
Write-Host "  $exe"
