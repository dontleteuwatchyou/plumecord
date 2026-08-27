/*
 * Nightcord — Local injector for Discord Desktop (Equilotl Architecture)
 * Injecte Nightcord dans une installation Discord existante :
 * 1. Trouve le répertoire resources de Discord
 * 2. Garantit la présence et l'intégrité de _app.asar (auto-restauration depuis nupkg si nécessaire)
 * 3. Génère un app.asar binaire valide (format Equilotl) chargeant patcher.js
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./checkNodeVersion.js";

import { execSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const BASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(BASE_DIR, "dist", "desktop");

/**
 * Génère un binaire app.asar minimaliste et conforme au standard ASAR d'Electron / Equilotl
 */
function createAppAsarBuffer(patcherJsPath, pkgName = "discord") {
    const packageJson = JSON.stringify({
        name: pkgName,
        main: "index.js"
    });

    const normalizedPath = patcherJsPath.replace(/\\/g, "/");
    const indexJs = `require(${JSON.stringify(normalizedPath)});\n`;

    const indexBuf = Buffer.from(indexJs, "utf-8");
    const pkgBuf = Buffer.from(packageJson, "utf-8");

    const header = {
        files: {
            "index.js": {
                size: indexBuf.length,
                offset: "0"
            },
            "package.json": {
                size: pkgBuf.length,
                offset: String(indexBuf.length)
            }
        }
    };

    const headerJson = JSON.stringify(header);
    const headerBuf = Buffer.from(headerJson, "utf-8");
    const headerStringSize = headerBuf.length;
    const dataSize = 4;
    const alignedSize = (headerStringSize + dataSize - 1) & ~(dataSize - 1);
    const diff = alignedSize - headerStringSize;

    const paddedHeaderBuf = diff > 0
        ? Buffer.concat([headerBuf, Buffer.alloc(diff, 0x30)])
        : headerBuf;

    const headerSize = alignedSize + 8;
    const headerObjectSize = alignedSize + dataSize;

    const metaBuf = Buffer.alloc(16);
    metaBuf.writeUInt32LE(dataSize, 0);
    metaBuf.writeUInt32LE(headerSize, 4);
    metaBuf.writeUInt32LE(headerObjectSize, 8);
    metaBuf.writeUInt32LE(headerStringSize, 12);

    return Buffer.concat([
        metaBuf,
        paddedHeaderBuf,
        indexBuf,
        pkgBuf
    ]);
}

function ensureOriginalAsar(resourcesDir) {
    const backupPath = join(resourcesDir, "_app.asar");
    const appAsarPath = join(resourcesDir, "app.asar");

    if (existsSync(backupPath) && statSync(backupPath).size > 1000000) {
        return true;
    }

    if (existsSync(appAsarPath) && statSync(appAsarPath).size > 1000000) {
        try {
            renameSync(appAsarPath, backupPath);
            return true;
        } catch {
            try {
                copyFileSync(appAsarPath, backupPath);
                rmSync(appAsarPath, { force: true });
                return true;
            } catch {}
        }
    }

    // Auto-restauration depuis les packages .nupkg officiels
    const localAppData = process.env.LOCALAPPDATA || "";
    const packagesDir = join(localAppData, "Discord", "packages");
    if (existsSync(packagesDir)) {
        try {
            const pkgs = readdirSync(packagesDir).filter(f => f.endsWith(".nupkg"));
            for (const pkg of pkgs) {
                const pkgPath = join(packagesDir, pkg);
                try {
                    execSync(`tar -xf "${pkgPath}" -C "${resourcesDir}" lib/net45/resources/app.asar`);
                    const extracted = join(resourcesDir, "lib", "net45", "resources", "app.asar");
                    if (existsSync(extracted)) {
                        copyFileSync(extracted, backupPath);
                        rmSync(join(resourcesDir, "lib"), { recursive: true, force: true });
                        console.log(`[Nightcord] _app.asar auto-restauré depuis ${pkg} (${statSync(backupPath).size} octets)`);
                        return true;
                    }
                } catch {}
            }
        } catch {}
    }

    return false;
}

// ── Locate Discord installations ─────────────────────────────────────────────
function findAllDiscordResources() {
    const platform = process.platform;
    const candidates = [];

    if (platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA || "";

        for (const channel of ["Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"]) {
            const base = join(localAppData, channel);
            if (!existsSync(base)) continue;
            try {
                const versions = readdirSync(base)
                    .filter(d => /^app-\d+\.\d+\.\d+$/.test(d))
                    .sort()
                    .reverse();
                for (const ver of versions) {
                    candidates.push(join(base, ver, "resources"));
                }
            } catch { }
        }
    } else if (platform === "darwin") {
        candidates.push(
            "/Applications/Discord.app/Contents/Resources",
            "/Applications/Discord PTB.app/Contents/Resources",
            "/Applications/Discord Canary.app/Contents/Resources"
        );
    } else if (platform === "linux") {
        candidates.push(
            "/usr/share/discord/resources",
            "/usr/lib/discord/resources",
            "/opt/discord/resources",
            "/opt/Discord/resources",
            join(process.env.HOME || "", ".local/share/flatpak/app/com.discordapp.Discord/current/active/files/discord/resources"),
            "/snap/discord/current/usr/share/discord/resources"
        );
    }

    return candidates.filter(p => existsSync(p));
}

// ── Check dist/ exists ───────────────────────────────────────────────────────
function checkBuild() {
    const patcherPath = join(DIST_DIR, "patcher.js");
    if (!existsSync(patcherPath)) {
        console.error("\x1b[31m[Nightcord] dist/desktop/patcher.js introuvable !\x1b[0m");
        console.error("\x1b[33m           Lancez 'pnpm build' d'abord, puis réessayez.\x1b[0m");
        process.exit(1);
    }
}

// ── Inject ───────────────────────────────────────────────────────────────────
function inject(resourcesDir) {
    const appAsarPath = join(resourcesDir, "app.asar");
    const appDirPath = join(resourcesDir, "app");

    // Nettoyer les fichiers de mods tiers
    for (const modAsar of ["vencord.asar", "equicord.asar", "betterdiscord.asar"]) {
        const p = join(resourcesDir, modAsar);
        if (existsSync(p)) {
            try { rmSync(p, { force: true }); } catch {}
        }
    }

    // Étape 1 : Garantir la présence de _app.asar original
    const hasOriginal = ensureOriginalAsar(resourcesDir);
    if (!hasOriginal) {
        console.error(`\x1b[31m[Nightcord] Impossible de localiser l'archive originale Discord pour ${resourcesDir} !\x1b[0m`);
        return false;
    }

    // Nettoyer l'ancien dossier app/
    if (existsSync(appDirPath)) {
        try {
            rmSync(appDirPath, { recursive: true, force: true });
        } catch (e) {
            console.error(`\x1b[31m[Nightcord] Impossible de supprimer app/ : ${e.message}\x1b[0m`);
        }
    }

    // Récupérer le nom de package Discord
    let appPkgName = "discord";
    try {
        const lowerRes = resourcesDir.toLowerCase();
        if (lowerRes.includes("canary")) appPkgName = "discordcanary";
        else if (lowerRes.includes("ptb")) appPkgName = "discordptb";
        else if (lowerRes.includes("development")) appPkgName = "discorddevelopment";
    } catch {}

    const patcherPath = join(DIST_DIR, "patcher.js");

    // Étape 2 : Écrire le loader binaire app.asar
    const asarBuffer = createAppAsarBuffer(patcherPath, appPkgName);
    writeFileSync(appAsarPath, asarBuffer);

    console.log(`\x1b[32m[Nightcord] Injecté avec succès dans : ${resourcesDir}\x1b[0m`);
    return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────
checkBuild();

const allResources = findAllDiscordResources();
if (allResources.length === 0) {
    console.error("\x1b[31m[Nightcord] Aucune installation Discord trouvée !\x1b[0m");
    process.exit(1);
}

console.log(`[Nightcord] ${allResources.length} installation(s) Discord trouvée(s) :`);
let injectedCount = 0;
for (const res of allResources) {
    console.log(`\n  → ${res}`);
    if (inject(res)) injectedCount++;
}
console.log(`\n\x1b[32m[Nightcord] ${injectedCount}/${allResources.length} injection(s) réussie(s).\x1b[0m`);
console.log("\x1b[36m[Nightcord] Lancez Discord pour démarrer Nightcord.\x1b[0m");
