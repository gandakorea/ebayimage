param(
    [Parameter(Mandatory)][string]$InputDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$PartNumber
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path $PSScriptRoot -Parent
$fontPath = Join-Path $projectRoot 'assets\fonts\NotoSans-BoldItalic.ttf'
if (-not (Test-Path -LiteralPath $fontPath)) { throw "Missing watermark font: $fontPath" }

$fontCollection = [System.Drawing.Text.PrivateFontCollection]::new()
$fontCollection.AddFontFile($fontPath)
$font = [System.Drawing.Font]::new($fontCollection.Families[0], 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

function New-WatermarkBitmap {
    $scratch = [System.Drawing.Bitmap]::new(600, 120, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($scratch)
    try {
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $size = $graphics.MeasureString('KOREA AUTOPARTS', $font)
        $rawWidth = [Math]::Ceiling($size.Width + 12)
        $rawHeight = [Math]::Ceiling($size.Height + 12)
    } finally {
        $graphics.Dispose()
        $scratch.Dispose()
    }

    $raw = [System.Drawing.Bitmap]::new($rawWidth, $rawHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($raw)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(105, 70, 70, 70))
        $foreground = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(165, 255, 255, 255))
        try {
            $graphics.DrawString('KOREA AUTOPARTS', $font, $shadow, 8, 8)
            $graphics.DrawString('KOREA AUTOPARTS', $font, $foreground, 6, 6)
        } finally {
            $shadow.Dispose()
            $foreground.Dispose()
        }
    } finally { $graphics.Dispose() }

    $targetWidth = 264
    $targetHeight = [Math]::Round($raw.Height * $targetWidth / $raw.Width)
    $watermark = [System.Drawing.Bitmap]::new($targetWidth, $targetHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($watermark)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($raw, 0, 0, $targetWidth, $targetHeight)
    } finally {
        $graphics.Dispose()
        $raw.Dispose()
    }
    $watermark
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$inputs = @(Get-ChildItem -LiteralPath $InputDirectory -Filter 'clean_*.png' -File | Sort-Object Name)
if ($inputs.Count -eq 0) { throw "No clean PNG files in $InputDirectory" }
$watermark = New-WatermarkBitmap

try {
    for ($index = 0; $index -lt $inputs.Count; $index++) {
        $source = [System.Drawing.Image]::FromFile($inputs[$index].FullName)
        $canvas = [System.Drawing.Bitmap]::new(1000, 1000, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [System.Drawing.Graphics]::FromImage($canvas)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $scale = [Math]::Min(1000.0 / $source.Width, 1000.0 / $source.Height)
            $width = [Math]::Round($source.Width * $scale)
            $height = [Math]::Round($source.Height * $scale)
            $x = [Math]::Round((1000 - $width) / 2)
            $y = [Math]::Round((1000 - $height) / 2)
            $graphics.DrawImage($source, $x, $y, $width, $height)
            $watermarkX = [Math]::Round((1000 - $watermark.Width) / 2)
            $watermarkY = [Math]::Round((1000 - $watermark.Height) / 2)
            $graphics.DrawImage($watermark, $watermarkX, $watermarkY, $watermark.Width, $watermark.Height)
        } finally {
            $graphics.Dispose()
            $source.Dispose()
        }
        $suffix = if ($index -eq 0) { '' } else { "_$index" }
        $destination = Join-Path $OutputDirectory "$PartNumber$suffix.png"
        $canvas.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
        $canvas.Dispose()
        Write-Output (Resolve-Path -LiteralPath $destination)
    }
} finally {
    $watermark.Dispose()
    $font.Dispose()
    $fontCollection.Dispose()
}
