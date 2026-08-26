# VirtuGene Android 图标生成脚本
# 用法：pwsh -File scripts/gen-android-icons.ps1
# 源图：resources/icon.png（2048x2048 正方形，含完整品牌图形）
# 生成：legacy ic_launcher / ic_launcher_round + adaptive foreground，替换 Capacitor 默认图标
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$src = 'resources/icon.png'
$res = 'android/app/src/main/res'
$sizes = @{ 'mipmap-mdpi' = 48; 'mipmap-hdpi' = 72; 'mipmap-xhdpi' = 96; 'mipmap-xxhdpi' = 144; 'mipmap-xxxhdpi' = 192 }
# adaptive 前景安全区：108dp 画布内图标主体约占 60%，居中
$fgRatio = 0.60

if (-not (Test-Path $src)) { Write-Error "缺少源图标：$src"; exit 1 }

$source = [System.Drawing.Image]::FromFile((Resolve-Path $src))
try {
    foreach ($dir in $sizes.Keys) {
        $px = $sizes[$dir]
        $target = Join-Path $res $dir
        if (-not (Test-Path $target)) { continue }

        # legacy 图标：全尺寸缩放（方形，系统自行圆角/遮罩）
        foreach ($name in @('ic_launcher.png', 'ic_launcher_round.png')) {
            $bmp = New-Object System.Drawing.Bitmap($px, $px)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $g.DrawImage($source, 0, 0, $px, $px)
            $g.Dispose()
            $bmp.Save((Join-Path $target $name), [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            Write-Output "generated $dir/$name"
        }

        # adaptive foreground：图标缩放到 60% 居中，透明底
        $fg = New-Object System.Drawing.Bitmap($px, $px)
        $g2 = [System.Drawing.Graphics]::FromImage($fg)
        $g2.Clear([System.Drawing.Color]::Transparent)
        $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $side = [int]($px * $fgRatio)
        $off = [int](($px - $side) / 2)
        $g2.DrawImage($source, $off, $off, $side, $side)
        $g2.Dispose()
        $fg.Save((Join-Path $target 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)
        $fg.Dispose()
        Write-Output "generated $dir/ic_launcher_foreground.png"
    }
} finally {
    $source.Dispose()
}

# adaptive 背景色：品牌深色（暗夜基因紫）
$bgFile = Join-Path $res 'values/ic_launcher_background.xml'
Set-Content -Path $bgFile -Encoding utf8 -Value @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0F0F1A</color>
</resources>
'@
Write-Output "updated $bgFile -> #0F0F1A"
Write-Output "done."
