# Generates the Munetios Mail logo, favicon, and PWA icons from mail/icons/mail-logo.png (square, 1024 px recommended).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/mail-icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "mail/icons/mail-logo.png"
if (-not (Test-Path $source)) { Write-Error "Save the logo image as $source first."; exit 1 }
$image = [System.Drawing.Image]::FromFile($source)

function Save-Icon([int]$size, [string]$name, [double]$scale = 1.0, [string]$background = "") {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    if ($background) { $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($background)) } else { $graphics.Clear([System.Drawing.Color]::Transparent) }
    $inner = [int]($size * $scale)
    $offset = [int](($size - $inner) / 2)
    $graphics.DrawImage($image, $offset, $offset, $inner, $inner)
    $bitmap.Save((Join-Path $root "mail/icons/$name"), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
}

Save-Icon 32 "favicon-32.png"
Save-Icon 180 "apple-touch-icon.png" 0.9 "#110736"
Save-Icon 192 "mail-192.png"
Save-Icon 512 "mail-512.png"
# Maskable icons keep the artwork inside the 80% safe zone on the app background color.
Save-Icon 512 "mail-maskable-512.png" 0.78 "#110736"
$image.Dispose()
Write-Output "Munetios Mail icons written to mail/icons/."
