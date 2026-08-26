/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, dialog, IpcMainInvokeEvent, shell } from "electron";
import { mkdir, writeFile, unlink, stat } from "node:fs/promises";
import * as path from "node:path";

function sanitizeName(name: string): string {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim().slice(0, 100) || "unnamed";
}

export async function getDefaultSaveDirectory(_event: IpcMainInvokeEvent): Promise<string> {
    try {
        const docs = app.getPath("documents") || app.getPath("userData");
        const defaultPath = path.join(docs, "Nightcord_SnipeAttachments");
        await mkdir(defaultPath, { recursive: true });
        return defaultPath;
    } catch {
        return path.join(process.cwd(), "Nightcord_SnipeAttachments");
    }
}

export async function selectSaveDirectory(_event: IpcMainInvokeEvent): Promise<string | null> {
    const res = await dialog.showOpenDialog({
        title: "Select SnipeAttachments Save Folder",
        properties: ["openDirectory", "createDirectory"]
    });

    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
}

export async function openInFolder(_event: IpcMainInvokeEvent, targetPath: string): Promise<void> {
    if (targetPath) {
        shell.showItemInFolder(targetPath);
    }
}

export async function openFolder(_event: IpcMainInvokeEvent, dirPath: string): Promise<void> {
    if (dirPath) {
        shell.openPath(dirPath);
    }
}

export async function saveAttachmentFile(
    _event: IpcMainInvokeEvent,
    data: {
        buffer: ArrayBuffer | Uint8Array;
        filename: string;
        guildName?: string;
        channelName?: string;
        authorName?: string;
        customDir?: string;
    }
): Promise<string> {
    let baseDir = data.customDir?.trim();
    if (!baseDir) {
        const docs = app.getPath("documents") || app.getPath("userData");
        baseDir = path.join(docs, "Nightcord_SnipeAttachments");
    }

    const guildFolder = sanitizeName(data.guildName || "DirectMessages");
    const channelFolder = sanitizeName(data.channelName || "General");
    const targetDir = path.join(baseDir, guildFolder, channelFolder);

    await mkdir(targetDir, { recursive: true });

    const cleanFilename = sanitizeName(data.filename || "file");
    const datePrefix = new Date().toISOString().slice(0, 10);
    const authorPrefix = sanitizeName(data.authorName || "User");
    const finalFilename = `${datePrefix}_${authorPrefix}_${cleanFilename}`;
    const fullPath = path.join(targetDir, finalFilename);

    const buf = data.buffer instanceof Uint8Array ? data.buffer : Buffer.from(data.buffer);
    await writeFile(fullPath, buf);

    return fullPath;
}

export async function deleteSavedFile(_event: IpcMainInvokeEvent, targetPath: string): Promise<boolean> {
    try {
        await unlink(targetPath);
        return true;
    } catch {
        return false;
    }
}
