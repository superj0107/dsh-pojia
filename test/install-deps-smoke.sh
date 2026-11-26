#!/usr/bin/env bash
# 依赖处理冒烟测试（macOS / Linux / WSL）
#   用法：bash test/install-deps-smoke.sh
#
# 默认只跑不需要网络的部分（适合 CI）：
#   --no-deps 不问不装 / 缺 Node 时问一句并明确报错退出 / 非交互时不擅自装
# 想连真实下载一起测（会从 nodejs.org 和 npm 拉包，几十 MB）：
#   POJIA_TEST_NETWORK=1 bash test/install-deps-smoke.sh
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/pojia-deps.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

fails=0
chk() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  ok   %s\n' "$desc"
  else printf '  FAIL %s\n' "$desc" >&2; fails=$((fails + 1)); fi
}
has_in() { grep -qF -- "$2" "$1"; }
lacks_in() { ! grep -qF -- "$2" "$1"; }

mkhome() {
  mkdir -p "$1/profiles/desktop"
  printf '{"name":"p","dependencies":{},"dsh":{"profile":{"bundles":[]}}}\n' >"$1/profiles/desktop/package.json"
  printf -- "- insert:\n    - id: keep-me\n      name: 'keep-me'\n" >"$1/profiles/desktop/cordis.patch.yml"
}
# 只放基础工具、故意不放 node / npm / pnpm
mkbin() {
  mkdir -p "$1"
  for t in bash sh curl tar gzip sed grep head awk uname mkdir rm cp ln chmod mktemp cat basename dirname ls sha256sum shasum env date id; do
    p="$(command -v "$t" 2>/dev/null || true)"
    [ -n "$p" ] && ln -sf "$p" "$1/$t"
  done
}
registered() { grep -q 'file:../../plugins/dsh-pojia' "$1"; }

echo "== --no-deps：不问、不装 =="
h="$tmp/h1"; mkhome "$h"
DSH_HOME="$h" bash "$root/install.sh" --dsh-home "$h" --no-deps >"$tmp/a.log" 2>&1
chk "退出码 0" test $? -eq 0
chk "没有出现 [Y/n] 提问" lacks_in "$tmp/a.log" '[Y/n]'
chk "明确说跳过" has_in "$tmp/a.log" '跳过 pnpm install'
chk "注册照写" registered "$h/profiles/desktop/package.json"

echo "== 缺 Node.js + 回答 n：明确报错退出，不乱改 profile =="
mkbin "$tmp/bin"
h2="$tmp/h2"; mkhome "$h2"
printf 'n\n' | env PATH="$tmp/bin" DSH_HOME="$h2" bash "$root/install.sh" --dsh-home "$h2" >"$tmp/b.log" 2>&1
chk "退出码 1" test $? -eq 1
chk "提示没检测到 Node.js" has_in "$tmp/b.log" '没检测到 Node.js'
chk "问了一句" has_in "$tmp/b.log" '要我自动帮你装 Node.js 吗'
chk "没写注册" eval '! registered "$h2/profiles/desktop/package.json"'

echo "== 缺 Node.js + 非交互（无 tty、无 --yes）：不擅自装 =="
h3="$tmp/h3"; mkhome "$h3"
env POJIA_ASK_TIMEOUT=3 PATH="$tmp/bin" DSH_HOME="$h3" bash "$root/install.sh" --dsh-home "$h3" </dev/null >"$tmp/c.log" 2>&1
chk "退出码 1" test $? -eq 1
chk "没开始下载" lacks_in "$tmp/c.log" '下载 Node.js 官方二进制'

if [ "${POJIA_TEST_NETWORK:-0}" = 1 ]; then
  echo "== 网络：缺 Node.js + --yes → 官方二进制 + sha256 校验（真实下载）=="
  h4="$tmp/h4"; mkhome "$h4"
  env PATH="$tmp/bin" DSH_HOME="$h4" bash "$root/install.sh" --dsh-home "$h4" --yes --skip-pnpm-install >"$tmp/d.log" 2>&1
  chk "退出码 0" test $? -eq 0
  chk "走了官方二进制" has_in "$tmp/d.log" '下载 Node.js 官方二进制'
  chk "Node 落在 toolchain" bash -c 'ls "$0"/toolchain/node-v*/bin/node' "$h4"
  chk "私有 Node 带 npm" bash -c 'ls "$0"/toolchain/node-v*/bin/npm' "$h4"
  chk "注册照写" registered "$h4/profiles/desktop/package.json"

  echo "== 网络：缺 pnpm + --yes → 自动装 pnpm 并跑 pnpm install =="
  h5="$tmp/h5"; mkhome "$h5"
  env DSH_HOME="$h5" bash "$root/install.sh" --dsh-home "$h5" --yes >"$tmp/e.log" 2>&1
  chk "退出码 0" test $? -eq 0
  chk "自动装了 pnpm" bash -c 'grep -qE "用 npm 全局安装 pnpm|用 pnpm 官方独立安装脚本|本机没有 npm" "$0"' "$tmp/e.log"
  chk "pnpm 就绪" has_in "$tmp/e.log" '已就绪'
else
  echo "== 网络相关用例已跳过（POJIA_TEST_NETWORK=1 可开启）=="
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "FAILED: $fails 项未通过" >&2
  exit 1
fi
echo "依赖处理冒烟测试全部通过"
