@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==============================================
echo   dsh-pojia 一键卸载（Windows）
echo ==============================================
echo.

if not exist "%~dp0uninstall.ps1" (
  echo [X] 同目录里没找到 uninstall.ps1，请把压缩包完整解压后再双击本文件。
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
if errorlevel 1 (
  echo.
  echo ==============================================
  echo   卸载失败，把上面的报错发出来。
  echo ==============================================
) else (
  echo.
  echo ==============================================
  echo   卸载完成。请完全退出并重新打开 DSH。
  echo ==============================================
)

echo.
pause
