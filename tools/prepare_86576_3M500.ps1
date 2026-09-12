param(
    [string]$WorkDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) '작업중\86576-3M500'),
    [string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) '완성본\86576-3M500')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$fontPath = Join-Path $root 'assets\fonts\NotoSans-BoldItalic.ttf'
$fontCollection = [System.Drawing.Text.PrivateFontCollection]::new()
$fontCollection.AddFontFile($fontPath)
$font = [System.Drawing.Font]::new($fontCollection.Families[0], 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

function Copy-Crop([System.Drawing.Bitmap]$source, [System.Drawing.Rectangle]$rectangle) {
    $result = [System.Drawing.Bitmap]::new($rectangle.Width, $rectangle.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($result)
    try { $graphics.DrawImage($source, 0, 0, $rectangle, [System.Drawing.GraphicsUnit]::Pixel) } finally { $graphics.Dispose() }
    return $result
}

function Find-DarkBounds([System.Drawing.Bitmap]$image, [int]$minimumY = 0) {
    $left = $image.Width; $top = $image.Height; $right = -1; $bottom = -1
    for ($y = $minimumY; $y -lt $image.Height; $y += 2) {
        for ($x = 0; $x -lt $image.Width; $x += 2) {
            $pixel = $image.GetPixel($x, $y)
            if ($pixel.R -lt 225 -or $pixel.G -lt 225 -or $pixel.B -lt 225) {
                if ($x -lt $left) { $left = $x }; if ($x -gt $right) { $right = $x }
                if ($y -lt $top) { $top = $y }; if ($y -gt $bottom) { $bottom = $y }
            }
        }
    }
    if ($right -lt 0) { throw 'Product bounds were not found.' }
    $padding = 14
    $left = [Math]::Max(0, $left - $padding); $top = [Math]::Max($minimumY, $top - $padding)
    $right = [Math]::Min($image.Width - 1, $right + $padding); $bottom = [Math]::Min($image.Height - 1, $bottom + $padding)
    return [System.Drawing.Rectangle]::new($left, $top, $right - $left + 1, $bottom - $top + 1)
}

function Make-NearWhitePure([System.Drawing.Bitmap]$image) {
    for ($y = 0; $y -lt $image.Height; $y++) {
        for ($x = 0; $x -lt $image.Width; $x++) {
            $pixel = $image.GetPixel($x, $y)
            if ($pixel.R -ge 238 -and $pixel.G -ge 238 -and $pixel.B -ge 238) { $image.SetPixel($x, $y, [System.Drawing.Color]::White) }
        }
    }
}

function New-Watermark {
    $scratch = [System.Drawing.Bitmap]::new(600, 120, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($scratch)
    try { $size = $graphics.MeasureString('KOREA AUTOPARTS', $font) } finally { $graphics.Dispose(); $scratch.Dispose() }
    $raw = [System.Drawing.Bitmap]::new([Math]::Ceiling($size.Width + 14), [Math]::Ceiling($size.Height + 14), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($raw)
    try {
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(105, 70, 70, 70))
        $foreground = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(165, 255, 255, 255))
        try { $graphics.DrawString('KOREA AUTOPARTS', $font, $shadow, 8, 8); $graphics.DrawString('KOREA AUTOPARTS', $font, $foreground, 6, 6) } finally { $shadow.Dispose(); $foreground.Dispose() }
    } finally { $graphics.Dispose() }
    $height = [Math]::Round($raw.Height * 264 / $raw.Width)
    $result = [System.Drawing.Bitmap]::new(264, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($result)
    try { $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $graphics.DrawImage($raw, 0, 0, 264, $height) } finally { $graphics.Dispose(); $raw.Dispose() }
    return $result
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$watermark = New-Watermark
try {
    for ($index = 0; $index -lt 3; $index++) {
        $clean = [System.Drawing.Bitmap]::FromFile((Join-Path $WorkDirectory ('clean\clean_{0:d2}.png' -f ($index + 1))))
        $original = $null; $label = $null; $product = $null
        try {
            $minimumY = if ($index -eq 0) { 340 } else { 0 }
            $product = Copy-Crop $clean (Find-DarkBounds $clean $minimumY)
            Make-NearWhitePure $product
            $canvas = [System.Drawing.Bitmap]::new(1000, 1000, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $graphics = [System.Drawing.Graphics]::FromImage($canvas)
            try {
                $graphics.Clear([System.Drawing.Color]::White)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $topLimit = 20
                if ($index -eq 0) {
                    $original = [System.Drawing.Bitmap]::FromFile((Join-Path $WorkDirectory 'originals\source_01.png'))
                    $label = Copy-Crop $original ([System.Drawing.Rectangle]::new(510, 18, 485, 300))
                    Make-NearWhitePure $label
                    $labelWidth = 350; $labelHeight = [Math]::Round($label.Height * $labelWidth / $label.Width)
                    $graphics.DrawImage($label, [Math]::Round((1000 - $labelWidth) / 2), 20, $labelWidth, $labelHeight)
                    $topLimit = 20 + $labelHeight + 30
                }
                $maxWidth = if ($index -eq 2) { 820 } else { 900 }
                $maxHeight = 1000 - $topLimit - 55
                $scale = [Math]::Min($maxWidth / $product.Width, $maxHeight / $product.Height)
                $width = [Math]::Round($product.Width * $scale); $height = [Math]::Round($product.Height * $scale)
                $x = [Math]::Round((1000 - $width) / 2); $y = $topLimit + [Math]::Round(($maxHeight - $height) / 2)
                $graphics.DrawImage($product, $x, $y, $width, $height)
                $graphics.DrawImage($watermark, [Math]::Round(500 - $watermark.Width / 2), [Math]::Round($y + $height / 2 - $watermark.Height / 2), $watermark.Width, $watermark.Height)
            } finally { $graphics.Dispose() }
            $suffix = if ($index -eq 0) { '' } else { "_$index" }
            $path = Join-Path $OutputDirectory "86576-3M500$suffix.png"
            $canvas.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
            $canvas.Dispose()
            Write-Output (Resolve-Path $path)
        } finally {
            if ($label) { $label.Dispose() }; if ($original) { $original.Dispose() }; if ($product) { $product.Dispose() }; $clean.Dispose()
        }
    }
} finally { $watermark.Dispose(); $font.Dispose(); $fontCollection.Dispose() }
