@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==============================================
echo   dsh-pojia installer (Windows)
echo ==============================================
echo.

if not exist "%~dp0install.ps1" (
  echo [X] install.ps1 not found. Unzip the whole package, then run this file again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
echo ==============================================
if "%RC%"=="0" (
  echo   [OK] Installer finished.
  echo   Next: fully quit DSH, reopen it, then click Apply in the dsh-pojia panel.
) else (
  echo   [!] Installer finished with problems. Exit code: %RC%
  echo       Read the [X] and [!] lines above - most of them are about
  echo       dependencies already present in your DSH profile.
)
echo ==============================================
echo.
pause
exit /b %RC%
