@echo off
setlocal EnableDelayedExpansion
title Nightcord - Build All
color 0B

echo.
echo  ========================================================================
echo    NIGHTCORD - FULL SYSTEM BUILD PIPELINE
echo  ========================================================================
echo.

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

:: Check for Node.js and pnpm
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

where pnpm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    color 0C
    echo  [ERROR] pnpm is not installed. Run: npm install -g pnpm
    pause
    exit /b 1
)

:: 1. Terminate locking processes
echo  [1/7] Closing running Discord and installer processes...
taskkill /F /IM "Discord.exe" /T >nul 2>nul
taskkill /F /IM "DiscordPTB.exe" /T >nul 2>nul
taskkill /F /IM "DiscordCanary.exe" /T >nul 2>nul
taskkill /F /IM "Nightcord-Installer.exe" /T >nul 2>nul
taskkill /F /IM "Nightcord.exe" /T >nul 2>nul
timeout /t 1 /nobreak >nul

:: 2. Check and install dependencies
echo  [2/7] Checking dependencies...
call pnpm depCheck
if %ERRORLEVEL% neq 0 (
    color 0C
    echo  [ERROR] Dependency check failed.
    pause
    exit /b 1
)

:: 3. Build Desktop & Nightcord Core
echo.
echo  [3/7] Building Desktop and Nightcord core bundles...
call pnpm build
if %ERRORLEVEL% neq 0 (
    color 0C
    echo  [ERROR] pnpm build failed.
    pause
    exit /b 1
)

:: 4. Collect assets
echo.
echo  [4/7] Collecting extra assets and modules...
node scripts/build/collect-assets.mjs

:: 5. Build Web / Browser Extension
echo.
echo  [5/7] Building Web and Extension bundles...
call pnpm buildWeb
if %ERRORLEVEL% neq 0 (
    echo  [WARN] Web build finished with warnings or errors. Continuing desktop package...
)

:: 6. Create Distribution ZIP and Build Installer EXE
echo.
echo  [6/7] Packaging distribution and compiling Nightcord-Installer.exe...
if not exist "release\installer" mkdir "release\installer"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$staging = 'nightcord-dist-staging'; " ^
  "if (Test-Path $staging) { Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue }; " ^
  "New-Item -ItemType Directory -Path $staging -Force | Out-Null; " ^
  "if (Test-Path 'dist\desktop') { Copy-Item 'dist\desktop\*' '$staging\' -Recurse -Force }; " ^
  "if (Test-Path 'release\nightcord-dist') { Copy-Item 'release\nightcord-dist\*' '$staging\' -Recurse -Force }; " ^
  "foreach ($f in @('nightcord-index.js', 'nightcord-preload.js')) { if (Test-Path $f) { Copy-Item $f '$staging\' } }; " ^
  "Compress-Archive -Path '$staging\*' -DestinationPath 'release\installer\nightcord-dist.zip' -Force; " ^
  "Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue; " ^
  "Write-Host '  [OK] release\installer\nightcord-dist.zip created.' -ForegroundColor Green"

if exist "build-installer.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "build-installer.ps1"
)

:: 7. Inject into Local Discord
echo.
echo  [7/7] Injecting into local Discord installations...
node scripts/inject.mjs

echo.
echo  ========================================================================
echo    NIGHTCORD - BUILD ALL COMPLETE
echo  ========================================================================
echo.
if exist "release\installer\Nightcord-Installer.exe" (
    echo    Installer : release\installer\Nightcord-Installer.exe
)
if exist "release\installer\nightcord-dist.zip" (
    echo    Dist Zip  : release\installer\nightcord-dist.zip
)
if exist "dist\desktop\patcher.js" (
    echo    Desktop   : dist\desktop\patcher.js
)
echo.
color 0A
echo  Press any key to close...
pause >nul
