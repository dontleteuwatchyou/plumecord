/*
 * Nightcord — Local un-injector for Discord Desktop
 * Annule l'injection de manière propre et non-destructive en :
 * 1. Supprimant le dossier app/ créé par inject.mjs
 * 2. Restaurant _app.asar → app.asar si nécessaire
 *
 * Usage: pnpm uninject   (ou: node scripts/uninject.mjs)
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./checkNodeVersion.js";

import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "fs";
import { join } from "path";

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
            "/opt/Discord/resources"
        );
    }

    return candidates.filter(p => {
        if (!existsSync(p)) return false;
        return existsSync(join(p, "app")) || existsSync(join(p, "_app.asar"));
    });
}

// ── Uninject ─────────────────────────────────────────────────────────────────
function uninject(resourcesDir) {
    const appDirPath = join(resourcesDir, "app");
    const backupPath = join(resourcesDir, "_app.asar");
    const appAsarPath = join(resourcesDir, "app.asar");

    // Supprimer le dossier app/
    if (existsSync(appDirPath)) {
        try {
            rmSync(appDirPath, { recursive: true, force: true });
            console.log(`[Nightcord] Dossier app/ supprimé avec succès dans : ${resourcesDir}`);
        } catch (e) {
            console.warn(`[Nightcord] Erreur lors de la suppression de app/ : ${e.message}`);
        }
    }

    // Restaurer le backup si app.asar était manquant
    if (existsSync(backupPath)) {
        if (!existsSync(appAsarPath)) {
            console.log("[Nightcord] Restauration _app.asar → app.asar...");
            try { renameSync(backupPath, appAsarPath); } catch {}
        } else {
            try { rmSync(backupPath, { force: true }); } catch {}
        }
    }

    console.log(`\x1b[32m[Nightcord] Désinjection réussie depuis : ${resourcesDir}\x1b[0m`);
    return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const allResources = findAllDiscordResources();

if (allResources.length === 0) {
    console.log("\x1b[33m[Nightcord] Aucune injection Nightcord active à désinjecter.\x1b[0m");
    process.exit(0);
}

let uninjectCount = 0;
for (const res of allResources) {
    console.log(`\n[Nightcord] Traitement : ${res}`);
    if (uninject(res)) uninjectCount++;
}

console.log(`\n\x1b[32m[Nightcord] ${uninjectCount}/${allResources.length} installation(s) désinjectée(s) avec succès.\x1b[0m`);
console.log("\x1b[36m[Nightcord] Redémarrez Discord pour appliquer les changements.\x1b[0m");
