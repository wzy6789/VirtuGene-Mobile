# 批量跑验收套件（每套一个全新 Chrome profile，按套件收取结果文件）
#
#   powershell -File scripts/verify/run-all.ps1 -Suites phase1,phase2a,worldA
#
# 设计说明：
# - 每套件用**全新 user-data-dir**：IndexedDB 必须从零开始（迁移测试要求如此）
# - 结果由 serve.cjs 落到 scripts/verify/.last-result-<suite>.txt，
#   这里只轮询文件（不依赖管道 stdio，沙箱下更稳）
param(
  [string[]]$Suites = @(
    'index', 'phase2a', 'phase2b0', 'phase2b1', 'phase2b2', 'phase2b3', 'phase2b4',
    'phase2b5', 'phase2b6', 'phase3', 'phase3b', 'phase3c',
    'worldA', 'worldB', 'worldC', 'worldD', 'worldE', 'worldF'
  ),
  [int]$TimeoutSec = 150,
  [string]$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
)

# `powershell -File ... -Suites a,b,c` 会把整串当成一个元素，这里再拆一次
$Suites = $Suites | ForEach-Object { $_ -split ',' } | Where-Object { $_ }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$verifyDir = Join-Path $root 'scripts\verify'
$results = @()

foreach ($suite in $Suites) {
  $resultFile = Join-Path $verifyDir ".last-result-$suite.txt"
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }

  $profile = Join-Path $root ".tmp-preview\run-$suite-$(Get-Random)"
  New-Item -ItemType Directory -Force -Path $profile | Out-Null

  $proc = Start-Process -FilePath $Chrome -PassThru -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    "--user-data-dir=$profile", "http://127.0.0.1:17899/$suite.html"
  )

  $waited = 0
  # 页面的"未捕获异常上报"可能先写一次结果文件，所以不能只等文件出现，
  # 还要等它变成**最终结论**（以 ALL PASS / N FAILED 结尾）。
  while ($waited -lt $TimeoutSec) {
    if (Test-Path $resultFile) {
      $probe = [System.IO.File]::ReadAllText($resultFile, [System.Text.Encoding]::UTF8)
      if ($probe -match '(?m)(ALL PASS|\d+ FAILED)\s*$') { break }
    }
    Start-Sleep -Milliseconds 500
    $waited += 0.5
  }
  Start-Sleep -Milliseconds 300
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue

  if (Test-Path $resultFile) {
    $text = [System.IO.File]::ReadAllText($resultFile, [System.Text.Encoding]::UTF8)
    $verdict = if ($text -match 'ALL PASS') { 'PASS' } else { 'FAIL' }
    $okCount = ([regex]::Matches($text, '(?m)^ok ')).Count
    $failCount = ([regex]::Matches($text, '(?m)^FAIL ')).Count
    $results += [pscustomobject]@{ Suite = $suite; Verdict = $verdict; Ok = $okCount; Fail = $failCount; Seconds = [math]::Round($waited, 1) }
    Write-Host ("{0,-10} {1,-5} ok={2,-3} fail={3,-3} {4}s" -f $suite, $verdict, $okCount, $failCount, [math]::Round($waited, 1))
    if ($verdict -eq 'FAIL') {
      ($text -split "`n" | Where-Object { $_ -match '^FAIL ' }) | ForEach-Object { Write-Host "    $_" }
    }
  } else {
    $results += [pscustomobject]@{ Suite = $suite; Verdict = 'TIMEOUT'; Ok = 0; Fail = 0; Seconds = $waited }
    Write-Host ("{0,-10} TIMEOUT after {1}s" -f $suite, $waited)
  }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '===== 汇总 ====='
$results | Format-Table -AutoSize
$totalOk = ($results | Measure-Object -Property Ok -Sum).Sum
$totalFail = ($results | Measure-Object -Property Fail -Sum).Sum
Write-Host ("套件 {0} 个：PASS {1}，FAIL {2}，TIMEOUT {3}；断言 ok={4} fail={5}" -f `
  $results.Count,
  ($results | Where-Object Verdict -eq 'PASS').Count,
  ($results | Where-Object Verdict -eq 'FAIL').Count,
  ($results | Where-Object Verdict -eq 'TIMEOUT').Count,
  $totalOk, $totalFail)
