@echo off
REM ─── Nightcord — Publier une nouvelle release sur Gitea ──────────────────────
REM Usage : publish-release.bat v1.27.2
REM Necessite : pnpm, node, ssh, curl

setlocal EnableDelayedExpansion

set "INPUT_VER=%~1"
set "NOTES=%~2"

if "%INPUT_VER%"=="" (
    echo.
    echo  ========================================================
    echo   NIGHTCORD — PUBLICATION DE NOUVELLE RELEASE
    echo  ========================================================
    echo.
    set /p INPUT_VER=" Entrez la version a publier (ex: 1.28.0 ou v1.28.0) : "
)

if "%INPUT_VER%"=="" (
    echo  [ERREUR] Aucune version specifiee. Annulation.
    pause
    exit /b 1
)

REM Nettoyer le v initial pour la version numerique
set "VERSION=%INPUT_VER%"
if "%VERSION:~0,1%"=="v" set "VERSION=%VERSION:~1%"
if "%VERSION:~0,1%"=="V" set "VERSION=%VERSION:~1%"

set "TAG=v%VERSION%"
if "%NOTES%"=="" set "NOTES=%TAG%"

REM ── Config Gitea ──────────────────────────────────────────────────────────────
set GITEA_URL=https://source.nightcord.st
set GITEA_LOCAL_URL=http://127.0.0.1:3000
set GITEA_REPO=nightcord/nightcord
set GITEA_API=%GITEA_URL%/api/v1

REM ── Lecture du token depuis le fichier local ─────────────────────────────────
set TOKEN_FILE=%USERPROFILE%\.gitea_token
if not exist "%TOKEN_FILE%" (
    echo  [ERREUR] Fichier de token introuvable : %TOKEN_FILE%
    echo  Creez-le avec : echo votre_token_gitea ^> "%%USERPROFILE%%\.gitea_token"
    echo  Generez un token sur : %GITEA_URL%/user/settings/applications
    pause
    exit /b 1
)

set /p GITEA_TOKEN=<"%TOKEN_FILE%"
set "GITEA_TOKEN=%GITEA_TOKEN: =%"

if "%GITEA_TOKEN%"=="" (
    echo  [ERREUR] Le fichier %TOKEN_FILE% est vide.
    pause
    exit /b 1
)

REM Chemins de sortie
set DIST_DIR=dist\desktop
set OUT_DIR=release\installer
set DIST_ZIP=%OUT_DIR%\nightcord-dist.zip
set INSTALLER_EXE=%OUT_DIR%\Nightcord-Installer.exe
set VERSION_JSON=%OUT_DIR%\version.json
set DESKTOP_ASAR=dist\desktop.asar
set CHROME_ZIP=dist\extension-chrome.zip
set FIREFOX_ZIP=dist\extension-firefox.zip

echo.
echo  =======================================================
echo     NIGHTCORD - Publication release %TAG%
echo  =======================================================
echo.

REM ── 1. Mise a jour de la version ──────────────────────────────────────────────
echo  [1/8] Mise a jour de la version vers %VERSION%...
node -e "const fs = require('fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); pkg.version = '%VERSION%'; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 4) + '\n', 'utf8');"
echo  [1/8] Version mise a jour (%VERSION%).

REM ── 2. Envoi du code source sur Gitea ─────────────────────────────────────────
echo.
echo  [2/8] Committer et pusher le code source...
git add .
git diff --quiet --cached
if errorlevel 1 (
    git commit -m "build: release %TAG%"
) else (
    echo  Aucun changement a committer.
)
git push --set-upstream origin master
if errorlevel 1 (
    echo  [AVERTISSEMENT] Impossible de push sur Gitea directement via git (VPN/SSH requis). Continuation du build...
) else (
    echo  [2/8] Code source synchronise avec Gitea.
)

REM ── 3. Build Extensions Web (Chrome et Firefox via buildextension.bat) ─────────
echo.
echo  [3/8] Compilation des extensions Chrome et Firefox (buildextension.bat)...
taskkill /F /IM Discord.exe /T >nul 2>&1
taskkill /F /IM DiscordPTB.exe /T >nul 2>&1
taskkill /F /IM DiscordCanary.exe /T >nul 2>&1
taskkill /F /IM Nightcord-Installer.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul

call buildextension.bat %VERSION%
if errorlevel 1 (
    echo  [ERREUR] buildextension.bat a echoue.
    pause
    exit /b 1
)

echo.
echo  [3b/8] Compilation du client Desktop (pnpm build)...
call pnpm build
if errorlevel 1 (
    echo  [ERREUR] pnpm build a echoue.
    pause
    exit /b 1
)

echo  [3/8] Builds JS et Extensions termines !

REM ── 4. Assets ─────────────────────────────────────────────────────────────────
echo.
echo  [4/8] Copie des assets (ffmpeg, node, modules...) vers %DIST_DIR%...
node scripts\build\collect-assets.mjs
echo  [4/8] Assets copies.

REM ── 5. Nightcord-Installer.exe ────────────────────────────────────────────────
echo.
echo  [5/8] Compilation de Nightcord-Installer.exe...
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "build-installer.ps1"
if errorlevel 1 (
    echo  [ERREUR] Compilation de l'installeur echouee.
    pause
    exit /b 1
)
if not exist "%INSTALLER_EXE%" (
    echo  [ERREUR] Nightcord-Installer.exe introuvable apres compilation.
    pause
    exit /b 1
)
for %%F in ("%INSTALLER_EXE%") do echo  [5/8] Nightcord-Installer.exe cree (%%~zF octets)

REM ── 6. nightcord-dist.zip ─────────────────────────────────────────────────────
echo.
echo  [6/8] Creation de nightcord-dist.zip...
if not exist "%DIST_DIR%\patcher.js" (
    echo  [ERREUR] dist\desktop\patcher.js introuvable.
    pause
    exit /b 1
)
if exist "%DIST_ZIP%" del /F /Q "%DIST_ZIP%"
del /s /q "%DIST_DIR%\*.map" >nul 2>&1
del /s /q "%DIST_DIR%\*.LEGAL.txt" >nul 2>&1
node scripts\build\verify-dist.mjs
if errorlevel 1 (
    echo  [ERREUR] Verification du dist echouee.
    pause
    exit /b 1
)
powershell -NoProfile -Command "Add-Type -Assembly System.IO.Compression.FileSystem; $src = (Resolve-Path '%DIST_DIR%').Path; $dst = (Join-Path (Resolve-Path 'release\installer').Path 'nightcord-dist.zip'); [System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $false)"
if not exist "%DIST_ZIP%" (
    echo  [ERREUR] Impossible de creer nightcord-dist.zip
    pause
    exit /b 1
)
for %%F in ("%DIST_ZIP%") do echo  [6/8] nightcord-dist.zip cree (%%~zF octets)

REM ── 7. version.json ───────────────────────────────────────────────────────────
echo.
echo  [7/8] Mise a jour de version.json...
for /f "usebackq" %%d in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd'"`) do set ISO_DATE=%%d
(
    echo {
    echo   "version": "%VERSION%",
    echo   "releaseDate": "%ISO_DATE%",
    echo   "installerUrl": "%GITEA_URL%/%GITEA_REPO%/releases/download/%TAG%/Nightcord-Installer.exe",
    echo   "distUrl": "%GITEA_URL%/%GITEA_REPO%/releases/download/%TAG%/nightcord-dist.zip",
    echo   "downloadUrl": "%GITEA_URL%/%GITEA_REPO%/releases/download/%TAG%/desktop.asar",
    echo   "changelog": "%TAG%"
    echo }
) > "%VERSION_JSON%"
echo  [7/8] version.json mis a jour.

REM ── 8. Publier sur Gitea Releases (Tunnel SSH sans limite Cloudflare) ──────────
echo.
echo  [8/8] Publication des 6 assets de release sur Gitea...

powershell -NoProfile -Command ^
  "$test = try { (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/v1/version' -TimeoutSec 2 -UseBasicParsing).StatusCode } catch { 0 }; " ^
  "if ($test -ne 200) { " ^
  "  Write-Host '  Demarrage du tunnel SSH vers Gitea (port 3000)...' -ForegroundColor Cyan; " ^
  "  Start-Process -WindowStyle Hidden ssh -ArgumentList '-N -L 3000:127.0.0.1:3000 nc'; " ^
  "  Start-Sleep -Seconds 2; " ^
  "}"

node -e "
const fs = require('fs');
const http = require('http');
const https = require('https');

async function main() {
    const version = '%VERSION%';
    const tag = '%TAG%';
    const notes = '%TAG%';
    const token = '%GITEA_TOKEN%';
    const repo = '%GITEA_REPO%';

    let baseUrl = 'http://127.0.0.1:3000';
    try {
        await new Promise((res, rej) => {
            const req = http.get('http://127.0.0.1:3000/api/v1/version', { timeout: 2000 }, r => {
                if (r.statusCode === 200) res(true); else rej();
            });
            req.on('error', rej);
            req.on('timeout', () => { req.destroy(); rej(); });
        });
        console.log('  [Tunnel SSH Connecte] Utilisation de ' + baseUrl + ' (0 limite Cloudflare)');
    } catch {
        baseUrl = 'https://source.nightcord.st';
        console.log('  [Direct] Utilisation de ' + baseUrl);
    }

    const client = baseUrl.startsWith('https') ? https : http;

    function reqPromise(options, bodyData) {
        return new Promise((resolve, reject) => {
            const req = client.request(options, res => {
                let chunks = [];
                res.on('data', d => chunks.push(d));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    resolve({ status: res.statusCode, data: buf.toString('utf8'), raw: buf });
                });
            });
            req.on('error', reject);
            if (bodyData) req.write(bodyData);
            req.end();
        });
    }

    console.log('  Creation/Recuperation de la release ' + tag + '...');
    const urlObj = new URL(baseUrl + '/api/v1/repos/' + repo + '/releases/tags/' + tag);
    let releaseRes = await reqPromise({
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname,
        method: 'GET',
        headers: { 'Authorization': 'token ' + token, 'Accept': 'application/json' }
    });

    let release = null;
    if (releaseRes.status === 200) {
        release = JSON.parse(releaseRes.data);
    } else {
        const createUrl = new URL(baseUrl + '/api/v1/repos/' + repo + '/releases');
        const payload = JSON.stringify({
            tag_name: tag,
            name: tag,
            body: tag,
            draft: false,
            prerelease: false
        });
        const createRes = await reqPromise({
            hostname: createUrl.hostname,
            port: createUrl.port || (createUrl.protocol === 'https:' ? 443 : 80),
            path: createUrl.pathname,
            method: 'POST',
            headers: {
                'Authorization': 'token ' + token,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, payload);

        if (createRes.status === 201 || createRes.status === 200) {
            release = JSON.parse(createRes.data);
        } else {
            throw new Error('Echec creation release: ' + createRes.status + ' ' + createRes.data);
        }
    }

    const releaseId = release.id;
    console.log('  Release ID: ' + releaseId + ' (Nom: ' + release.name + ', Tag: ' + release.tag_name + ')');

    const filesToUpload = [
        { name: 'Nightcord-Installer.exe', path: '%INSTALLER_EXE%', type: 'application/octet-stream' },
        { name: 'desktop.asar', path: '%DESKTOP_ASAR%', type: 'application/octet-stream' },
        { name: 'extension-chrome.zip', path: '%CHROME_ZIP%', type: 'application/zip' },
        { name: 'extension-firefox.zip', path: '%FIREFOX_ZIP%', type: 'application/zip' },
        { name: 'nightcord-dist.zip', path: '%DIST_ZIP%', type: 'application/zip' },
        { name: 'version.json', path: '%VERSION_JSON%', type: 'application/json' }
    ];

    if (Array.isArray(release.assets)) {
        for (const asset of release.assets) {
            if (filesToUpload.some(f => f.name === asset.name)) {
                console.log('  Suppression ancien asset: ' + asset.name);
                const delUrl = new URL(baseUrl + '/api/v1/repos/' + repo + '/releases/' + releaseId + '/assets/' + asset.id);
                await reqPromise({
                    hostname: delUrl.hostname,
                    port: delUrl.port || (delUrl.protocol === 'https:' ? 443 : 80),
                    path: delUrl.pathname,
                    method: 'DELETE',
                    headers: { 'Authorization': 'token ' + token }
                });
            }
        }
    }

    for (const f of filesToUpload) {
        if (!fs.existsSync(f.path)) {
            console.warn('  [Ignore] Fichier introuvable: ' + f.path);
            continue;
        }

        const size = fs.statSync(f.path).size;
        const sizeMb = (size / (1024 * 1024)).toFixed(1);
        console.log('  -> Upload de ' + f.name + ' (' + sizeMb + ' MB)...');

        const uploadUrl = new URL(baseUrl + '/api/v1/repos/' + repo + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(f.name));
        
        await new Promise((res, rej) => {
            const fileStream = fs.createReadStream(f.path);
            const req = client.request({
                hostname: uploadUrl.hostname,
                port: uploadUrl.port || (uploadUrl.protocol === 'https:' ? 443 : 80),
                path: uploadUrl.pathname + uploadUrl.search,
                method: 'POST',
                headers: {
                    'Authorization': 'token ' + token,
                    'Content-Type': f.type,
                    'Content-Length': size
                }
            }, r => {
                if (r.statusCode >= 200 && r.statusCode < 300) {
                    console.log('     OK: ' + f.name);
                    res();
                } else {
                    let body = '';
                    r.on('data', d => body += d);
                    r.on('end', () => rej(new Error('Upload error ' + r.statusCode + ': ' + body)));
                }
            });
            req.on('error', rej);
            fileStream.pipe(req);
        });
    }

    console.log('\n  Tous les 6 assets ont ete publies avec succes !');
}

main().catch(err => {
    console.error('\n  [ERREUR]', err);
    process.exit(1);
});
"

if errorlevel 1 (
    echo  [ERREUR] Publication des assets echouee.
    pause
    exit /b 1
)

REM ── Done ───────────────────────────────────────────────────────────────────────
echo.
echo  =======================================================================
echo    Nightcord %TAG% publie avec succes sur Gitea !
echo.
echo    URL : %GITEA_URL%/%GITEA_REPO%/releases/tag/%TAG%
echo.
echo    Nom de Release : %TAG%
echo    Tag Git        : %TAG%
echo    Description    : %TAG%
echo.
echo    Fichiers publies :
echo      - Nightcord-Installer.exe    - installeur .exe avec GUI
echo      - desktop.asar               - asar Discord patcher
echo      - extension-chrome.zip       - extension Chrome/Chromium
echo      - extension-firefox.zip      - extension Firefox
echo      - nightcord-dist.zip         - JS obfusques (pour l'injection)
echo      - version.json               - metadonnees de version
echo  =======================================================================
echo.
pause
