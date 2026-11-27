#!/usr/bin/env bash
# =============================================================================
# dsh-pojia 一键安装 / 卸载 — macOS / Linux / WSL（面向 DSH 0.2.2-rc.5）
#
# 用法（在解压后的目录里）：
#   bash install.sh                            # 装到自动探测到的 DSH home 的 desktop profile
#   bash install.sh --profile web               # 装到 web profile
#   bash install.sh --dsh-home "$HOME/my-dsh"   # 指定隔离 home
#   bash install.sh --skip-pnpm-install         # 只写注册，不跑 pnpm install
#   bash install.sh --yes                       # 缺依赖（Node.js / pnpm）时不问，直接装
#   bash install.sh --no-deps                   # 缺依赖时只警告，不装、不提问
#   bash install.sh --uninstall                 # 卸载（删插件目录 + profile 注册 + bundle 行）
#   bash install.sh --help
#
# macOS 上被 Gatekeeper 拦过一次的话先解掉隔离属性：
#   xattr -d com.apple.quarantine install.sh
#
# 说明：本脚本只改你指定的 DSH home 下那一个 profile，不动其它数据目录。
# 安装后完全退出并重新打开 DSH，然后在会话标题旁的 dsh-pojia 面板点「应用」。
# 缺 Node.js / pnpm 时脚本会问你要不要自动装：同意就装（Homebrew 或官方二进制 /
# npm 或 corepack），不写系统目录、不动你的 shell 配置；用 --yes 可免交互。
# 环境变量：POJIA_ASK_TIMEOUT（提问等待秒数，默认 120）、POJIA_NO_SEARCH=1（只认 PATH，
# 不去翻常见安装目录，测试/严格环境用）。
# =============================================================================
set -euo pipefail

plugin_name="dsh-pojia"
src_dir="$(cd "$(dirname "$0")" && pwd -P)"

profile_name="desktop"
profile_set=0
dsh_home_arg=""
do_uninstall=0
skip_pnpm=0
assume_yes=0
no_deps=0

c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_cyan=$'\033[36m'; c_off=$'\033[0m'
if [ ! -t 1 ]; then c_ok=""; c_warn=""; c_err=""; c_cyan=""; c_off=""; fi

step() { printf '\n%s==> %s%s\n' "$c_cyan" "$*" "$c_off"; }
ok()   { printf '    %s[OK]%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '    %s[!]%s %s\n' "$c_warn" "$c_off" "$*"; }
err()  { printf '    %s[X]%s %s\n' "$c_err" "$c_off" "$*" >&2; }

usage() {
  awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$src_dir/install.sh" 2>/dev/null || true
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)     profile_name="${2:-}"; profile_set=1; shift 2 ;;
    --profile=*)   profile_name="${1#*=}"; profile_set=1; shift ;;
    --dsh-home)    dsh_home_arg="${2:-}"; shift 2 ;;
    --dsh-home=*)  dsh_home_arg="${1#*=}"; shift ;;
    --uninstall)   do_uninstall=1; shift ;;
    --skip-pnpm-install) skip_pnpm=1; shift ;;
    --yes|-y)      assume_yes=1; shift ;;
    --no-deps)     no_deps=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             err "未知参数：$1"; usage; exit 2 ;;
  esac
done

# --- 解析 home：--dsh-home > $DSH_HOME > 自动探测（macOS 桌面 home > ~/.dsh）---
resolve_home() {
  if [ -n "$dsh_home_arg" ]; then printf '%s' "$dsh_home_arg"; return 0; fi
  if [ -n "${DSH_HOME:-}" ]; then printf '%s' "$DSH_HOME"; return 0; fi
  mac_home="$HOME/Library/Application Support/DeepSeek Harness/dsh-home"
  if [ -d "$mac_home/profiles" ]; then printf '%s' "$mac_home"; return 0; fi
  if [ -d "$HOME/.dsh/profiles" ]; then printf '%s' "$HOME/.dsh"; return 0; fi
  printf '%s' "$HOME/.dsh"
}

dsh_home="$(resolve_home)"
profiles_root="$dsh_home/profiles"
plugins_dir="$dsh_home/plugins"
target_dir="$plugins_dir/$plugin_name"

step "目标 home: $dsh_home"
if [ ! -d "$profiles_root" ]; then
  err "目录里没有 profiles 子目录：$dsh_home"
  err "请先启动一次 DSH 生成 profile，或用 --dsh-home 指定正确的 home。"
  err "macOS 桌面版常见位置：$HOME/Library/Application Support/DeepSeek Harness/dsh-home"
  exit 1
fi

# --- 选 profile ---
available_profiles=""
for d in "$profiles_root"/*; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  if [ -z "$available_profiles" ]; then available_profiles="$name"; else available_profiles="$available_profiles $name"; fi
done

if [ ! -d "$profiles_root/$profile_name" ]; then
  if [ "$profile_set" = 0 ]; then
    # 没显式指定：desktop 不存在时退到唯一的那个 profile
    count=0
    for name in $available_profiles; do count=$((count + 1)); last="$name"; done
    if [ "$count" = 1 ]; then
      warn "profile '$profile_name' 不存在，改用唯一的 profile：$last"
      profile_name="$last"
    fi
  fi
fi

profile_dir="$profiles_root/$profile_name"
if [ ! -d "$profile_dir" ]; then
  err "profile 不存在：$profile_dir"
  err "现有 profile：${available_profiles:-（无）}"
  err "用 --profile <名字> 指定，例如 --profile web"
  exit 1
fi
ok "profile: $profile_dir"

# =============================================================================
# 依赖检查 + 自动安装（Node.js >= 18 / pnpm）
#   交互终端：缺哪个就问「要不要帮你装」
#   --yes   ：直接装，不问
#   --no-deps：只警告，不装也不问
# 安装位置：Node.js 走 Homebrew，没有 Homebrew 就装官方二进制到 $dsh_home/toolchain；
#           pnpm 走 npm -g → corepack → 官方独立脚本，都不需要 sudo。
# =============================================================================
pojia_toolchain="$dsh_home/toolchain"

has_tty() { { [ -t 0 ] < /dev/tty; } 2>/dev/null; }

ask_yes() { # ask_yes <提示> → 0 = 用户同意（回车/空行＝同意，超时或读不到＝不同意）
  if [ "$assume_yes" = 1 ]; then
    printf '    %s → 直接装（--yes）\n' "$1"
    return 0
  fi
  if [ "$no_deps" = 1 ]; then return 1; fi
  ans=""
  secs="${POJIA_ASK_TIMEOUT:-120}"
  if [ -t 0 ]; then
    printf '    %s [Y/n] ' "$1"
    if ! IFS= read -r -t "$secs" ans; then
      printf '\n'
      warn "没收到回答，按「不装」处理"
      return 1
    fi
  elif [ -p /dev/stdin ]; then
    if ! IFS= read -r -t "$secs" ans; then
      warn "$1 → 没收到输入，按「不装」处理"
      return 1
    fi
    printf '    %s [Y/n] → %s\n' "$1" "${ans:-（回车）}"
  elif has_tty; then
    printf '    %s [Y/n] ' "$1" >/dev/tty
    if ! IFS= read -r -t "$secs" ans < /dev/tty 2>/dev/null; then
      printf '\n' >/dev/tty
      warn "没收到回答，按「不装」处理"
      return 1
    fi
  else
    warn "非交互环境，不自动装：$1（下次加 --yes 可自动装）"
    return 1
  fi
  case "$ans" in
    ""|y|Y|yes|YES|Yes|是) return 0 ;;
    *) return 1 ;;
  esac
}

find_node() {
  if command -v node >/dev/null 2>&1; then return 0; fi
  # POJIA_NO_SEARCH=1：只认 PATH，不去翻常见安装目录（测试 / 严格环境用）
  [ "${POJIA_NO_SEARCH:-0}" = 1 ] && return 1
  for d in /usr/local/bin /opt/homebrew/bin /opt/local/bin \
           "$HOME/.local/bin" "$HOME/.volta/bin" "$HOME/.npm-global/bin" "$HOME/n/bin"; do
    if [ -x "$d/node" ]; then PATH="$d:$PATH"; export PATH; return 0; fi
  done
  for d in "$pojia_toolchain"/*/bin \
           "$HOME"/.nvm/versions/node/*/bin \
           "$HOME"/.local/share/fnm/node-versions/*/installation/bin \
           "$HOME"/.asdf/installs/nodejs/*/bin; do
    if [ -x "$d/node" ]; then PATH="$d:$PATH"; export PATH; return 0; fi
  done
  return 1
}

find_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then return 0; fi
  [ "${POJIA_NO_SEARCH:-0}" = 1 ] && return 1
  for d in "$HOME/Library/pnpm" "$HOME/.local/share/pnpm" \
           /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin" "$HOME/.npm-global/bin"; do
    if [ -x "$d/pnpm" ]; then PATH="$d:$PATH"; export PATH; return 0; fi
  done
  if command -v npm >/dev/null 2>&1; then
    d="$(npm prefix -g 2>/dev/null || true)/bin"
    if [ -x "$d/pnpm" ]; then PATH="$d:$PATH"; export PATH; return 0; fi
  fi
  for d in "$pojia_toolchain"/*/bin; do
    if [ -x "$d/pnpm" ]; then PATH="$d:$PATH"; export PATH; return 0; fi
  done
  return 1
}

fetch_text() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --max-time 30 "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO- --timeout=30 "$1"
  else return 1; fi
}

download_file() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --max-time 600 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" --timeout=600 "$1"
  else return 1; fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else return 0; fi
}

install_node_auto() {
  if command -v brew >/dev/null 2>&1; then
    step "用 Homebrew 安装 Node.js"
    if brew install node && find_node; then
      ok "Node $(node -v) 已就绪（Homebrew）"
      return 0
    fi
    warn "Homebrew 没装成功，改用官方二进制包"
  fi

  plat=""
  case "$(uname -s)" in Darwin) plat=darwin ;; Linux) plat=linux ;; esac
  arch=""
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; esac
  if [ -z "$plat" ] || [ -z "$arch" ]; then
    err "这个系统/架构（$(uname -s) $(uname -m)）没有官方 Node.js 二进制，请手动装：https://nodejs.org/"
    return 1
  fi

  step "下载 Node.js 官方二进制（$plat-$arch）"
  sums=""; url=""; file=""
  for base in latest-v22.x latest-v24.x latest; do
    sums="$(fetch_text "https://nodejs.org/dist/$base/SHASUMS256.txt")" || continue
    file="$(printf '%s\n' "$sums" | grep -o "node-v[0-9][0-9.]*-$plat-$arch\.tar\.gz" | head -n 1)"
    if [ -n "$file" ]; then url="https://nodejs.org/dist/$base/$file"; break; fi
  done
  if [ -z "$url" ]; then
    err "取不到 Node.js 下载地址（网络不通？）。手动装：https://nodejs.org/"
    return 1
  fi

  ntmp="$(mktemp -d "${TMPDIR:-/tmp}/pojia-node.XXXXXX")"
  if ! download_file "$url" "$ntmp/$file"; then
    err "下载失败：$url"
    rm -rf "$ntmp"
    return 1
  fi
  want="$(printf '%s\n' "$sums" | grep " $file\$" | awk '{print $1}' | head -n 1)"
  got="$(sha256_of "$ntmp/$file")"
  if [ -n "$want" ] && [ -n "$got" ] && [ "$want" != "$got" ]; then
    err "sha256 校验失败，已中止（可能有中间人/下载损坏）"
    rm -rf "$ntmp"
    return 1
  fi
  mkdir -p "$pojia_toolchain"
  if ! tar -xzf "$ntmp/$file" -C "$pojia_toolchain"; then
    err "解压失败：$ntmp/$file"
    rm -rf "$ntmp"
    return 1
  fi
  rm -rf "$ntmp"
  node_dir="$pojia_toolchain/${file%.tar.gz}"
  PATH="$node_dir/bin:$PATH"; export PATH
  if ! command -v node >/dev/null 2>&1; then
    err "解压完成但找不到 node，请手动检查：$node_dir/bin"
    return 1
  fi
  ok "Node $(node -v) 已装到 $node_dir"
  warn "这份 Node 给安装脚本和 pnpm 用；要 DSH 也用它，把 $node_dir/bin 加进 PATH"
  return 0
}

ensure_node() {
  if find_node; then
    node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "${node_major:-0}" -ge 18 ] 2>/dev/null; then
      ok "Node $(node -v)"
      return 0
    fi
    warn "Node 版本偏低（$(node -v)），DSH 需要 >= 18"
    if ! ask_yes "要我自动装一份 Node.js LTS 到 $pojia_toolchain 吗？"; then
      err "Node 版本不够，先升级到 >= 18 再重跑本脚本。"
      return 1
    fi
    install_node_auto
    return $?
  fi
  warn "没检测到 Node.js（DSH 本身需要 >= 18）"
  if ! ask_yes "要我自动帮你装 Node.js 吗？"; then
    err "缺 Node.js，先装好 Node.js >= 18 再重跑本脚本。"
    return 1
  fi
  install_node_auto
}

install_pnpm_auto() {
  if command -v npm >/dev/null 2>&1; then
    step "用 npm 全局安装 pnpm"
    if npm install -g pnpm --no-fund --no-audit; then
      if find_pnpm; then ok "pnpm $(pnpm -v 2>/dev/null || echo ?) 已就绪（npm）"; return 0; fi
      warn "npm 装完了但没找到 pnpm 可执行文件"
    else
      warn "npm -g 失败（常见原因：全局目录没有写权限）"
    fi
  fi

  if command -v corepack >/dev/null 2>&1; then
    step "用 corepack 启用 pnpm"
    if corepack enable pnpm >/dev/null 2>&1 || corepack prepare pnpm@latest --activate >/dev/null 2>&1; then
      if find_pnpm; then ok "pnpm $(pnpm -v 2>/dev/null || echo ?) 已就绪（corepack）"; return 0; fi
    fi
    warn "corepack 没能启用 pnpm"
  fi

  if ! command -v npm >/dev/null 2>&1; then
    step "本机没有 npm，先装一份私有 Node.js（自带 npm）"
    if install_node_auto && command -v npm >/dev/null 2>&1; then
      if npm install -g pnpm --no-fund --no-audit && find_pnpm; then
        ok "pnpm $(pnpm -v 2>/dev/null || echo ?) 已就绪（私有 Node 的 npm）"
        return 0
      fi
    fi
  fi

  step "用 pnpm 官方独立安装脚本（装到 ~/.local/share/pnpm）"
  pnpm_home="${PNPM_HOME:-$HOME/.local/share/pnpm}"
  mkdir -p "$pnpm_home"
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL --max-time 90 https://get.pnpm.io/install.sh \
        | env PNPM_HOME="$pnpm_home" SHELL=/bin/sh sh - >/dev/null 2>&1; then
      PATH="$pnpm_home:$PATH"; export PATH
      if find_pnpm; then ok "pnpm $(pnpm -v 2>/dev/null || echo ?) 已就绪（官方脚本）"; return 0; fi
    fi
  fi

  err "pnpm 自动安装没成功。手动装：npm i -g pnpm（或见 https://pnpm.io/installation）"
  return 1
}

ensure_pnpm() {
  if find_pnpm; then
    ok "pnpm $(pnpm -v 2>/dev/null || echo ?)"
    return 0
  fi
  warn "没检测到 pnpm（安装 profile 依赖要用它）"
  if ! ask_yes "要我自动帮你装 pnpm 吗？"; then
    return 1
  fi
  install_pnpm_auto
}

# --- Node.js 必需（写 profile JSON / YAML 都靠它）---
if ! ensure_node; then
  exit 1
fi


# --- 改 profile package.json 与 cordis.patch.yml（node 内联，保留键顺序与缩进）---
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-pojia.XXXXXX")"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT INT TERM

helper="$tmp_dir/edit-profile.cjs"
cat >"$helper" <<'POJIA_HELPER'
"use strict";
const fs = require("fs");

const [mode, pluginName, pkgPath, patchPath] = process.argv.slice(2);

const BEGIN_NEW = "# >>> dsh-pojia managed block - do not edit inside";
const BEGIN_OLD = "# >>> dsh-pojia managed block (install.ps1) - do not edit inside";
const END = "# <<< dsh-pojia managed block";

function fail(msg) {
  console.error("    [X] " + msg);
  process.exit(1);
}

function editPackage() {
  let raw;
  try {
    raw = fs.readFileSync(pkgPath, "utf8");
  } catch (e) {
    fail("读取失败 " + pkgPath + ": " + e.message);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    fail("package.json 不是合法 JSON: " + e.message);
  }
  if (!json.dsh || !json.dsh.profile) fail("profile 结构异常（缺 dsh.profile）: " + pkgPath);
  if (!json.dependencies || typeof json.dependencies !== "object") json.dependencies = {};
  const existing = Array.isArray(json.dsh.profile.bundles) ? json.dsh.profile.bundles : [];
  const bundles = existing.filter((b) => b !== pluginName);
  if (mode === "install") {
    json.dependencies[pluginName] = "file:../../plugins/" + pluginName;
    bundles.push(pluginName);
  } else {
    delete json.dependencies[pluginName];
  }
  json.dsh.profile.bundles = bundles;
  fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log("    [OK] package.json 已更新（" + pluginName + "）");
}

function stripManaged(text) {
  const out = [];
  let skip = false;
  for (const line of text.split("\n")) {
    const t = line.replace(/\r$/, "");
    if (t === BEGIN_NEW || t === BEGIN_OLD) {
      skip = true;
      continue;
    }
    if (skip) {
      if (t === END) skip = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function editPatch() {
  if (!patchPath || !fs.existsSync(patchPath)) {
    console.log("    [!] cordis.patch.yml 不存在，跳过 patch 注册");
    return;
  }
  let text = fs.readFileSync(patchPath, "utf8");
  text = stripManaged(text);
  if (mode === "install") {
    text = text.replace(/\s*$/, "\n");
    text +=
      BEGIN_NEW + "\n" +
      "- insert:\n" +
      "    - id: " + pluginName + "\n" +
      "      name: '" + pluginName + "'\n" +
      "\n" + END + "\n";
  }
  fs.writeFileSync(patchPath, text, "utf8");
  console.log("    [OK] cordis.patch.yml 已更新");
}

editPackage();
editPatch();
POJIA_HELPER

BEGIN_OLD_LINE="# >>> dsh-pojia managed block (install.ps1) - do not edit inside"
BEGIN_NEW_LINE="# >>> dsh-pojia managed block - do not edit inside"

# --- 卸载 ---
if [ "$do_uninstall" = 1 ]; then
  step "卸载 $plugin_name"
  node "$helper" uninstall "$plugin_name" "$profile_dir/package.json" "$profile_dir/cordis.patch.yml"
  # 清掉 fallback 建的 node_modules 链接 / 副本（只删这一项，不碰别的依赖）
  link_path="$profile_dir/node_modules/$plugin_name"
  if [ -L "$link_path" ]; then
    rm -f "$link_path" && ok "已删除 node_modules/$plugin_name 链接"
  elif [ -d "$link_path" ]; then
    rm -rf "$link_path" && ok "已删除 node_modules/$plugin_name 副本"
  fi
  if [ -d "$target_dir" ]; then
    rm -rf "$target_dir"
    ok "已删除 $target_dir"
  else
    warn "插件目录不存在：$target_dir"
  fi
  printf '\n%s卸载完成。请完全退出并重新打开 DSH。%s\n' "$c_ok" "$c_off"
  exit 0
fi

# --- 安装 ---
if [ ! -f "$src_dir/package.json" ]; then
  err "当前目录不像插件包（缺 package.json）：$src_dir"
  exit 1
fi

step "复制插件到 $target_dir"
mkdir -p "$plugins_dir"
if command -v rsync >/dev/null 2>&1; then
  mkdir -p "$target_dir"
  rsync -a --delete \
    --exclude 'install.sh' \
    --exclude 'install.ps1' \
    --exclude '*.zip' \
    --exclude '*.tgz' \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'dsh-pojia-*-installer' \
    "$src_dir"/ "$target_dir"/
else
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  ( cd "$src_dir" && tar -cf - \
      --exclude ./install.sh \
      --exclude ./install.ps1 \
      --exclude './*.zip' \
      --exclude './*.tgz' \
      --exclude ./node_modules \
      --exclude ./.git . ) | ( cd "$target_dir" && tar -xf - )
  rm -rf "$target_dir"/dsh-pojia-*-installer
fi
rm -f "$target_dir/install.sh" "$target_dir/install.ps1"
chmod +x "$target_dir/bin/dsh-pojia.js" 2>/dev/null || true
ok "插件已复制"

step "写入 profile 注册"
node "$helper" install "$plugin_name" "$profile_dir/package.json" "$profile_dir/cordis.patch.yml"

# --- 装 profile 依赖（失败要如实说，并保证插件至少能被加载）---
link_plugin() {
  nm="$profile_dir/node_modules"
  link="$nm/$plugin_name"
  mkdir -p "$nm"
  rm -rf "$link" 2>/dev/null || true
  if ln -sfn "$target_dir" "$link" 2>/dev/null; then
    ok "已手动链接 node_modules/$plugin_name → $target_dir"
    return 0
  fi
  if cp -R "$target_dir" "$link" 2>/dev/null; then
    ok "已复制插件到 node_modules/$plugin_name（软链不可用时退回复制）"
    return 0
  fi
  warn "手动链接插件也失败了，DSH 可能加载不到它"
  return 1
}

show_pnpm_hint() {
  if printf '%s' "$1" | grep -q 'ERR_PNPM_INVALID_VERSION_UNION'; then
    warn "profile 里有一条 URL / tarball 形式的依赖，当前 pnpm 不接受这种写法（与本插件无关）。"
    warn "处理办法：把 package.json 里的 https://…/tar.gz/<sha> 改成 github:owner/repo#<sha>，或临时用 pnpm 9（npm i -g pnpm@9）再装。"
  elif printf '%s' "$1" | grep -q 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED'; then
    warn "profile 里从 GitHub 拉下来的包要跑构建脚本，pnpm 要求显式放行（与本插件无关）。"
    warn "处理办法：在 $profile_dir/pnpm-workspace.yaml 加 onlyBuiltDependencies，或跑 pnpm approve-builds。"
  elif printf '%s' "$1" | grep -q 'ERR_PNPM_'; then
    warn "pnpm 报错了，完整输出在上面；profile 里原有的依赖问题需要单独修。"
  fi
}

add_built_dependency() { # add_built_dependency <包名>：写进 pnpm-workspace.yaml 的 onlyBuiltDependencies
  ws="$profile_dir/pnpm-workspace.yaml"
  mkdir -p "$profile_dir"
  if [ ! -f "$ws" ]; then
    printf 'onlyBuiltDependencies:\n  - "%s"\n' "$1" >"$ws"
    return 0
  fi
  if grep -q '^onlyBuiltDependencies:' "$ws"; then
    grep -q -- "$1" "$ws" && return 0
    awk -v pkg="$1" '{ print } /^onlyBuiltDependencies:/ { print "  - \"" pkg "\"" }' "$ws" >"$ws.tmp" && mv "$ws.tmp" "$ws"
  else
    printf '\nonlyBuiltDependencies:\n  - "%s"\n' "$1" >>"$ws"
  fi
  return 0
}

deps_ok=1
if [ "$skip_pnpm" = 0 ]; then
  if ensure_pnpm; then
    step "安装 profile 依赖（pnpm install）"
    plog="$tmp_dir/pnpm-install.log"
    if ( cd "$profile_dir" && pnpm install --config.confirmModulesPurge=false ) >"$plog" 2>&1; then
      pcode=0
    else
      pcode=$?
    fi
    cat "$plog"
    if [ "$pcode" -eq 0 ] && ! grep -qE 'ERR_PNPM_|ERR_[A-Z][A-Z_]+_|ELIFECYCLE' "$plog"; then
      ok "pnpm install 完成"
    else
      deps_ok=0
      warn "pnpm install 失败（退出码 $pcode），这一步的报错不是安装脚本能替你修的。"
      show_pnpm_hint "$(cat "$plog")"

      # pnpm 自己给了修法的那种（GitHub 包要跑构建脚本）：问一句，替用户改配置再重试
      if grep -q 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED' "$plog"; then
        blocked_pkg="$(sed -n 's/.*The git-hosted package "\([^"]*\)".*/\1/p' "$plog" | head -n 1 | sed 's/@[^@]*$//')"
        if [ -n "$blocked_pkg" ] && ask_yes "要不要把 \"$blocked_pkg\" 加进 pnpm-workspace.yaml 的 onlyBuiltDependencies 再重试一次？"; then
          if add_built_dependency "$blocked_pkg"; then
            ok "已写入 onlyBuiltDependencies: $blocked_pkg"
            if ( cd "$profile_dir" && pnpm install --config.confirmModulesPurge=false ) >"$plog" 2>&1; then
              pcode=0
            else
              pcode=$?
            fi
            cat "$plog"
            if [ "$pcode" -eq 0 ] && ! grep -qE 'ERR_PNPM_|ERR_[A-Z][A-Z_]+_|ELIFECYCLE' "$plog"; then
              deps_ok=1
              ok "重试后 pnpm install 完成"
            fi
          fi
        fi
      fi

      if [ "$deps_ok" = 0 ] && link_plugin; then
        warn "插件已手动链接进 node_modules，DSH 能加载它；profile 里其它依赖修好后，在 $profile_dir 重跑一次 pnpm install。"
      fi
    fi
  else
    warn "跳过 pnpm install（没装 pnpm：按你的选择或当前环境）。"
    link_plugin || true
  fi
fi

printf '\n'
if [ "$deps_ok" = 1 ]; then
  printf '%s安装完成。%s\n' "$c_ok" "$c_off"
  printf '  1) 完全退出并重新打开 DSH\n'
  printf '  2) 在会话标题旁 dsh-pojia 面板点「应用」（Clean → Apply），宿主会自动重启一次\n'
  printf '  3) 之后在会话里 /pojia doctor 看结论（全绿 exit 0 / 有待办 1 / 有阻断 2），或双击「点我检查是否生效」\n'
  printf '\n  卸载：bash install.sh --uninstall\n'
else
  printf '%s安装动作做完了，但有依赖没弄好（看上面的 [!]）。%s\n' "$c_warn" "$c_off"
  printf '  插件本身已就位；把依赖问题修掉后，在 %s 里重跑 pnpm install，再重启 DSH 点「应用」。\n' "$profile_dir"
  printf '  只想先装插件：bash install.sh --skip-pnpm-install（脚本会手动链接插件）。\n'
  exit 2
fi
