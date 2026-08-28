/*
 * Nightcord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "original-fs";
import { dirname, join } from "path";

declare const __filename: string;
const OUR_PATCHER_PATH = __filename;

function patchResourcesDir(resourcesDir: string) {
    try {
        const appDir = join(resourcesDir, "app");
        const appAsar = join(resourcesDir, "app.asar");
        const _appAsar = join(resourcesDir, "_app.asar");

        // If _app.asar exists from previous legacy injections, restore it to app.asar
        if (existsSync(_appAsar)) {
            if (!existsSync(appAsar)) {
                try { renameSync(_appAsar, appAsar); } catch {}
            } else {
                try { rmSync(_appAsar, { force: true }); } catch {}
            }
        }

        // If app.asar is a directory (from old buggy patcher), clean it up
        if (existsSync(appAsar)) {
            try {
                if (statSync(appAsar).isDirectory()) {
                    rmSync(appAsar, { recursive: true, force: true });
                }
            } catch {}
        }

        if (!existsSync(appAsar)) {
            // Incomplete Discord update download
            return;
        }

        // Check if already patched cleanly with app/index.js pointing to Nightcord
        const loaderIndex = join(appDir, "index.js");
        if (existsSync(loaderIndex)) {
            try {
                const content = readFileSync(loaderIndex, "utf-8");
                if (content.includes("Nightcord")) return; // Already patched
            } catch {}
        }

        console.info(`[Nightcord] Auto-injecting into ${resourcesDir}...`);

        if (existsSync(appDir)) {
            try { rmSync(appDir, { recursive: true, force: true }); } catch {}
        }
        mkdirSync(appDir, { recursive: true });

        let appPkgName = "discord";
        try {
            const lowerRes = resourcesDir.toLowerCase();
            if (lowerRes.includes("canary")) appPkgName = "discordcanary";
            else if (lowerRes.includes("ptb")) appPkgName = "discordptb";
            else if (lowerRes.includes("development")) appPkgName = "discorddevelopment";
        } catch {}

        writeFileSync(join(appDir, "package.json"), JSON.stringify({
            name: appPkgName,
            main: "index.js"
        }, null, 2));

        const indexJs = [
            "// Nightcord Injector — auto-generated",
            "\"use strict\";",
            "const path = require(\"path\");",
            "const fs = require(\"fs\");",
            "try {",
            `    require(${JSON.stringify(OUR_PATCHER_PATH)});`,
            "} catch (e) {",
            "    console.error(\"[Nightcord] Injection failed, falling back to original app.asar:\", e);",
            "    const originalAsar = path.join(__dirname, \"..\", \"app.asar\");",
            "    if (fs.existsSync(originalAsar)) {",
            "        require(originalAsar);",
            "    }",
            "}",
            ""
        ].join("\n");

        writeFileSync(join(appDir, "index.js"), indexJs);
        console.info(`[Nightcord] Successfully injected into ${resourcesDir}`);
    } catch (err) {
        console.error(`[Nightcord] Failed to auto-inject into ${resourcesDir}:`, err);
    }
}

function patchCurrentDiscordOnly() {
    // Patche UNIQUEMENT la version de Discord qui tourne actuellement.
    // Ne pas toucher aux autres versions pour éviter de corrompre des sessions actives.
    // Les autres versions seront patchées au démarrage quand elles seront la version active.
    try {
        const currentResources = process.resourcesPath;
        if (currentResources && existsSync(currentResources)) {
            patchResourcesDir(currentResources);
        }
    } catch (e) {
        console.error("[Nightcord] patchCurrentDiscordOnly error:", e);
    }
}

// Patche uniquement la version active au démarrage
patchCurrentDiscordOnly();
