#!/usr/bin/env bash
# 双击本文件即可检查 dsh-pojia 是否装好（macOS 会用「终端」打开并执行）
cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo "  dsh-pojia 安装检查（macOS / Linux / WSL）"
echo "=============================================="
echo

# 与 install.sh 相同的 home 探测顺序
if [ -n "${DSH_HOME:-}" ]; then
  home="$DSH_HOME"
elif [ -d "$HOME/Library/Application Support/DeepSeek Harness/dsh-home/profiles" ]; then
  home="$HOME/Library/Application Support/DeepSeek Harness/dsh-home"
else
  home="$HOME/.dsh"
fi

echo "DSH home : $home"
cli="$home/plugins/dsh-pojia/bin/dsh-pojia.js"

if [ ! -f "$cli" ]; then
  echo
  echo "[X] 没找到插件：$cli"
  echo "    先双击「点我一键安装-macOS.command」装一次。"
  echo
  printf '按回车关闭窗口...'
  read -r _ || true
  exit 1
fi

echo "插件    : $cli"
echo

if command -v node >/dev/null 2>&1; then
  node "$cli" --doctor 2>&1
  rc=$?
  echo
  echo "退出码: $rc（0 全绿 / 1 有待办 / 2 有阻断）"
else
  echo "[!] 没找到 node，跳过诊断。装好 Node.js 18+ 再跑一次。"
fi

echo
echo "=============================================="
echo "  真正的破甲效果请在 DSH 会话里发 /pojia doctor 看（第一行就是 verdict）。"
echo "  面板里的「应用」点过一次、宿主重启过，才算生效。"
echo "=============================================="
echo
printf '按回车关闭窗口...'
read -r _ || true
