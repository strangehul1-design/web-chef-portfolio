# Готовит картинки для сайта: из исходника делает облегчённые JPEG
# нужных ширин и пишет размеры в sizes.json.
#
# Зачем: в прежней версии портфолио все 105 картинок лежали внутри
# index.html в base64 — страница весила 22,6 МБ и грузилась целиком,
# даже если человек не открывал ни одной карусели. Здесь каждая
# картинка — отдельный файл нужного размера, и браузер тянет только то,
# что видно (srcset + loading="lazy").
#
# Размеры в sizes.json нужны для width/height в разметке: браузер
# резервирует место заранее, и плитки не прыгают при загрузке.
#
# Запуск:
#   powershell -ExecutionPolicy Bypass -File tools/resize-images.ps1 `
#     -Src <папка исходников> -Dst assets/img/design -Widths 640,1600 -Quality 80
#
# Для каждого файла name.png получится name-640.jpg и name-1600.jpg.
# Картинки меньше нужной ширины не растягиваются.

param(
    [Parameter(Mandatory = $true)][string]$Src,
    [Parameter(Mandatory = $true)][string]$Dst,
    [string]$Widths = '640,1600',   # строкой: powershell -File не передаёт массивы
    [int]$Quality = 80,
    [string]$Filter = '*'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$widthList = $Widths -split '[,; ]+' | Where-Object { $_ } | ForEach-Object { [int]$_ }
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Dst)) { New-Item -ItemType Directory -Path $Dst | Out-Null }

$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq 'image/jpeg' }
$prm = New-Object System.Drawing.Imaging.EncoderParameters(1)
$prm.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)

$sizesPath = Join-Path $Dst 'sizes.json'
$sizes = @{}
if (Test-Path $sizesPath) {
    (Get-Content $sizesPath -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $sizes[$_.Name] = $_.Value }
}

$inBytes = 0; $outBytes = 0
$files = Get-ChildItem $Src -File -Filter $Filter | Where-Object { $_.Extension -match '^\.(png|jpe?g)$' }

foreach ($f in $files) {
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    $inBytes += $f.Length
    $name = [IO.Path]::GetFileNameWithoutExtension($f.Name)
    $made = @()
    foreach ($w in $widthList) {
        $tw = [Math]::Min($w, $img.Width)
        $th = [int][Math]::Round($img.Height * $tw / $img.Width)
        $bmp = New-Object System.Drawing.Bitmap($tw, $th)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.Clear([System.Drawing.Color]::White)   # прозрачность PNG в JPEG стала бы чёрной
        $g.DrawImage($img, 0, 0, $tw, $th)
        $g.Dispose()
        $out = Join-Path $Dst ("{0}-{1}.jpg" -f $name, $w)
        $bmp.Save($out, $jpeg, $prm)
        $bmp.Dispose()
        $outBytes += (Get-Item $out).Length
        $made += "$tw"
    }
    $sizes[$name] = [ordered]@{ w = $img.Width; h = $img.Height }
    $img.Dispose()
    Write-Host ("{0,-28} {1}x{2} -> {3}" -f $name, $sizes[$name].w, $sizes[$name].h, ($made -join ','))
}

$ordered = [ordered]@{}
$sizes.Keys | Sort-Object | ForEach-Object { $ordered[$_] = $sizes[$_] }
[IO.File]::WriteAllText($sizesPath, ($ordered | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))

Write-Host ("Итого: {0:N1} МБ исходников -> {1:N1} МБ файлов" -f ($inBytes / 1MB), ($outBytes / 1MB))
