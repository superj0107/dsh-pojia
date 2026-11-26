#!/usr/bin/env bash
# pnpm install 失败时的上报与兜底（macOS / Linux；不需要网络，用假 pnpm）
#   用法：bash test/install-fail-smoke.sh
# 覆盖：失败必须如实报（不能报 OK）+ 给针对性建议 + 手动链接插件兜底 + 卸载时清掉链接。
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/pojia-fail.XXXXXX")"
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

stub="$tmp/bin"; mkdir -p "$stub"
write_pnpm_stub() { # write_pnpm_stub <错误输出行>
  {
    printf '#!/usr/bin/env bash\n'
    printf 'if [ "${1:-}" = "-v" ]; then echo 10.33.0; exit 0; fi\n'
    printf 'echo "%s" >&2\nexit 1\n' "$1"
  } >"$stub/pnpm"
  chmod +x "$stub/pnpm"
}

echo "== pnpm install 失败：如实报错 + 建议 + 兜底链接 =="
write_pnpm_stub ' ERR_PNPM_INVALID_VERSION_UNION  Invalid versions union. Found: "dsh-providers-hub@https://codeload.github.com/x/y/tar.gz/abc"'
h="$tmp/h1"; mkhome "$h"
env PATH="$stub:$PATH" DSH_HOME="$h" bash "$root/install.sh" --dsh-home "$h" >"$tmp/a.log" 2>&1
code=$?
chk "退出码 2（装完但依赖没好）" test "$code" -eq 2
chk "明确说失败" has_in "$tmp/a.log" 'pnpm install 失败'
chk "没有假 OK" lacks_in "$tmp/a.log" 'pnpm install 完成'
chk "给出 URL 依赖的处理建议" has_in "$tmp/a.log" 'github:owner/repo#'
chk "兜底链接了插件" test -L "$h/profiles/desktop/node_modules/dsh-pojia"
chk "链接指向插件目录" test "$(readlink "$h/profiles/desktop/node_modules/dsh-pojia")" = "$h/plugins/dsh-pojia"
chk "结尾是警告" has_in "$tmp/a.log" '有依赖没弄好'
chk "注册照写" has_in "$h/profiles/desktop/package.json" 'file:../../plugins/dsh-pojia'

echo "== GIT_DEP_PREPARE_NOT_ALLOWED：给 onlyBuiltDependencies 建议 =="
write_pnpm_stub ' ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  needs to execute build scripts but is not in the onlyBuiltDependencies allowlist'
h2="$tmp/h2"; mkhome "$h2"
env PATH="$stub:$PATH" DSH_HOME="$h2" bash "$root/install.sh" --dsh-home "$h2" >"$tmp/b.log" 2>&1
code=$?
chk "退出码 2" test "$code" -eq 2
chk "建议 onlyBuiltDependencies" has_in "$tmp/b.log" 'onlyBuiltDependencies'

echo "== --no-deps / 跳过 pnpm：不算失败，但仍兜底链接 =="
h3="$tmp/h3"; mkhome "$h3"
DSH_HOME="$h3" bash "$root/install.sh" --dsh-home "$h3" --no-deps >"$tmp/c.log" 2>&1
chk "退出码 0" test $? -eq 0
chk "有跳过提示" has_in "$tmp/c.log" '跳过 pnpm install'
chk "也链接了插件" test -L "$h3/profiles/desktop/node_modules/dsh-pojia"

echo "== GIT_DEP 类错误：问一句就把包加进 onlyBuiltDependencies 再重试 =="
h4="$tmp/h4"; mkhome "$h4"
# 假 pnpm：workspace.yaml 里放了 onlyBuiltDependencies 就成功，否则报 GIT_DEP 错
{
  printf '#!/usr/bin/env bash\n'
  printf 'if [ "${1:-}" = "-v" ]; then echo 10.33.0; exit 0; fi\n'
  printf 'if grep -q onlyBuiltDependencies pnpm-workspace.yaml 2>/dev/null; then echo "Already up to date"; exit 0; fi\n'
  printf 'echo %s >&2\n' "' ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  Failed to prepare git-hosted package: The git-hosted package \"dsh-providers-hub@0.2.1-rc.2\" needs to execute build scripts but is not in the \"onlyBuiltDependencies\" allowlist.'"
  printf 'exit 1\n'
} >"$stub/pnpm"
chmod +x "$stub/pnpm"
env PATH="$stub:$PATH" DSH_HOME="$h4" bash "$root/install.sh" --dsh-home "$h4" --yes >"$tmp/e.log" 2>&1
code=$?
chk "退出码 0（修好后重试成功）" test "$code" -eq 0
chk "写入了 onlyBuiltDependencies" has_in "$h4/profiles/desktop/pnpm-workspace.yaml" 'onlyBuiltDependencies'
chk "写的是那个包名" has_in "$h4/profiles/desktop/pnpm-workspace.yaml" 'dsh-providers-hub'
chk "重试后报完成" has_in "$tmp/e.log" '重试后 pnpm install 完成'

echo "== 卸载要顺手清掉 fallback 链接，但别动别的依赖 =="
mkdir -p "$h/profiles/desktop/node_modules/other-dep"
bash "$root/uninstall.sh" --dsh-home "$h" >"$tmp/d.log" 2>&1
chk "退出码 0" test $? -eq 0
chk "链接已删除" test ! -e "$h/profiles/desktop/node_modules/dsh-pojia"
chk "别的依赖还在" test -d "$h/profiles/desktop/node_modules/other-dep"
chk "插件目录已删" test ! -e "$h/plugins/dsh-pojia"
chk "注册已移除" lacks_in "$h/profiles/desktop/package.json" 'dsh-pojia'
chk "用户 yaml 内容保留" has_in "$h/profiles/desktop/cordis.patch.yml" 'keep-me'

echo
if [ "$fails" -gt 0 ]; then
  echo "FAILED: $fails 项未通过" >&2
  exit 1
fi
echo "pnpm 失败上报与兜底测试全部通过"
