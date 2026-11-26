#!/usr/bin/env bash
# 双击本文件即可安装 dsh-pojia（macOS 会用「终端」打开并执行）
#
# 若提示「无法打开，因为来自身份不明的开发者」：
#   右键 → 打开；或在「终端」里先跑一次
#   xattr -dr com.apple.quarantine <本目录>
cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo "  dsh-pojia 一键安装（macOS / Linux / WSL）"
echo "=============================================="
echo

if [ ! -f ./install.sh ]; then
  echo "[X] 同目录里没找到 install.sh，请把压缩包完整解压后再双击本文件。"
  echo
  printf '按回车关闭窗口...'
  read -r _ || true
  exit 1
fi

chmod +x ./install.sh 2>/dev/null || true
bash ./install.sh "$@" 2>&1
code=$?

echo
echo "=============================================="
if [ "$code" -eq 0 ]; then
  echo "  安装完成。"
  echo "  下一步：完全退出 DSH → 重新打开 →"
  echo "  在会话标题旁点 dsh-pojia 面板的「应用」。"
else
  echo "  安装失败（退出码 $code），把上面的报错发出来。"
fi
echo "=============================================="
echo
printf '按回车关闭窗口...'
read -r _ || true
