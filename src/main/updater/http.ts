/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { exec } from "child_process";
import { app, ipcMain } from "electron";
import { existsSync, mkdirSync, promises as fsp, readFileSync, rmSync, writeFileSync } from "original-fs";
import { join } from "path";
import { domain } from "../../../DOMAIN.json";
import { serializeErrors } from "./common";
import { copyDirectorySync } from "./pendingUpdate";

const GITEA_BASE = `https://source.${domain}`;
const API_BASE = `${GITEA_BASE}/api/v1/repos/nightcord/nightcord`;
const REPO_URL = `${GITEA_BASE}/nightcord/nightcord`;
declare const VERSION: string;
const CURRENT_VERSION = `v${VERSION}`;
const ZIP_FILE = "nightcord-dist.zip";

/**
 * Marker file written into __dirname when an update has been staged.
 * nightcord-index.js reads this on next startup (before any file is locked)
 * and performs the actual file-swap then.
 */
export const PENDING_UPDATE_MARKER = join(__dirname, "nightcord-pending-update.json");
const STAGING_DIR = join(app.getPath("temp"), "nightcord-pending-update");

let pendingDownloadUrl: string | null = null;
let pendingVersion: string | null = null;
let isApplying = false;

async function githubGet<T = any>(endpoint: string): Promise<T> {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/json",
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

function isNewer(a: string, b: string): boolean {
    const parse = (v: string) => v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
    const av = parse(a), bv = parse(b);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        if ((bv[i] ?? 0) > (av[i] ?? 0)) return true;
        if ((bv[i] ?? 0) < (av[i] ?? 0)) return false;
    }
    return false;
}

async function fetchUpdates(): Promise<boolean> {
    const data = await githubGet("/releases/latest");
    const latestTag: string = data.tag_name ?? "";

    if (!latestTag || !isNewer(CURRENT_VERSION, latestTag)) return false;

    const asset = (data.assets as any[])?.find(
        (a: any) => a.name === ZIP_FILE
    );
    if (!asset) return false;

    pendingDownloadUrl = asset.browser_download_url;
    pendingVersion = latestTag;
    return true;
}

async function getUpdates() {
    const outdated = await fetchUpdates();
    if (!outdated) return [];
    return [{
        hash: pendingVersion ?? "new",
        author: "Nightcord",
        message: `Nouvelle version disponible : ${pendingVersion}`
    }];
}

/**
 * Step 1 — download the zip and stage it to a temp folder.
 * Does NOT touch any running files. Returns true when the zip is staged.
 */
async function stageUpdate(): Promise<boolean> {
    // If update is already staged for this version on disk, skip redundant download
    if (existsSync(PENDING_UPDATE_MARKER)) {
        try {
            const marker = JSON.parse(readFileSync(PENDING_UPDATE_MARKER, "utf-8"));
            if (marker.stagingDir && existsSync(marker.stagingDir)) {
                if (!pendingVersion || marker.version === pendingVersion) {
                    console.log(`[NightcordUpdater] Update ${marker.version} is already staged on disk. Skipping download.`);
                    pendingDownloadUrl = null;
                    pendingVersion = null;
                    return true;
                }
            }
        } catch { }
    }

    if (!pendingDownloadUrl) return false;
    if (isApplying) return false;
    isApplying = true;

    try {
        const data = await fetchBuffer(pendingDownloadUrl);

        // Save zip to temp
        const zipPath = join(app.getPath("temp"), `nightcord-update-${Date.now()}.zip`);
        await fsp.writeFile(zipPath, data);

        // Clean any stale staging dir first
        try { rmSync(STAGING_DIR, { recursive: true, force: true }); } catch { }
        mkdirSync(STAGING_DIR, { recursive: true });

        return await new Promise<boolean>((resolve, reject) => {
            const extractCmd = process.platform === "win32"
                ? `powershell -NoProfile -NonInteractive -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${STAGING_DIR}' -Force"`
                : `unzip -o -q "${zipPath}" -d "${STAGING_DIR}"`;

            exec(extractCmd, async err => {
                // Cleanup zip regardless
                try { rmSync(zipPath, { force: true }); } catch { }

                if (err) {
                    return reject(new Error("ZIP extraction failed: " + err.message));
                }

                // Attempt immediate copy for non-locked files (renderer, css, preload)
                copyDirectorySync(STAGING_DIR, __dirname);

                // Write marker so patcher.ts double-checks and finalizes on next boot
                try {
                    await fsp.writeFile(PENDING_UPDATE_MARKER, JSON.stringify({
                        version: pendingVersion,
                        stagingDir: STAGING_DIR,
                        destDir: __dirname,
                        createdAt: Date.now()
                    }));
                } catch (markerErr) {
                    return reject(markerErr);
                }

                pendingDownloadUrl = null;
                pendingVersion = null;
                resolve(true);
            });
        });
    } finally {
        isApplying = false;
    }
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => REPO_URL));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(getUpdates));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
// BUILD is now "stage update" — actual file swap happens on next startup via nightcord-index.js
ipcMain.handle(IpcEvents.BUILD, serializeErrors(stageUpdate));
