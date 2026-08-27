/*
 * Nightcord — Local injector for Discord Desktop
 * Injecte Nightcord dans une installation Discord existante :
 * 1. Trouve le répertoire resources de Discord
 * 2. Déplace app.asar → _app.asar (pour que Electron charge le dossier app/)
 * 3. Crée le dossier app/ avec package.json et index.js qui charge patcher.js
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./checkNodeVersion.js";

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const BASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(BASE_DIR, "dist", "desktop");

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

    // Étape 1 : Si app.asar est présent, on le déplace vers _app.asar
    if (existsSync(appAsarPath)) {
        let isDir = false;
        try { isDir = statSync(appAsarPath).isDirectory(); } catch { }
        if (isDir) {
            try { rmSync(appAsarPath, { recursive: true, force: true }); } catch { }
        } else if (!existsSync(backupPath)) {
            console.log("[Nightcord] Déplacement app.asar → _app.asar...");
            try {
                renameSync(appAsarPath, backupPath);
            } catch {
                try {
                    copyFileSync(appAsarPath, backupPath);
                    try { rmSync(appAsarPath, { force: true }); } catch {}
                } catch (e) {
                    console.warn(`[Nightcord] Erreur de copie app.asar : ${e.message}`);
                }
            }
        } else {
            // _app.asar existe déjà comme backup valide
            try { rmSync(appAsarPath, { force: true }); } catch {}
        }
    }

    // Vérifier l'existence de _app.asar
    if (!existsSync(backupPath)) {
        console.error("\x1b[31m[Nightcord] Aucun app.asar ou _app.asar trouvé dans resources !\x1b[0m");
        return false;
    }

    // Nettoyer l'ancien dossier app/ s'il existe
    if (existsSync(appDirPath)) {
        try {
            rmSync(appDirPath, { recursive: true, force: true });
        } catch (e) {
            console.error(`\x1b[31m[Nightcord] Impossible de supprimer l'ancien app/ : ${e.message}\x1b[0m`);
        }
    }

    // Étape 2 : Créer le dossier app/ avec le loader Nightcord
    mkdirSync(appDirPath, { recursive: true });

    // Récupérer le nom de package Discord approprié (discord, discordcanary, discordptb)
    let appPkgName = "discord";
    try {
        const lowerRes = resourcesDir.toLowerCase();
        if (lowerRes.includes("canary")) appPkgName = "discordcanary";
        else if (lowerRes.includes("ptb")) appPkgName = "discordptb";
        else if (lowerRes.includes("development")) appPkgName = "discorddevelopment";
    } catch {}

    writeFileSync(join(appDirPath, "package.json"), JSON.stringify({
        name: appPkgName,
        main: "index.js"
    }, null, 2));

    const patcherPath = join(DIST_DIR, "patcher.js").replace(/\\/g, "\\\\");
    writeFileSync(join(appDirPath, "index.js"),
        `// Nightcord Injector — auto-generated, do not edit\n"use strict";\nrequire("${patcherPath}");\n`
    );

    console.log(`\x1b[32m[Nightcord] Injecté avec succès dans : ${resourcesDir}\x1b[0m`);
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
