#!/usr/bin/env bash
# 双击本文件即可卸载 dsh-pojia（macOS 会用「终端」打开并执行）
cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo "  dsh-pojia 一键卸载（macOS / Linux / WSL）"
echo "=============================================="
echo

if [ ! -f ./uninstall.sh ]; then
  echo "[X] 同目录里没找到 uninstall.sh，请把压缩包完整解压后再双击本文件。"
  echo
  printf '按回车关闭窗口...'
  read -r _ || true
  exit 1
fi

chmod +x ./uninstall.sh ./install.sh 2>/dev/null || true
bash ./uninstall.sh "$@" 2>&1
code=$?

echo
echo "=============================================="
if [ "$code" -eq 0 ]; then
  echo "  卸载完成。请完全退出并重新打开 DSH。"
else
  echo "  卸载失败（退出码 $code），把上面的报错发出来。"
fi
echo "=============================================="
echo
printf '按回车关闭窗口...'
read -r _ || true
