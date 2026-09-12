# Generate dataURL avatars for 6 presets (ASCII-only script; names read from seed file)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$ids = @('preset-xiaoyan','preset-medusa','preset-xiaowu','preset-huoyuhao','preset-tangwutong','preset-baixiuxiu','preset-guyuena')
$folder = 'C:\Users\34568\Desktop\' + [string][char]0x56FE + [string][char]0x50CF  # "\u56fe\u50cf" = "\u56fe\u50cf" no: 图=56FE 像=50CF
$file = 'F:\VirtuGene-Mobile\src\lib\seed-init.ts'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($file, $utf8)
$pngs = Get-ChildItem -LiteralPath $folder -Filter *.png -File

foreach ($id in $ids) {
  # find this preset's display name from the seed file
  $mName = [regex]::Match($text, "id: '$id',[\s\S]{0,300}?name: '([^']*)',")
  if (-not $mName.Success) { Write-Output "[x] id not found: $id"; continue }
  $name = $mName.Groups[1].Value
  $png = $pngs | Where-Object { $_.BaseName -eq $name } | Select-Object -First 1
  if (-not $png) { Write-Output "[x] no image for: $name"; continue }

  $img = [System.Drawing.Image]::FromFile($png.FullName)
  $max = 256
  $scale = [Math]::Min(1.0, $max / [Math]::Max($img.Width, $img.Height))
  $w = [Math]::Max(1, [int][Math]::Round($img.Width * $scale))
  $h = [Math]::Max(1, [int][Math]::Round($img.Height * $scale))
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($img, 0, 0, $w, $h)
  $ms = New-Object System.IO.MemoryStream
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]85)
  $bmp.Save($ms, $enc, $ep)
  $b64 = [Convert]::ToBase64String($ms.ToArray())
  $img.Dispose(); $bmp.Dispose(); $g.Dispose(); $ms.Dispose()

  $dataUrl = 'data:image/jpeg;base64,' + $b64
  $pattern = "(id: '$id',[\s\S]{0,400}?avatar: ')[^']*(')"
  $newText = [regex]::Replace($text, $pattern, "`${1}$dataUrl`${2}", 1)
  if ($newText -eq $text) { Write-Output "[x] avatar replace failed: $name" }
  else { $text = $newText; Write-Output "[ok] $name ($id): ${w}x${h}, $([math]::Round($b64.Length/1KB,1))KB" }
}

[System.IO.File]::WriteAllText($file, $text, $utf8)
Write-Output ("written: " + $file + " (" + [math]::Round((Get-Item $file).Length/1KB,1) + "KB)")
