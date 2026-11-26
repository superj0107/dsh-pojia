# dsh-pojia 卸载（Windows）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#   .\uninstall.ps1 -Profile web
#   .\uninstall.ps1 -DshHome "D:\my\.dsh"
#
# 想省事就直接双击同目录的「点我一键卸载-Windows.bat」。
# 本脚本只是 install.ps1 -Uninstall 的包装，参数原样透传。

[CmdletBinding()]
param(
    [string]$DshHome,
    [ValidateSet('desktop', 'web')]
    [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot 'install.ps1'
if (-not (Test-Path -LiteralPath $installer)) {
    Write-Host "    [X] 同目录里缺少 install.ps1，无法卸载。" -ForegroundColor Red
    Write-Host "        请把压缩包完整解压后再运行（install.ps1 与 uninstall.ps1 必须在一起）。" -ForegroundColor Red
    exit 1
}

$psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installer, '-Uninstall', '-Profile', $Profile)
if ($DshHome) { $psArgs += @('-DshHome', $DshHome) }

& powershell @psArgs
exit $LASTEXITCODE
