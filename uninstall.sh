#!/usr/bin/env bash
# =============================================================================
# dsh-pojia 卸载 — macOS / Linux / WSL
#
# 终端用法：
#   bash uninstall.sh                 # 从自动探测到的 DSH home 的 desktop profile 卸载
#   bash uninstall.sh --profile web   # 指定 profile
#   bash uninstall.sh --dsh-home "$HOME/my-dsh"
#
# macOS 想省事：直接双击同目录的「点我一键卸载-macOS.command」。
# 本脚本只是 install.sh --uninstall 的包装，参数原样透传。
# =============================================================================
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd -P)"

if [ ! -f "$here/install.sh" ]; then
  printf '[X] 同目录里缺少 install.sh，无法卸载。\n' >&2
  printf '    请把压缩包完整解压后再运行（install.sh 与 uninstall.sh 必须在一起）。\n' >&2
  exit 1
fi

exec bash "$here/install.sh" --uninstall "$@"
