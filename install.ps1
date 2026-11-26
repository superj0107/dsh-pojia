# dsh-pojia 一键安装 / 卸载（Windows，DSH 0.2.2-rc.5）
#
# 用法（在解压后的目录里，右键"用 PowerShell 运行"，或先执行：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# ）：
#   .\install.ps1                       # 安装到默认 DSH（$env:DSH_HOME 或 %USERPROFILE%\.dsh）的 desktop profile
#   .\install.ps1 -Profile web          # 装到 web profile
#   .\install.ps1 -DshHome "D:\my\.dsh" # 指定隔离 home
#   .\install.ps1 -Yes                  # 缺依赖（Node.js / pnpm）时不问，直接装
#   .\install.ps1 -NoDeps               # 缺依赖时只警告，不装、不提问
#   .\install.ps1 -Uninstall            # 卸载（删除插件目录、profile 注册与 bundle 行）
#
# 说明：本脚本只改你指定的 DSH home 下那一个 profile，不动其它数据目录。
# 安装后请完全退出并重新打开 DSH，然后在会话标题旁 dsh-pojia 面板点「应用」。
# 缺 Node.js / pnpm 时会问你要不要自动装：同意就用 winget 或官方 zip（Node）/
# npm -g 或 corepack（pnpm）装，卸载和回滚不影响系统其它部分。

[CmdletBinding()]
param(
    [string]$DshHome,
    [ValidateSet('desktop', 'web')]
    [string]$Profile = 'desktop',
    [switch]$Uninstall,
    [switch]$SkipPnpmInstall,
    [switch]$Yes,
    [switch]$NoDeps
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
$toolchainDir = Join-Path $DshHome 'toolchain'

# --- 依赖（Node.js / pnpm）探测与自动安装 ---------------------------------------
function Ask-Yes([string]$Prompt) {
    if ($Yes) { Write-Host "    $Prompt -> 直接装（-Yes）" -ForegroundColor Cyan; return $true }
    if ($NoDeps) { return $false }
    if ([Console]::IsInputRedirected) {
        Write-Warn "非交互环境，不自动装：$Prompt（加 -Yes 可自动装）"
        return $false
    }
    Write-Host -NoNewline "    $Prompt [Y/n] " -ForegroundColor Yellow
    try { $ans = Read-Host } catch { return $false }
    if ([string]::IsNullOrWhiteSpace($ans)) { return $true }
    return ($ans.Trim() -match '^(y|yes|是)$')
}

function Find-Node {
    if (Get-Command node -ErrorAction SilentlyContinue) { return $true }
    $dirs = New-Object System.Collections.ArrayList
    foreach ($p in @(
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs' }),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'nodejs' }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs' }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Volta\bin' }),
        $toolchainDir
    )) {
        if ($p) { [void]$dirs.Add($p) }
    }
    foreach ($glob in @(
        $(if ($env:APPDATA) { Join-Path $env:APPDATA 'nvm\v*' }),
        $(Join-Path $toolchainDir 'node-v*')
    )) {
        if (-not $glob) { continue }
        Get-Item -Path $glob -ErrorAction SilentlyContinue | ForEach-Object { [void]$dirs.Add($_.FullName) }
    }
    foreach ($d in $dirs) {
        if (Test-Path -LiteralPath (Join-Path $d 'node.exe')) {
            $env:PATH = "$d;$env:PATH"
            return $true
        }
    }
    return $false
}

function Find-Pnpm {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) { return $true }
    $dirs = New-Object System.Collections.ArrayList
    foreach ($p in @(
        $(if ($env:APPDATA) { Join-Path $env:APPDATA 'npm' }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'pnpm' }),
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs' }),
        $toolchainDir
    )) {
        if ($p) { [void]$dirs.Add($p) }
    }
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        $prefix = (& npm prefix -g 2>$null | Out-String).Trim()
        if ($prefix) { [void]$dirs.Add($prefix) }
    }
    Get-Item -Path (Join-Path $toolchainDir 'node-v*') -ErrorAction SilentlyContinue |
        ForEach-Object { [void]$dirs.Add($_.FullName) }
    foreach ($d in $dirs) {
        foreach ($name in @('pnpm.cmd', 'pnpm.exe', 'pnpm.ps1')) {
            if (Test-Path -LiteralPath (Join-Path $d $name)) {
                $env:PATH = "$d;$env:PATH"
                return $true
            }
        }
    }
    return $false
}

function Install-NodeAuto {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Step "用 winget 安装 Node.js LTS"
        & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --disable-interactivity
        if ($env:ProgramFiles) {
            $std = Join-Path $env:ProgramFiles 'nodejs'
            if (Test-Path -LiteralPath (Join-Path $std 'node.exe')) { $env:PATH = "$std;$env:PATH" }
        }
        if (Find-Node) {
            Write-Ok "Node $(& node -v) 已就绪（winget）"
            return $true
        }
        Write-Warn "winget 没装成，改用官方 zip"
    }

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
    Write-Step "下载 Node.js 官方 zip（$arch）"
    $sums = $null; $file = $null; $url = $null
    foreach ($base in @('latest-v22.x', 'latest-v24.x', 'latest')) {
        try {
            $sums = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 "https://nodejs.org/dist/$base/SHASUMS256.txt").Content
        } catch { continue }
        $m = [regex]::Match($sums, "node-v[0-9][0-9.]*-$arch\.zip")
        if ($m.Success) { $file = $m.Value; $url = "https://nodejs.org/dist/$base/$file"; break }
    }
    if (-not $url) {
        Write-Err "取不到 Node.js 下载地址（网络不通？）。手动装：https://nodejs.org/"
        return $false
    }

    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("pojia-node-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $zip = Join-Path $tmp $file
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -Uri $url -OutFile $zip
        $want = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($file) } | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1)
        $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
        if ($want -and $want.ToLower() -ne $got) {
            Write-Err "sha256 校验失败，已中止（可能有中间人/下载损坏）"
            return $false
        }
        New-Item -ItemType Directory -Path $toolchainDir -Force | Out-Null
        Expand-Archive -LiteralPath $zip -DestinationPath $toolchainDir -Force
        $nodeDir = Join-Path $toolchainDir ([System.IO.Path]::GetFileNameWithoutExtension($file))
        if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
            Write-Err "解压完成但找不到 node.exe：$nodeDir"
            return $false
        }
        $env:PATH = "$nodeDir;$env:PATH"
        $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
        if ($userPath -notlike "*$nodeDir*") {
            [Environment]::SetEnvironmentVariable('PATH', "$nodeDir;$userPath", 'User')
            Write-Warn "已把 $nodeDir 写进用户 PATH（新开的终端生效）"
        }
        Write-Ok "Node $(& node -v) 已装到 $nodeDir"
        return $true
    } catch {
        Write-Err "下载/解压失败：$($_.Exception.Message)"
        return $false
    } finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-Node {
    if (Find-Node) {
        $major = 0
        try { $major = [int]((& node -p "process.versions.node.split('.')[0]" 2>$null | Out-String).Trim()) } catch { $major = 0 }
        if ($major -ge 18) { Write-Ok "Node $(& node -v)"; return $true }
        Write-Warn "Node 版本偏低（$(& node -v)），DSH 需要 >= 18"
        if (-not (Ask-Yes "要我自动装一份 Node.js LTS 到 $toolchainDir 吗？")) { return $false }
        return (Install-NodeAuto)
    }
    Write-Warn "没检测到 Node.js（DSH 本身需要 >= 18）"
    if (-not (Ask-Yes "要我自动帮你装 Node.js 吗？")) { return $false }
    return (Install-NodeAuto)
}

function Install-PnpmAuto {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Write-Step "用 npm 全局安装 pnpm"
        & npm install -g pnpm --no-fund --no-audit
        if ($LASTEXITCODE -eq 0 -and (Find-Pnpm)) {
            Write-Ok "pnpm $(& pnpm -v) 已就绪（npm）"
            return $true
        }
        Write-Warn "npm -g 没装成（常见原因：全局目录没有写权限）"
    }

    if (Get-Command corepack -ErrorAction SilentlyContinue) {
        Write-Step "用 corepack 启用 pnpm"
        & corepack enable pnpm 2>$null
        if ($LASTEXITCODE -ne 0) { & corepack prepare pnpm@latest --activate 2>$null }
        if (Find-Pnpm) {
            Write-Ok "pnpm $(& pnpm -v) 已就绪（corepack）"
            return $true
        }
        Write-Warn "corepack 没能启用 pnpm"
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Step "本机没有 npm，先装一份私有 Node.js（自带 npm）"
        if ((Install-NodeAuto) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
            & npm install -g pnpm --no-fund --no-audit
            if ($LASTEXITCODE -eq 0 -and (Find-Pnpm)) {
                Write-Ok "pnpm $(& pnpm -v) 已就绪"
                return $true
            }
        }
    }

    Write-Err "pnpm 自动安装没成功。手动装：npm i -g pnpm（或见 https://pnpm.io/installation）"
    return $false
}

function Ensure-Pnpm {
    if (Find-Pnpm) {
        Write-Ok "pnpm $(& pnpm -v)"
        return $true
    }
    Write-Warn "没检测到 pnpm（安装 profile 依赖要用它）"
    if (-not (Ask-Yes "要我自动帮你装 pnpm 吗？")) { return $false }
    return (Install-PnpmAuto)
}


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
    # 清掉 fallback 建的 node_modules 链接 / 副本（只删这一项，不碰别的依赖）
    $linkPath = Join-Path $profileDir "node_modules\$pluginName"
    if (Test-Path -LiteralPath $linkPath) {
        $item = Get-Item -LiteralPath $linkPath -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            # junction：用 rmdir 只删链接，绝不动目标目录内容
            & cmd /c rmdir "$linkPath" 2>$null | Out-Null
            if (-not (Test-Path -LiteralPath $linkPath)) { Write-Ok "已删除 node_modules\$pluginName 链接" }
        } else {
            Remove-Item -LiteralPath $linkPath -Recurse -Force -ErrorAction SilentlyContinue
            Write-Ok "已删除 node_modules\$pluginName 副本"
        }
    }
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

# --- 依赖检查：Node.js / pnpm（缺了会问你要不要自动装）---
$nodeReady = Ensure-Node
if (-not $nodeReady) {
    Write-Warn "缺 Node.js：注册已经写好，但 DSH 跑插件需要 Node.js >= 18，装好后重启 DSH。"
}

# --- 装 profile 依赖（装失败要如实报告，并保证插件至少能被 DSH 加载）---
function Ensure-PluginLink {
    $nm = Join-Path $profileDir 'node_modules'
    $link = Join-Path $nm $pluginName
    New-Item -ItemType Directory -Path $nm -Force | Out-Null
    if (Test-Path -LiteralPath $link) {
        Remove-Item -LiteralPath $link -Recurse -Force -ErrorAction SilentlyContinue
    }
    try {
        New-Item -ItemType Junction -Path $link -Target $targetDir -ErrorAction Stop | Out-Null
        Write-Ok "已手动链接 node_modules\$pluginName → $targetDir"
        return $true
    } catch {
        try {
            Copy-Item -LiteralPath $targetDir -Destination $link -Recurse -Force -ErrorAction Stop
            Write-Ok "已复制插件到 node_modules\$pluginName（junction 不可用时退回复制）"
            return $true
        } catch {
            Write-Warn "手动链接插件也失败了：$($_.Exception.Message)"
            return $false
        }
    }
}

function Show-PnpmHint([string]$Text) {
    if ($Text -match 'ERR_PNPM_INVALID_VERSION_UNION') {
        Write-Warn "profile 里有一条 URL / tarball 形式的依赖，当前 pnpm 不接受这种写法（与本插件无关）。"
        Write-Warn "处理办法：把 package.json 里的 https://…/tar.gz/<sha> 改成 github:owner/repo#<sha>，或临时用 pnpm 9（npm i -g pnpm@9）再装。"
    } elseif ($Text -match 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED') {
        Write-Warn "profile 里从 GitHub 拉下来的包要跑构建脚本，pnpm 要求显式放行（与本插件无关）。"
        Write-Warn "处理办法：在 $profileDir\pnpm-workspace.yaml 加 onlyBuiltDependencies（例如 - ""dsh-providers-hub""），或跑 pnpm approve-builds。"
    } elseif ($Text -match 'ERR_PNPM_') {
        Write-Warn "pnpm 报错了，完整输出在上面；profile 里原有的依赖问题需要单独修。"
    }
}

function Add-BuiltDependency([string]$Pkg) {
    $ws = Join-Path $profileDir 'pnpm-workspace.yaml'
    if (-not (Test-Path -LiteralPath $ws)) {
        Set-Utf8 $ws ("onlyBuiltDependencies:`n  - `"$Pkg`"`n")
        return $true
    }
    $text = Get-Utf8 $ws
    if ($text -match [regex]::Escape($Pkg)) { return $true }
    if ($text -match '(?m)^onlyBuiltDependencies:') {
        $text = [regex]::Replace($text, '(?m)^onlyBuiltDependencies:', "onlyBuiltDependencies:`n  - `"$Pkg`"")
    } else {
        if (-not $text.EndsWith("`n")) { $text += "`n" }
        $text += "`nonlyBuiltDependencies:`n  - `"$Pkg`"`n"
    }
    Set-Utf8 $ws $text
    return $true
}

$depsOk = $true
if (-not $SkipPnpmInstall) {
    if (Ensure-Pnpm) {
        Write-Step "安装 profile 依赖（pnpm install）"
        $outText = ''
        $code = 0
        Push-Location $profileDir
        try {
            $outText = (& pnpm install --config.confirmModulesPurge=false 2>&1 | Out-String)
            $code = $LASTEXITCODE
        }
        finally { Pop-Location }
        Write-Host $outText
        $errHit = ($outText -match 'ERR_PNPM_|ERR_[A-Z][A-Z_]+_|ELIFECYCLE')
        if (($code -eq 0) -and (-not $errHit)) {
            Write-Ok "pnpm install 完成"
        } else {
            $depsOk = $false
            Write-Warn "pnpm install 失败（退出码 $code），这一步的报错不是安装脚本能替你修的。"
            Show-PnpmHint $outText

            # pnpm 自己给了修法的那种（GitHub 包要跑构建脚本）：问一句，替用户改配置再重试
            if ($outText -match 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED') {
                $m = [regex]::Match($outText, 'The git-hosted package "([^"]+)"')
                $blocked = ''
                if ($m.Success) { $blocked = $m.Groups[1].Value -replace '@[^@]*$', '' }
                if ($blocked -and (Ask-Yes "要不要把 ""$blocked"" 加进 pnpm-workspace.yaml 的 onlyBuiltDependencies 再重试一次？")) {
                    if (Add-BuiltDependency $blocked) {
                        Write-Ok "已写入 onlyBuiltDependencies: $blocked"
                        Push-Location $profileDir
                        try {
                            $outText = (& pnpm install --config.confirmModulesPurge=false 2>&1 | Out-String)
                            $code = $LASTEXITCODE
                        }
                        finally { Pop-Location }
                        Write-Host $outText
                        if (($code -eq 0) -and (-not ($outText -match 'ERR_PNPM_|ERR_[A-Z][A-Z_]+_|ELIFECYCLE'))) {
                            $depsOk = $true
                            Write-Ok "重试后 pnpm install 完成"
                        }
                    }
                }
            }

            if (-not $depsOk) {
                if (Ensure-PluginLink) {
                    Write-Warn "插件已手动链接进 node_modules，DSH 能加载它；profile 里其它依赖修好后，在 $profileDir 重跑一次 pnpm install。"
                }
            }
        }
    } else {
        Write-Warn "跳过 pnpm install（没有 pnpm：按你的选择或当前环境）。"
        [void](Ensure-PluginLink)
    }
}

Write-Host ""
if ($depsOk -and $nodeReady) {
    Write-Host "安装完成。请完全退出并重新打开 DSH，然后在 dsh-pojia 面板点「应用」。" -ForegroundColor Green
} else {
    Write-Host "安装动作做完了，但有依赖没弄好（看上面的 [!]）。" -ForegroundColor Yellow
    Write-Host "  插件本身已就位；把依赖问题修掉后，在 $profileDir 里重跑 pnpm install，再重启 DSH 点「应用」。" -ForegroundColor Yellow
    Write-Host "  只想先装插件的话，下次可以直接用 -SkipPnpmInstall（脚本会手动链接插件）。" -ForegroundColor Yellow
    exit 2
}

