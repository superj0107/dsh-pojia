@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==============================================
echo   dsh-pojia 一键安装（Windows）
echo ==============================================
echo.

if not exist "%~dp0install.ps1" (
  echo [X] 同目录里没找到 install.ps1，请把压缩包完整解压后再双击本文件。
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 (
  echo.
  echo ==============================================
  echo   安装失败，把上面的报错发出来。
  echo ==============================================
) else (
  echo.
  echo ==============================================
  echo   安装完成。
  echo   下一步：完全退出 DSH，重新打开，然后在会话
  echo   标题旁点 dsh-pojia 面板的「应用」。
  echo ==============================================
)

echo.
pause
