# dsh-pojia 一键安装 / 卸载（Windows，DSH 0.2.2-rc.5）
#
# 用法（在解压后的目录里，右键"用 PowerShell 运行"，或先执行：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# ）：
#   .\install.ps1                       # 安装到默认 DSH（$env:DSH_HOME 或 %USERPROFILE%\.dsh）的 desktop profile
#   .\install.ps1 -Profile web          # 装到 web profile
#   .\install.ps1 -DshHome "D:\my\.dsh" # 指定隔离 home
#   .\install.ps1 -Uninstall            # 卸载（删除插件目录、profile 注册与 bundle 行）
#
# 说明：本脚本只改你指定的 DSH home 下那一个 profile，不动其它数据目录。
# 安装后请完全退出并重新打开 DSH，然后在会话标题旁 dsh-pojia 面板点「应用」。

[CmdletBinding()]
param(
    [string]$DshHome,
    [ValidateSet('desktop', 'web')]
    [string]$Profile = 'desktop',
    [switch]$Uninstall,
    [switch]$SkipPnpmInstall
)

$ErrorActionPreference = 'Stop'
$pluginName = 'dsh-pojia'
$srcDir = $PSScriptRoot

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    [OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "    [!] $Msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$Msg) Write-Host "    [X] $Msg" -ForegroundColor Red }

function Get-Utf8([string]$Path) { return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) }
function Set-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# --- 解析 home / profile ---
if (-not $DshHome) { $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' } }
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$pluginsDir = Join-Path $DshHome 'plugins'
$targetDir = Join-Path $pluginsDir $pluginName

Write-Step "目标 home: $DshHome"
if (-not (Test-Path -LiteralPath (Join-Path $DshHome 'profiles') -PathType Container)) {
    Write-Err "目录里没有 profiles 子目录：$DshHome。请先启动一次 DSH 生成 profile。"
    exit 1
}
if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) {
    Write-Err "profile 不存在：$profileDir"
    exit 1
}
Write-Ok "profile: $profileDir"

function Edit-ProfilePackage([bool]$Install) {
    $pkg = Join-Path $profileDir 'package.json'
    if (-not (Test-Path $pkg)) { Write-Err "缺少 package.json: $pkg"; exit 1 }
    $json = Get-Content -Raw -LiteralPath $pkg -Encoding utf8 | ConvertFrom-Json
    if (-not $json.dsh -or -not $json.dsh.profile) { Write-Err "profile 结构异常（缺 dsh.profile）: $pkg"; exit 1 }

    if ($Install) {
        if (-not $json.dependencies) { $json.dependencies = [ordered]@{} }
        $json.dependencies | Add-Member -NotePropertyName $pluginName -NotePropertyValue "file:../../plugins/$pluginName" -Force
        $bundles = @($json.dsh.profile.bundles | Where-Object { $_ -ne $pluginName }) + $pluginName
        $json.dsh.profile.bundles = $bundles
    } else {
        if ($json.dependencies.PSObject.Properties.Name -contains $pluginName) {
            $json.dependencies.PSObject.Properties.Remove($pluginName)
        }
        $json.dsh.profile.bundles = @($json.dsh.profile.bundles | Where-Object { $_ -ne $pluginName })
    }
    # 保留顺序：deps 用 OrderedDictionary 序列化
    $out = $json | ConvertTo-Json -Depth 12
    Set-Utf8 $pkg ($out + "`n")
    Write-Ok "package.json 已更新（$pluginName）"
}

# 与 install.sh（macOS/Linux）共用同一对标记，两个脚本可互相幂等卸载。
$BEGIN = "# >>> dsh-pojia managed block - do not edit inside"
$BEGIN_LEGACY = "# >>> dsh-pojia managed block (install.ps1) - do not edit inside"
$END   = "# <<< dsh-pojia managed block"

function Remove-ManagedBlock([string]$Text) {
    foreach ($marker in @($BEGIN, $BEGIN_LEGACY)) {
        $i = $Text.IndexOf($marker)
        while ($i -ge 0) {
            $j = $Text.IndexOf($END, $i)
            if ($j -lt 0) { break }
            $j += $END.Length
            if ($j -lt $Text.Length -and $Text[$j] -eq "`r") { $j++ }
            if ($j -lt $Text.Length -and $Text[$j] -eq "`n") { $j++ }
            $Text = $Text.Substring(0, $i) + $Text.Substring($j)
            $i = $Text.IndexOf($marker)
        }
    }
    return $Text
}

function Edit-ProfilePatch([bool]$Install) {
    $patch = Join-Path $profileDir 'cordis.patch.yml'
    if (-not (Test-Path $patch)) { Write-Warn "cordis.patch.yml 不存在，跳过 patch 注册"; return }
    $text = Get-Utf8 $patch
    # 先移除旧块（幂等）
    $text = Remove-ManagedBlock $text
    if ($Install) {
        $block = ""
        if (-not $text.EndsWith("`n")) { $block += "`n" }
        $block += "$BEGIN`n" +
                  "- insert:`n" +
                  "    - id: dsh-pojia`n" +
                  "      name: 'dsh-pojia'`n" +
                  "`n$END`n"
        $text += $block
    }
    Set-Utf8 $patch $text
    Write-Ok "cordis.patch.yml 已更新"
}

if ($Uninstall) {
    Write-Step "卸载 $pluginName"
    Edit-ProfilePackage $false
    Edit-ProfilePatch $false
    if (Test-Path -LiteralPath $targetDir) {
        Remove-Item -LiteralPath $targetDir -Recurse -Force
        Write-Ok "已删除 $targetDir"
    } else {
        Write-Warn "插件目录不存在：$targetDir"
    }
    Write-Host "`n卸载完成。请完全退出并重新打开 DSH。" -ForegroundColor Green
    exit 0
}

# --- 安装 ---
if (-not (Test-Path -LiteralPath (Join-Path $srcDir 'package.json'))) {
    Write-Err "当前目录不像插件包（缺 package.json）：$srcDir"
    exit 1
}
Write-Step "复制插件到 $targetDir"
if (-not (Test-Path -LiteralPath $pluginsDir)) { New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null }
if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
Copy-Item -LiteralPath $srcDir -Destination $targetDir -Recurse -Force
# 不把安装脚本自身和压缩包带进插件目录
foreach ($junk in @('install.ps1', 'install.sh')) {
    Remove-Item -LiteralPath (Join-Path $targetDir $junk) -Force -ErrorAction SilentlyContinue
}
Remove-Item -Path (Join-Path $targetDir '*.zip') -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $targetDir '*.tgz') -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $targetDir 'dsh-pojia-*-installer') -Recurse -Force -ErrorAction SilentlyContinue
Write-Ok "插件已复制"

Edit-ProfilePackage $true
Edit-ProfilePatch $true

# --- pnpm install（写依赖到 node_modules）---
if (-not $SkipPnpmInstall) {
    Write-Step "安装依赖（pnpm）"
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($pnpmCmd) {
        Push-Location $profileDir
        try { & pnpm install --config.confirmModulesPurge=false 2>&1 | Out-String | Write-Host }
        finally { Pop-Location }
        Write-Ok "pnpm install 完成"
    } else {
        Write-Warn "未找到 pnpm，跳过依赖安装。请先安装 Node.js 20+ 与 pnpm，然后手动在该 profile 目录运行 pnpm install。"
    }
}

Write-Host "`n安装完成。请完全退出并重新打开 DSH，然后在 dsh-pojia 面板点「应用」。" -ForegroundColor Green
