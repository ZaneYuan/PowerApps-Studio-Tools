#requires -Version 5.1

# Regenerates the Windows app icon (desktop\MsdPpTools.Desktop\Assets\app.ico) from the brand SVG.
# Run manually after changing the SVG - the build does NOT call this; app.ico is committed.
#
# Rasterizes with headless Edge. The SVG is inlined into the page with an explicit width/height:
# a bare "<img src=*.svg>" whose SVG carries only a viewBox renders offset/cropped in headless
# mode, which was the bug this script originally shipped with.

param(
    [string]$SourceSvg = "public\favicon.svg",
    [string]$OutputIco = "desktop\MsdPpTools.Desktop\Assets\app.ico"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $SourceSvg))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputIco))

$edgePath = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edgePath) { throw "Microsoft Edge was not found; it is required to rasterize the SVG icon." }
if (-not (Test-Path -LiteralPath $sourcePath)) { throw "SVG source was not found: $sourcePath" }

$masterSize = 256
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)

# Inline the SVG with an explicit pixel size. Drop any XML prolog and any existing width/height on
# the root, then add width/height = the master render size so headless Edge lays it out at exactly
# that size with no offset.
$svg = Get-Content -LiteralPath $sourcePath -Raw
$svg = [regex]::Replace($svg, '<\?xml[^>]*\?>', '').Trim()
$svg = [regex]::Replace($svg, '<svg\b', '<svg')
$svg = [regex]::Replace($svg, '(?s)(<svg\b[^>]*?)\s(?:width|height)\s*=\s*"[^"]*"', '$1')
$svg = [regex]::Replace($svg, '<svg\b', ('<svg width="{0}" height="{0}"' -f $masterSize), 'None')

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$tempDir = Join-Path $tempBase ("msd365-app-icon-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    $htmlPath = Join-Path $tempDir "icon.html"
    $masterPngPath = Join-Path $tempDir ("icon-" + $masterSize + ".png")
    $html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>' + $svg + '</body></html>'
    Set-Content -LiteralPath $htmlPath -Value $html -Encoding UTF8

    $htmlUri = [Uri]::new($htmlPath).AbsoluteUri
    $edgeArgs = @(
        "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--default-background-color=00000000", "--force-device-scale-factor=1",
        ("--window-size=" + $masterSize + "," + $masterSize),
        ("--screenshot=" + $masterPngPath), $htmlUri
    )
    $edgeProcess = Start-Process -FilePath $edgePath -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden
    if (-not $edgeProcess.WaitForExit(15000)) { $edgeProcess.Kill(); throw "Timed out while rasterizing the SVG icon." }
    if ($edgeProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $masterPngPath)) { throw "Failed to rasterize the SVG icon." }

    Add-Type -AssemblyName System.Drawing
    $masterImage = [System.Drawing.Image]::FromFile($masterPngPath)
    try {
        if ($masterImage.Width -ne $masterSize -or $masterImage.Height -ne $masterSize) {
            throw ("Rasterized icon is " + $masterImage.Width + "x" + $masterImage.Height + ", expected " + $masterSize + "x" + $masterSize + " - the SVG did not fill the frame.")
        }

        $pngBytes = New-Object System.Collections.Generic.List[byte[]]
        foreach ($size in $sizes) {
            $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($masterImage, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
                $ms = New-Object System.IO.MemoryStream
                $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                $pngBytes.Add($ms.ToArray())
                $ms.Dispose()
            }
            finally { $graphics.Dispose(); $bitmap.Dispose() }
        }
    }
    finally { $masterImage.Dispose() }

    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$sizes.Count)
    $offset = 6 + (16 * $sizes.Count)
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $dim = 0
        if ($sizes[$i] -lt 256) { $dim = $sizes[$i] }
        $writer.Write([Byte]$dim); $writer.Write([Byte]$dim)
        $writer.Write([Byte]0); $writer.Write([Byte]0)
        $writer.Write([UInt16]1); $writer.Write([UInt16]32)
        $writer.Write([UInt32]$pngBytes[$i].Length); $writer.Write([UInt32]$offset)
        $offset += $pngBytes[$i].Length
    }
    foreach ($b in $pngBytes) { $writer.Write($b) }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes($outputPath, $stream.ToArray())
    $writer.Dispose(); $stream.Dispose()
    Write-Host ("Generated " + $outputPath + " (" + $sizes.Count + " sizes) from " + $SourceSvg + ".")
}
finally {
    $resolvedTempDir = [System.IO.Path]::GetFullPath($tempDir)
    if ($resolvedTempDir.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTempDir).StartsWith("msd365-app-icon-")) {
        Remove-Item -LiteralPath $resolvedTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
