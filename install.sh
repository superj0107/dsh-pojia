#!/usr/bin/env bash
# =============================================================================
# dsh-pojia 一键安装 / 卸载 — macOS / Linux / WSL（面向 DSH 0.2.2-rc.5）
#
# 用法（在解压后的目录里）：
#   bash install.sh                            # 装到自动探测到的 DSH home 的 desktop profile
#   bash install.sh --profile web               # 装到 web profile
#   bash install.sh --dsh-home "$HOME/my-dsh"   # 指定隔离 home
#   bash install.sh --skip-pnpm-install         # 只写注册，不跑 pnpm install
#   bash install.sh --uninstall                 # 卸载（删插件目录 + profile 注册 + bundle 行）
#   bash install.sh --help
#
# macOS 上被 Gatekeeper 拦过一次的话先解掉隔离属性：
#   xattr -d com.apple.quarantine install.sh
#
# 说明：本脚本只改你指定的 DSH home 下那一个 profile，不动其它数据目录。
# 安装后完全退出并重新打开 DSH，然后在会话标题旁的 dsh-pojia 面板点「应用」。
# 需要 Node.js >= 18（DSH 本身就要），pnpm 缺失时只跳过依赖安装并给提示。
# =============================================================================
set -euo pipefail

plugin_name="dsh-pojia"
src_dir="$(cd "$(dirname "$0")" && pwd -P)"

profile_name="desktop"
profile_set=0
dsh_home_arg=""
do_uninstall=0
skip_pnpm=0

c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_cyan=$'\033[36m'; c_off=$'\033[0m'
if [ ! -t 1 ]; then c_ok=""; c_warn=""; c_err=""; c_cyan=""; c_off=""; fi

step() { printf '\n%s==> %s%s\n' "$c_cyan" "$*" "$c_off"; }
ok()   { printf '    %s[OK]%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '    %s[!]%s %s\n' "$c_warn" "$c_off" "$*"; }
err()  { printf '    %s[X]%s %s\n' "$c_err" "$c_off" "$*" >&2; }

usage() {
  sed -n '2,20p' "$src_dir/install.sh" 2>/dev/null | sed 's/^# \{0,1\}//' || true
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)     profile_name="${2:-}"; profile_set=1; shift 2 ;;
    --profile=*)   profile_name="${1#*=}"; profile_set=1; shift ;;
    --dsh-home)    dsh_home_arg="${2:-}"; shift 2 ;;
    --dsh-home=*)  dsh_home_arg="${1#*=}"; shift ;;
    --uninstall)   do_uninstall=1; shift ;;
    --skip-pnpm-install) skip_pnpm=1; shift ;;
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

# --- Node 检查（改 profile JSON / YAML 都要用）---
if ! command -v node >/dev/null 2>&1; then
  err "未找到 node。请先装 Node.js >= 18（macOS: brew install node），再重跑本脚本。"
  exit 1
fi
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${node_major:-0}" -lt 18 ] 2>/dev/null; then
  warn "Node 版本偏低（$(node -v)），DSH 需要 >= 18"
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

# --- pnpm install ---
if [ "$skip_pnpm" = 0 ]; then
  step "安装依赖（pnpm）"
  if command -v pnpm >/dev/null 2>&1; then
    if ( cd "$profile_dir" && pnpm install --config.confirmModulesPurge=false ); then
      ok "pnpm install 完成"
    else
      warn "pnpm install 失败，DSH 启动前请在该 profile 目录手动重跑：pnpm install"
    fi
  else
    warn "未找到 pnpm，跳过依赖安装。"
    warn "先装 Node.js 20+ 与 pnpm（corepack enable / npm i -g pnpm），再在 $profile_dir 跑 pnpm install"
  fi
fi

printf '\n%s安装完成。%s\n' "$c_ok" "$c_off"
printf '  1) 完全退出并重新打开 DSH\n'
printf '  2) 在会话标题旁 dsh-pojia 面板点「应用」（Clean → Apply），宿主会自动重启一次\n'
printf '  3) 之后在会话里用 /pojia status 查看状态\n'
printf '\n  卸载：bash install.sh --uninstall\n'
