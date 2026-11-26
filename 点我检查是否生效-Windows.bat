@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==============================================
echo   dsh-pojia check (Windows)
echo ==============================================
echo.

if "%DSH_HOME%"=="" set "DSH_HOME=%USERPROFILE%\.dsh"
echo DSH home : %DSH_HOME%
set "CLI=%DSH_HOME%\plugins\dsh-pojia\bin\dsh-pojia.js"

if not exist "%CLI%" (
  echo.
  echo [X] Plugin not found: %CLI%
  echo     Run the installer .bat in this folder first.
  echo.
  pause
  exit /b 1
)

echo Plugin   : %CLI%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] node not found, skipping the status check. Install Node.js 18+ and rerun.
) else (
  node "%CLI%" --status
)

echo.
echo ==============================================
echo   Real effect: run /pojia status inside a DSH session.
echo   Apply once in the dsh-pojia panel and restart DSH first.
echo ==============================================
echo.
pause
