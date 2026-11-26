@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==============================================
echo   dsh-pojia 安装检查（Windows）
echo ==============================================
echo.

if "%DSH_HOME%"=="" set "DSH_HOME=%USERPROFILE%\.dsh"
echo DSH home : %DSH_HOME%
set "CLI=%DSH_HOME%\plugins\dsh-pojia\bin\dsh-pojia.js"

if not exist "%CLI%" (
  echo.
  echo [X] 没找到插件：%CLI%
  echo     先双击「点我一键安装-Windows.bat」装一次。
  echo.
  pause
  exit /b 1
)

echo 插件     : %CLI%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] 没找到 node，跳过状态检查。装好 Node.js 18+ 再跑一次。
) else (
  node "%CLI%" --status
)

echo.
echo ==============================================
echo   真正的破甲效果请在 DSH 会话里发 /pojia status 看。
echo   面板里的「应用」点过一次、宿主重启过才算生效。
echo ==============================================
echo.
pause
