/*
 * Nightcord — Local injector for Discord Desktop (Equilotl Architecture)
 * Injecte Nightcord dans une installation Discord existante :
 * 1. Trouve le répertoire resources de Discord
 * 2. Déplace l'original app.asar → _app.asar
 * 3. Génère un app.asar binaire valide (format Equilotl) chargeant patcher.js
 * 4. Crée également le dossier app/ pour une compatibilité totale 100%
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./checkNodeVersion.js";

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const BASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(BASE_DIR, "dist", "desktop");

/**
 * Génère un binaire app.asar minimaliste et conforme au standard ASAR d'Electron / Equilotl
 * Contient index.js (require du patcher Nightcord) et package.json
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

    return candidates.filter(p => {
        if (!existsSync(p)) return false;
        return existsSync(join(p, "app.asar")) || existsSync(join(p, "app")) || existsSync(join(p, "_app.asar"));
    });
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
    const backupPath = join(resourcesDir, "_app.asar");
    const appDirPath = join(resourcesDir, "app");

    // Nettoyer les fichiers de mods tiers
    for (const modAsar of ["vencord.asar", "equicord.asar", "betterdiscord.asar"]) {
        const p = join(resourcesDir, modAsar);
        if (existsSync(p)) {
            try { rmSync(p, { force: true }); } catch {}
        }
    }

    // Étape 1 : Si app.asar est présent (et n'est pas un loader asar), on le déplace vers _app.asar
    if (existsSync(appAsarPath)) {
        let isDir = false;
        let isLoader = false;
        try {
            const st = statSync(appAsarPath);
            isDir = st.isDirectory();
            if (!isDir && st.size < 131072) {
                // Moins de 128KB = loader existant
                isLoader = true;
            }
        } catch { }

        if (isDir) {
            try { rmSync(appAsarPath, { recursive: true, force: true }); } catch { }
        } else if (!isLoader) {
            console.log("[Nightcord] Sauvegarde de l'original : app.asar → _app.asar...");
            try {
                if (existsSync(backupPath)) try { rmSync(backupPath, { force: true }); } catch {}
                renameSync(appAsarPath, backupPath);
            } catch {
                try {
                    copyFileSync(appAsarPath, backupPath);
                    try { rmSync(appAsarPath, { force: true }); } catch {}
                } catch (e) {
                    console.warn(`[Nightcord] Erreur de copie app.asar : ${e.message}`);
                }
            }
        }
    }

    // Vérifier l'existence de _app.asar
    if (!existsSync(backupPath)) {
        console.error("\x1b[31m[Nightcord] Aucun _app.asar original trouvé dans resources !\x1b[0m");
        return false;
    }

    // Nettoyer l'ancien dossier app/
    if (existsSync(appDirPath)) {
        try {
            rmSync(appDirPath, { recursive: true, force: true });
        } catch (e) {
            console.error(`\x1b[31m[Nightcord] Impossible de supprimer l'ancien app/ : ${e.message}\x1b[0m`);
        }
    }

    // Récupérer le nom de package Discord approprié (discord, discordcanary, discordptb)
    let appPkgName = "discord";
    try {
        const lowerRes = resourcesDir.toLowerCase();
        if (lowerRes.includes("canary")) appPkgName = "discordcanary";
        else if (lowerRes.includes("ptb")) appPkgName = "discordptb";
        else if (lowerRes.includes("development")) appPkgName = "discorddevelopment";
    } catch {}

    const patcherPath = join(DIST_DIR, "patcher.js");

    // Étape 2 : Écrire le vrai fichier binaire app.asar (Format Equilotl)
    const asarBuffer = createAppAsarBuffer(patcherPath, appPkgName);
    writeFileSync(appAsarPath, asarBuffer);

    // Étape 3 : Créer également le dossier app/ en secours
    mkdirSync(appDirPath, { recursive: true });
    writeFileSync(join(appDirPath, "package.json"), JSON.stringify({
        name: appPkgName,
        main: "index.js"
    }, null, 2));
    writeFileSync(join(appDirPath, "index.js"),
        `// Nightcord Injector\n"use strict";\nrequire("${patcherPath.replace(/\\/g, "\\\\")}");\n`
    );

    console.log(`\x1b[32m[Nightcord] Injecté avec succès (ASAR + App Loader) dans : ${resourcesDir}\x1b[0m`);
    return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────
checkBuild();

const allResources = findAllDiscordResources();
if (allResources.length === 0) {
    console.error("\x1b[31m[Nightcord] Aucune installation Discord trouvée !\x1b[0m");
    console.error("\x1b[33m           Assurez-vous que Discord (Stable, PTB ou Canary) est installé.\x1b[0m");
    process.exit(1);
}

console.log(`[Nightcord] ${allResources.length} installation(s) Discord trouvée(s) :`);
let injectedCount = 0;
for (const res of allResources) {
    console.log(`\n  → ${res}`);
    if (inject(res)) injectedCount++;
}
console.log(`\n\x1b[32m[Nightcord] ${injectedCount}/${allResources.length} injection(s) réussie(s).\x1b[0m`);
console.log("\x1b[36m[Nightcord] Redémarrez Discord pour lancer Nightcord.\x1b[0m");
