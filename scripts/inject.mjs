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

import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { recoverOriginalAsar } from "./recoverAsar.mjs";

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
        const home = process.env.HOME || "";
        const appBases = [
            "/Applications",
            join(home, "Applications")
        ];
        const appNames = [
            "Discord.app",
            "Discord PTB.app",
            "Discord Canary.app",
            "Discord Development.app"
        ];

        for (const base of appBases) {
            for (const app of appNames) {
                candidates.push(join(base, app, "Contents", "Resources"));
            }
        }
    } else if (platform === "linux") {
        const home = process.env.HOME || "";

        // Standard system / package manager paths
        const channels = ["discord", "discord-ptb", "discord-canary", "discord-development", "Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"];
        for (const prefix of ["/usr/share", "/usr/lib", "/usr/lib64", "/opt"]) {
            for (const ch of channels) {
                candidates.push(join(prefix, ch, "resources"));
            }
        }

        // User local paths
        for (const ch of channels) {
            candidates.push(join(home, ".local/share", ch, "resources"));
            candidates.push(join(home, ".local/bin", ch, "resources"));
        }

        // Flatpak paths
        const flatpakAppIds = [
            "com.discordapp.Discord",
            "com.discordapp.DiscordCanary",
            "com.discordapp.DiscordPTB",
            "com.discordapp.DiscordDevelopment"
        ];
        for (const appId of flatpakAppIds) {
            const discordFolder = appId.replace("com.discordapp.", "").toLowerCase();
            candidates.push(join(home, ".local/share/flatpak/app", appId, "current/active/files", discordFolder, "resources"));
            candidates.push(join(home, ".local/share/flatpak/app", appId, "current/active/files/share", discordFolder, "resources"));
            candidates.push(join("/var/lib/flatpak/app", appId, "current/active/files", discordFolder, "resources"));
            candidates.push(join("/var/lib/flatpak/app", appId, "current/active/files/share", discordFolder, "resources"));
            candidates.push(join(home, ".var/app", appId, "data", discordFolder, "resources"));
        }

        // Snap paths
        for (const ch of ["discord", "discord-canary", "discord-ptb"]) {
            candidates.push(join("/snap", ch, "current/usr/share", ch, "resources"));
            candidates.push(join("/snap", ch, "current/opt", ch, "resources"));
        }

        // Dynamic / app-X.Y.Z folders
        for (const base of ["/opt/discord", "/opt/Discord", join(home, ".local/share/discord"), join(home, ".dvm")]) {
            if (existsSync(base)) {
                try {
                    const entries = readdirSync(base);
                    for (const entry of entries) {
                        if (entry.startsWith("app-")) {
                            candidates.push(join(base, entry, "resources"));
                        }
                    }
                } catch { }
            }
        }
    }

    return [...new Set(candidates)].filter(p => existsSync(p));
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

    // Étape 1 : Garantir la présence de _app.asar original (> 1MB)
    const hasOriginal = recoverOriginalAsar(resourcesDir);
    if (!hasOriginal) {
        console.error(`\x1b[31m[Nightcord] Impossible de localiser ou d'extraire l'archive originale Discord pour ${resourcesDir} !\x1b[0m`);
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
