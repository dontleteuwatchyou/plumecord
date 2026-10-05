/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { PluginNative } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

export const SAVED_MESSAGES_CHANNEL_ID = "888888888888888888";
export const SAVED_MESSAGES_USER_ID = "888888888888888880";

const DATASTORE_KEY = "nightcord_saved_messages_data_v1";

export interface SavedAttachment {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    dataUrl: string;
    mediaId: string;
    width?: number;
    height?: number;
    isImage: boolean;
    isVideo: boolean;
    isAudio: boolean;
}

export interface SavedMessage {
    id: string;
    channel_id: string;
    content: string;
    timestamp: string;
    author: {
        id: string;
        username: string;
        discriminator: string;
        global_name: string;
        avatar: string;
        bot: boolean;
        system: boolean;
    };
    attachments: SavedAttachment[];
    embeds: any[];
    flags: number;
    isBot: boolean;
}

export interface SavedMessagesPayload {
    version: 1;
    messages: SavedMessage[];
    createdAt: number;
    updatedAt: number;
}

export const Native = (window as any).VencordNative?.pluginHelpers?.SavedMessages as PluginNative<typeof import("./native")> | undefined;

let messagesCache: SavedMessage[] = [];
let isLoaded = false;

export const storeListeners = new Set<() => void>();
export function notifyStoreChange() {
    storeListeners.forEach(fn => { try { fn(); } catch { } });
}

export function isVaultUnlocked(): boolean {
    return true;
}

export function isVaultPasswordSet(): boolean {
    return false;
}

export function getDecryptedMessages(): SavedMessage[] {
    return [...messagesCache];
}

export function getSavedMessages(): SavedMessage[] {
    return [...messagesCache];
}

async function readRawPayload(): Promise<SavedMessagesPayload | null> {
    try {
        if (Native?.readVaultFile) {
            const diskContent = await Native.readVaultFile();
            if (diskContent) {
                try {
                    const parsed = JSON.parse(diskContent);
                    if (Array.isArray(parsed?.messages)) return parsed as SavedMessagesPayload;
                    if (Array.isArray(parsed)) {
                        return { version: 1, messages: parsed, createdAt: Date.now(), updatedAt: Date.now() };
                    }
                } catch { }
            }
        }
    } catch { }

    try {
        const dsContent = await DataStore.get<SavedMessagesPayload>(DATASTORE_KEY);
        if (Array.isArray(dsContent?.messages)) return dsContent;
    } catch { }

    return null;
}

async function writeRawPayload(payload: SavedMessagesPayload): Promise<void> {
    const jsonStr = JSON.stringify(payload, null, 2);
    try {
        if (Native?.writeVaultFile) {
            await Native.writeVaultFile(jsonStr);
        }
    } catch { }

    try {
        await DataStore.set(DATASTORE_KEY, payload);
    } catch { }
}

export async function checkVaultStatus(): Promise<{ isPasswordSet: boolean; isUnlocked: boolean }> {
    if (!isLoaded) {
        await loadSavedMessages();
    }
    return { isPasswordSet: false, isUnlocked: true };
}

export async function loadSavedMessages(): Promise<SavedMessage[]> {
    const payload = await readRawPayload();
    if (payload && Array.isArray(payload.messages)) {
        messagesCache = payload.messages;
    } else {
        messagesCache = [];
    }
    isLoaded = true;
    notifyStoreChange();
    return [...messagesCache];
}

export function lockVault(): void {
    // No-op without encryption
}

export async function unlockVault(): Promise<boolean> {
    return true;
}

async function persistCurrentMessages(): Promise<void> {
    const payload: SavedMessagesPayload = {
        version: 1,
        messages: messagesCache,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    await writeRawPayload(payload);
}

function fileToBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = reader.result as string;
            const commaIdx = res.indexOf(",");
            resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function generateSnowflake(): string {
    const epoch = 1420070400000;
    const time = BigInt(Date.now() - epoch) << 22n;
    const rand = BigInt(Math.floor(Math.random() * 4194304));
    return (time | rand).toString();
}

export async function addSavedMessage(content: string, files: (File | Blob | any)[] = []): Promise<SavedMessage> {
    if (!isLoaded) {
        await loadSavedMessages();
    }

    const savedAttachments: SavedAttachment[] = [];
    for (const f of files) {
        try {
            const actualFile: File | Blob = f.file || f.item?.file || f;
            const filename = (f.name || f.filename || (actualFile as File)?.name || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
            const contentType = (actualFile as File)?.type || f.contentType || f.content_type || "application/octet-stream";
            const size = actualFile?.size || f.size || 0;

            const b64 = await fileToBase64(actualFile);
            const mediaId = `${Date.now()}_${filename}`;

            try {
                if (Native?.saveMediaFile) {
                    await Native.saveMediaFile(mediaId, b64);
                }
            } catch { }

            const isImage = contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(filename);
            const isVideo = contentType.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(filename);
            const isAudio = contentType.startsWith("audio/") || /\.(mp3|ogg|wav|m4a|flac|aac)$/i.test(filename);

            const dataUrl = `data:${contentType};base64,${b64}`;

            savedAttachments.push({
                id: generateSnowflake(),
                filename,
                contentType,
                size,
                dataUrl,
                mediaId,
                isImage,
                isVideo,
                isAudio
            });
        } catch (err) {
            console.error("[SavedMessages] Failed to process attachment:", err);
        }
    }

    const msgId = generateSnowflake();
    const timestamp = new Date().toISOString();

    const savedMsg: SavedMessage = {
        id: msgId,
        channel_id: SAVED_MESSAGES_CHANNEL_ID,
        content: content || "",
        timestamp,
        author: {
            id: SAVED_MESSAGES_USER_ID,
            username: "SavedMessages",
            discriminator: "0",
            global_name: "Saved Messages",
            avatar: "saved_messages_bot",
            bot: true,
            system: true
        },
        attachments: savedAttachments,
        embeds: [],
        flags: 0,
        isBot: true
    };

    messagesCache.unshift(savedMsg);
    await persistCurrentMessages();
    notifyStoreChange();

    return savedMsg;
}

export async function deleteSavedMessage(messageId: string): Promise<void> {
    if (!isLoaded) {
        await loadSavedMessages();
    }

    const target = messagesCache.find(m => m.id === messageId);
    if (target?.attachments?.length) {
        for (const att of target.attachments) {
            try {
                if (Native?.deleteMediaFile && att.mediaId) {
                    await Native.deleteMediaFile(att.mediaId);
                }
            } catch { }
        }
    }

    messagesCache = messagesCache.filter(m => m.id !== messageId);
    await persistCurrentMessages();
    notifyStoreChange();

    try {
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId: SAVED_MESSAGES_CHANNEL_ID,
            id: messageId,
        });
    } catch { }
}

export async function clearAllSavedMessages(): Promise<void> {
    if (!isLoaded) {
        await loadSavedMessages();
    }

    for (const msg of messagesCache) {
        for (const att of msg.attachments || []) {
            try {
                if (Native?.deleteMediaFile && att.mediaId) {
                    await Native.deleteMediaFile(att.mediaId);
                }
            } catch { }
        }
    }

    messagesCache = [];
    await persistCurrentMessages();
    notifyStoreChange();

    try {
        FluxDispatcher.dispatch({
            type: "LOAD_MESSAGES_SUCCESS",
            channelId: SAVED_MESSAGES_CHANNEL_ID,
            messages: [],
            isBefore: false,
            isAfter: false,
            hasMoreBefore: false,
            hasMoreAfter: false,
            limit: 50,
        });
    } catch { }
}
