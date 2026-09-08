#requires -Version 5.1

param(
    [string]$SourceSvg = "public\favicon.svg",
    [string]$OutputIco = "desktop\MsdPpTools.Desktop\Assets\app.ico"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $SourceSvg))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputIco))
$edgeCandidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edgePath) { throw "Microsoft Edge was not found; it is required to rasterize the SVG icon." }
if (-not (Test-Path -LiteralPath $sourcePath)) { throw "SVG source was not found: $sourcePath" }

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$tempDir = Join-Path $tempBase ("msd365-app-icon-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    $svgUri = [Uri]::new($sourcePath).AbsoluteUri
    $sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
    $pngPaths = @()

    $masterSize = 256
    $htmlPath = Join-Path $tempDir "icon.html"
    $masterPngPath = Join-Path $tempDir "icon-$masterSize.png"
    $html = "<!doctype html><html><head><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:transparent;overflow:hidden}img{display:block;width:100%;height:100%}</style></head><body><img src='$svgUri'></body></html>"
    Set-Content -LiteralPath $htmlPath -Value $html -Encoding UTF8
    $htmlUri = [Uri]::new($htmlPath).AbsoluteUri
    $edgeArgs = @(
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--default-background-color=00000000",
        "--force-device-scale-factor=1",
        "--window-size=$masterSize,$masterSize",
        "--screenshot=$masterPngPath",
        $htmlUri
    )
    $edgeProcess = Start-Process -FilePath $edgePath -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden
    if (-not $edgeProcess.WaitForExit(15000)) {
        $edgeProcess.Kill()
        throw "Timed out while rasterizing the SVG icon."
    }
    if ($edgeProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $masterPngPath)) { throw "Failed to rasterize the SVG icon." }

    Add-Type -AssemblyName System.Drawing
    $masterImage = [System.Drawing.Image]::FromFile($masterPngPath)
    try {
        foreach ($size in $sizes) {
            $pngPath = Join-Path $tempDir "icon-$size.png"
            if ($size -eq $masterSize) {
                $pngPaths += $masterPngPath
                continue
            }
            $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($masterImage, 0, 0, $size, $size)
                $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
            }
            finally {
                $graphics.Dispose()
                $bitmap.Dispose()
            }
            $pngPaths += $pngPath
        }
    }
    finally {
        $masterImage.Dispose()
    }

    $images = @()
    foreach ($pngPath in $pngPaths) {
        $images += ,([System.IO.File]::ReadAllBytes($pngPath))
    }
    $stream = [System.IO.MemoryStream]::new()
    $writer = [System.IO.BinaryWriter]::new($stream)
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)
    $offset = 6 + (16 * $images.Count)

    for ($i = 0; $i -lt $images.Count; $i++) {
        $size = $sizes[$i]
        $writer.Write([Byte]$(if ($size -eq 256) { 0 } else { $size }))
        $writer.Write([Byte]$(if ($size -eq 256) { 0 } else { $size }))
        $writer.Write([Byte]0)
        $writer.Write([Byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$images[$i].Length)
        $writer.Write([UInt32]$offset)
        $offset += $images[$i].Length
    }

    foreach ($image in $images) { $writer.Write($image) }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes($outputPath, $stream.ToArray())
    $writer.Dispose()
    $stream.Dispose()
    Write-Host "Generated $outputPath with $($sizes.Count) sizes."
}
finally {
    $resolvedTempDir = [System.IO.Path]::GetFullPath($tempDir)
    if ($resolvedTempDir.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTempDir).StartsWith("msd365-app-icon-")) {
        Remove-Item -LiteralPath $resolvedTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
