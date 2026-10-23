@echo off
chcp 65001 >nul
title Nightcord Live Debug Console
echo ============================================================================
echo   NIGHTCORD LIVE DEBUG CONSOLE (Main + Renderer + Freeze Detector)
echo ============================================================================
echo.

set "NIGHTCORD_DEBUG_LOGS=1"
set "NIGHTCORD_LOG_FILE=%TEMP%\nightcord-debug.log"

:: Clear previous log file
type nul > "%NIGHTCORD_LOG_FILE%"

:: Close existing Discord instances gracefully first so LevelDB flushes localStorage tokens cleanly
echo [*] Fermeture des instances Discord existantes...
taskkill /IM Discord.exe >nul 2>&1
timeout /t 2 /nobreak >nul
taskkill /F /IM Discord.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: Find the latest Discord app-1.0.xxxx folder
set "DISCORD_EXE="
for /f "delims=" %%D in ('dir /b /ad /o-n "%LOCALAPPDATA%\Discord\app-*" 2^>nul') do (
    if not defined DISCORD_EXE (
        if exist "%LOCALAPPDATA%\Discord\%%D\Discord.exe" (
            set "DISCORD_EXE=%LOCALAPPDATA%\Discord\%%D\Discord.exe"
        )
    )
)

if not defined DISCORD_EXE (
    echo [!] Impossible de trouver Discord.exe dans %LOCALAPPDATA%\Discord
    pause
    exit /b 1
)

echo [*] Lancement de : %DISCORD_EXE%
echo [*] Fichier de log en direct : %NIGHTCORD_LOG_FILE%
echo [*] Appuyez sur Ctrl+C pour quitter la console de logs (Discord restera ouvert).
echo ============================================================================
echo.

start "" "%DISCORD_EXE%" --enable-logging --nightcord-debug-logs

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$logFile = $env:NIGHTCORD_LOG_FILE; " ^
    "Get-Content -Path $logFile -Wait -Encoding UTF8 | ForEach-Object { " ^
    "    if ($_ -match 'FREEZE|ERROR|\[Perf\]') { Write-Host $_ -ForegroundColor Red } " ^
    "    elseif ($_ -match 'WARN') { Write-Host $_ -ForegroundColor Yellow } " ^
    "    elseif ($_ -match '\[MAIN') { Write-Host $_ -ForegroundColor Cyan } " ^
    "    else { Write-Host $_ } " ^
    "}"
