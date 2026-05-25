@echo off
:: ============================================================
::  AZ-Assistant — Windows Installer Build Script
::  실행: scripts\build-installer.bat [target]
::
::  target:
::    all         모든 플랫폼 빌드 (기본값)
::    win         Windows x64 만
::    mac-x64     macOS Intel 만
::    mac-arm64   macOS Apple Silicon 만
::    linux       Linux x64 만
:: ============================================================

setlocal enabledelayedexpansion

:: 기본 target
set TARGET=%1
if "%TARGET%"=="" set TARGET=all

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  AZ-Assistant Installer Build                ║
echo  ║  Target: %TARGET%
echo  ╚══════════════════════════════════════════════╝
echo.

:: ── 경로 설정 ────────────────────────────────────────────────────────────────
set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..
set INSTALLER_DIR=%ROOT_DIR%\installer
set RELEASES_DIR=%ROOT_DIR%\releases
set EXT_DEST=%INSTALLER_DIR%\extension

:: ── 의존성 확인 ──────────────────────────────────────────────────────────────
echo [1] 의존성 확인...
where node >nul 2>&1 || (echo   X  Node.js가 설치되어 있지 않습니다. & exit /b 1)
where npm  >nul 2>&1 || (echo   X  npm이 설치되어 있지 않습니다. & exit /b 1)

for /f "tokens=*" %%v in ('node --version') do echo   ✓  Node.js %%v
for /f "tokens=*" %%v in ('npm --version')  do echo   ✓  npm %%v

:: ── Chrome Extension 빌드 ────────────────────────────────────────────────────
echo.
echo [2] Chrome Extension 빌드 (Vite)...
cd /d "%ROOT_DIR%"

echo     패키지 설치 중...
call npm install --silent
if errorlevel 1 (echo   X  npm install 실패 & exit /b 1)

echo     TypeScript 컴파일 + Vite 번들링...
call npm run build
if errorlevel 1 (echo   X  npm run build 실패 & exit /b 1)

if not exist "%ROOT_DIR%\dist\manifest.json" (
  echo   X  빌드 실패: dist\manifest.json 없음
  exit /b 1
)
echo   ✓  Extension 빌드 완료

:: ── Extension 파일 복사 ──────────────────────────────────────────────────────
echo.
echo [3] Extension 파일을 installer\extension\ 으로 복사...
if exist "%EXT_DEST%" rmdir /s /q "%EXT_DEST%"
xcopy /e /i /q "%ROOT_DIR%\dist" "%EXT_DEST%\" >nul
echo   ✓  Extension 파일 복사 완료

:: ── Installer 빌드 ───────────────────────────────────────────────────────────
echo.
echo [4] Installer TypeScript 컴파일...
cd /d "%INSTALLER_DIR%"

echo     installer 의존성 설치 중...
call npm install --silent
if errorlevel 1 (echo   X  npm install 실패 & exit /b 1)

echo     TypeScript → JavaScript 컴파일...
call npx tsc
if errorlevel 1 (echo   X  tsc 컴파일 실패 & exit /b 1)
echo   ✓  컴파일 완료

:: ── 실행파일 패키징 ──────────────────────────────────────────────────────────
echo.
echo [5] 실행파일 패키징 (@yao-pkg/pkg)...
if not exist "%RELEASES_DIR%" mkdir "%RELEASES_DIR%"

if "%TARGET%"=="win" goto :build_win
if "%TARGET%"=="mac-x64" goto :build_mac_x64
if "%TARGET%"=="mac-arm64" goto :build_mac_arm64
if "%TARGET%"=="linux" goto :build_linux
:: 기본값: all

:build_win
echo     Windows x64 빌드 중...
call npx @yao-pkg/pkg . --target node20-win-x64 --output "%RELEASES_DIR%\az-assistant-installer-win.exe" --compress GZip
if errorlevel 1 (echo   ! Windows 빌드 경고) else (echo   ✓  Windows x64 완료)
if "%TARGET%"=="win" goto :done

:build_mac_x64
echo     macOS Intel (x64) 빌드 중...
call npx @yao-pkg/pkg . --target node20-macos-x64 --output "%RELEASES_DIR%\az-assistant-installer-mac-x64" --compress GZip
if errorlevel 1 (echo   ! macOS x64 빌드 경고) else (echo   ✓  macOS Intel 완료)
if "%TARGET%"=="mac-x64" goto :done

:build_mac_arm64
echo     macOS Apple Silicon (arm64) 빌드 중...
call npx @yao-pkg/pkg . --target node20-macos-arm64 --output "%RELEASES_DIR%\az-assistant-installer-mac-arm64" --compress GZip
if errorlevel 1 (echo   ! macOS arm64 빌드 경고) else (echo   ✓  macOS ARM 완료)
if "%TARGET%"=="mac-arm64" goto :done

:build_linux
echo     Linux x64 빌드 중...
call npx @yao-pkg/pkg . --target node20-linux-x64 --output "%RELEASES_DIR%\az-assistant-installer-linux" --compress GZip
if errorlevel 1 (echo   ! Linux 빌드 경고) else (echo   ✓  Linux x64 완료)

:done
echo.
echo  ══════════════════════════════════════════════
echo    ✅  빌드 완료!
echo  ══════════════════════════════════════════════
echo.
echo  생성된 파일 (%RELEASES_DIR%):
dir /b "%RELEASES_DIR%" 2>nul
echo.

endlocal
