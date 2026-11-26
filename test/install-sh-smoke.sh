#!/usr/bin/env bash
# install.sh 冒烟测试（macOS / Linux 通用，CI 里也跑这个）
#   用法：bash test/install-sh-smoke.sh
# 覆盖：全新安装 → 幂等重装 → 旧 (install.ps1) 标记迁移 → 卸载还原。
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/pojia-smoke.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

home="$tmp/dsh-home"
prof="$home/profiles/desktop"
mkdir -p "$prof"
pkg="$prof/package.json"
yml="$prof/cordis.patch.yml"

fails=0
check() {
  local desc="$1"
  shift
  if "$@"; then
    printf '  ok   %s\n' "$desc"
  else
    printf '  FAIL %s\n' "$desc" >&2
    fails=$((fails + 1))
  fi
}

# 断言工具：node 一行程序，只含双引号，避免 shell 嵌套引号
has_managed_block_once() {
  node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");const n=t.split("managed block - do not edit inside").length-1;process.exit(n===1?0:1);' "$1"
}
has_no_managed_block() {
  node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");const n=t.split("managed block").length-1;process.exit(n===0?0:1);' "$1"
}
has_no_legacy_marker() {
  node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");const n=t.split("managed block (install.ps1)").length-1;process.exit(n===0?0:1);' "$1"
}
keeps_user_content() {
  node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");process.exit(t.includes("id: keep-me")?0:1);' "$1"
}
dep_is_file_ref() {
  node -e 'const j=require(process.argv[1]);process.exit(j.dependencies["dsh-pojia"]==="file:../../plugins/dsh-pojia"?0:1);' "$1"
}
dep_removed() {
  node -e 'const j=require(process.argv[1]);process.exit(j.dependencies["dsh-pojia"]===undefined?0:1);' "$1"
}
bundle_appended_once() {
  node -e 'const j=require(process.argv[1]);const b=j.dsh.profile.bundles;const n=b.filter(function(x){return x==="dsh-pojia"}).length;process.exit(n===1&&b[0]==="some-other-bundle"?0:1);' "$1"
}
bundle_removed() {
  node -e 'const j=require(process.argv[1]);const b=j.dsh.profile.bundles;process.exit(!b.includes("dsh-pojia")&&b.includes("some-other-bundle")?0:1);' "$1"
}

cat >"$pkg" <<'JSON'
{
  "name": "profile-desktop",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh": "0.2.2-rc.5"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "some-other-bundle"
      ]
    }
  }
}
JSON

cat >"$yml" <<'YML'
# user own content must survive
- insert:
    - id: keep-me
      name: 'keep-me'

# >>> dsh-pojia managed block (install.ps1) - do not edit inside
- insert:
    - id: dsh-pojia
      name: 'dsh-pojia'

# <<< dsh-pojia managed block
YML

run_install() {
  DSH_HOME="" bash "$root/install.sh" --dsh-home "$home" --skip-pnpm-install
}

echo "== 1) 全新安装 =="
if ! run_install >"$tmp/install.log" 2>&1; then
  echo "install.sh 退出码非 0：" >&2
  cat "$tmp/install.log" >&2
  exit 1
fi

check "插件目录已创建" test -f "$home/plugins/dsh-pojia/package.json"
check "安装脚本没被复制进去" test ! -e "$home/plugins/dsh-pojia/install.sh"
check "install.ps1 也没被复制进去" test ! -e "$home/plugins/dsh-pojia/install.ps1"
check "lib 目录完整" test -f "$home/plugins/dsh-pojia/lib/index.js"
check "bin 可执行" test -x "$home/plugins/dsh-pojia/bin/dsh-pojia.js"
check "package.json 有 file: 依赖" dep_is_file_ref "$pkg"
check "bundle 已追加且原有 bundle 在前" bundle_appended_once "$pkg"
check "cordis.patch.yml 只有一段托管块" has_managed_block_once "$yml"
check "旧 (install.ps1) 标记已迁移" has_no_legacy_marker "$yml"
check "用户原有内容保留" keeps_user_content "$yml"

echo "== 2) 幂等重装 =="
if ! run_install >"$tmp/install2.log" 2>&1; then
  echo "第二次 install.sh 失败：" >&2
  cat "$tmp/install2.log" >&2
  exit 1
fi

check "托管块仍只有一段" has_managed_block_once "$yml"
check "bundle 没有重复" bundle_appended_once "$pkg"

echo "== 3) 卸载 =="
if ! bash "$root/install.sh" --dsh-home "$home" --uninstall >"$tmp/uninstall.log" 2>&1; then
  echo "uninstall 失败：" >&2
  cat "$tmp/uninstall.log" >&2
  exit 1
fi

check "插件目录已删除" test ! -e "$home/plugins/dsh-pojia"
check "依赖行已移除" dep_removed "$pkg"
check "bundle 已移除但保留其它 bundle" bundle_removed "$pkg"
check "托管块已清空" has_no_managed_block "$yml"
check "用户原有内容仍在" keeps_user_content "$yml"

echo
if [ "$fails" -gt 0 ]; then
  echo "FAILED: $fails 项未通过" >&2
  exit 1
fi
echo "install.sh 冒烟测试全部通过"
