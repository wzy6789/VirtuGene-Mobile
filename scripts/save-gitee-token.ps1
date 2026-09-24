# 在本机安全输入 Gitee 私人令牌并交给已配置的 Git Credential Manager。
# 不把令牌写进仓库、命令行历史或终端输出。
$ErrorActionPreference = 'Stop'
$secureToken = Read-Host '请在此粘贴 Gitee 私人令牌（输入不会显示）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $credential = "protocol=https`nhost=gitee.com`nusername=wang-zhiyi6789`npassword=$plainToken`n`n"
    $credential | git credential approve
    if ($LASTEXITCODE -ne 0) { throw 'Git Credential Manager 未保存令牌' }
    Write-Host 'Gitee 令牌已保存到本机凭据管理器。'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Variable plainToken, credential -ErrorAction SilentlyContinue
}
