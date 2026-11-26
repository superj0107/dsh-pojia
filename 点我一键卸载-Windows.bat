@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==============================================
echo   dsh-pojia uninstaller (Windows)
echo ==============================================
echo.

if not exist "%~dp0uninstall.ps1" (
  echo [X] uninstall.ps1 not found. Unzip the whole package, then run this file again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
echo ==============================================
if "%RC%"=="0" (
  echo   [OK] Uninstall finished. Fully quit and reopen DSH.
) else (
  echo   [!] Uninstall finished with problems. Exit code: %RC%
  echo       Read the [X] and [!] lines above.
)
echo ==============================================
echo.
pause
exit /b %RC%
