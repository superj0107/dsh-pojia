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
if errorlevel 1 goto nonode
node "%CLI%" --doctor
set "RC=%ERRORLEVEL%"
echo.
echo exit code: %RC%  (0 = all green / 1 = has todos / 2 = blocked)
goto endcheck

:nonode
echo [!] node not found, skipping the doctor. Install Node.js 18+ and rerun.

:endcheck

echo.
echo ==============================================
echo   Real effect: run /pojia doctor inside a DSH session.
echo   Apply once in the dsh-pojia panel and restart DSH first.
echo ==============================================
echo.
pause
