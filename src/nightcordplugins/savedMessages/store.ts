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

const DATASTORE_KEY = "nightcord_saved_messages_vault_v1";

export interface SavedAttachment {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    dataUrl?: string;
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

let savedMessagesCache: SavedMessage[] = [];
let isLoaded = false;

// High-speed Blob URL cache for instant image/video loading
const mediaBlobUrlCache = new Map<string, string>();

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

export async function checkVaultStatus(): Promise<{ isPasswordSet: boolean; isUnlocked: boolean }> {
    if (!isLoaded) {
        await loadSavedMessages();
    }
    return { isPasswordSet: false, isUnlocked: true };
}

export function getSavedMessages(): SavedMessage[] {
    return [...savedMessagesCache];
}

export function getDecryptedMessages(): SavedMessage[] {
    return [...savedMessagesCache];
}

// ─── Media & Blob URL Helpers (Instant GPU-accelerated rendering) ───────────

function base64ToBlob(b64Data: string, contentType = "application/octet-stream"): Blob {
    let cleanB64 = b64Data;
    const commaIdx = cleanB64.indexOf(",");
    if (commaIdx !== -1) cleanB64 = cleanB64.slice(commaIdx + 1);

    const sliceSize = 512;
    const byteCharacters = atob(cleanB64);
    const byteArrays: Uint8Array[] = [];

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers));
    }

    return new Blob(byteArrays as any, { type: contentType });
}

export function getAttachmentUrl(att: SavedAttachment): string {
    if (!att) return "";

    if (att.mediaId && mediaBlobUrlCache.has(att.mediaId)) {
        return mediaBlobUrlCache.get(att.mediaId)!;
    }

    if (att.dataUrl) {
        if (att.dataUrl.startsWith("blob:")) return att.dataUrl;
        if (att.dataUrl.startsWith("data:")) {
            try {
                const blob = base64ToBlob(att.dataUrl, att.contentType);
                const url = URL.createObjectURL(blob);
                if (att.mediaId) mediaBlobUrlCache.set(att.mediaId, url);
                return url;
            } catch {
                return att.dataUrl;
            }
        }
    }

    // If not yet cached, trigger async background load from native storage
    if (att.mediaId && Native?.readMediaFile) {
        Native.readMediaFile(att.mediaId).then(b64 => {
            if (b64) {
                try {
                    const blob = base64ToBlob(b64, att.contentType);
                    const url = URL.createObjectURL(blob);
                    mediaBlobUrlCache.set(att.mediaId, url);
                    notifyStoreChange();
                } catch { }
            }
        }).catch(() => { });
    }

    return att.dataUrl || "";
}

export async function preloadMediaAttachments(messages: SavedMessage[]): Promise<void> {
    if (!Array.isArray(messages)) return;

    const loadTasks: Promise<void>[] = [];

    for (const msg of messages) {
        for (const att of msg.attachments || []) {
            if (!att.mediaId) continue;
            if (mediaBlobUrlCache.has(att.mediaId)) continue;

            if (att.dataUrl && att.dataUrl.startsWith("data:")) {
                try {
                    const blob = base64ToBlob(att.dataUrl, att.contentType);
                    const url = URL.createObjectURL(blob);
                    mediaBlobUrlCache.set(att.mediaId, url);
                    continue;
                } catch { }
            }

            if (Native?.readMediaFile) {
                const task = Native.readMediaFile(att.mediaId).then(b64 => {
                    if (b64) {
                        try {
                            const blob = base64ToBlob(b64, att.contentType);
                            const url = URL.createObjectURL(blob);
                            mediaBlobUrlCache.set(att.mediaId, url);
                        } catch { }
                    }
                }).catch(() => { });
                loadTasks.push(task);
            }
        }
    }

    if (loadTasks.length > 0) {
        await Promise.allSettled(loadTasks);
        notifyStoreChange();
    }
}

// ─── Direct Local Storage ───────────────────────────────────────────────────

export async function loadSavedMessages(): Promise<SavedMessage[]> {
    try {
        if (Native?.readVaultFile) {
            const diskContent = await Native.readVaultFile();
            if (diskContent) {
                try {
                    const parsed = JSON.parse(diskContent);
                    if (Array.isArray(parsed?.messages)) {
                        savedMessagesCache = parsed.messages;
                        isLoaded = true;
                        preloadMediaAttachments(savedMessagesCache).catch(() => { });
                        notifyStoreChange();
                        return [...savedMessagesCache];
                    } else if (Array.isArray(parsed)) {
                        savedMessagesCache = parsed;
                        isLoaded = true;
                        preloadMediaAttachments(savedMessagesCache).catch(() => { });
                        notifyStoreChange();
                        return [...savedMessagesCache];
                    }
                } catch { }
            }
        }
    } catch { }

    try {
        const dsContent = await DataStore.get<any>(DATASTORE_KEY);
        if (dsContent) {
            if (Array.isArray(dsContent?.messages)) {
                savedMessagesCache = dsContent.messages;
            } else if (Array.isArray(dsContent)) {
                savedMessagesCache = dsContent;
            }
        }
    } catch { }

    isLoaded = true;
    preloadMediaAttachments(savedMessagesCache).catch(() => { });
    notifyStoreChange();
    return [...savedMessagesCache];
}

async function persistCurrentMessages(): Promise<void> {
    const sanitizedMessages: SavedMessage[] = savedMessagesCache.map(msg => ({
        ...msg,
        attachments: (msg.attachments || []).map(att => ({
            id: att.id,
            filename: att.filename,
            contentType: att.contentType,
            size: att.size,
            mediaId: att.mediaId,
            width: att.width,
            height: att.height,
            isImage: att.isImage,
            isVideo: att.isVideo,
            isAudio: att.isAudio
        }))
    }));

    const payload: SavedMessagesPayload = {
        version: 1,
        messages: sanitizedMessages,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

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
            const mediaId = `media_${Date.now()}_${generateSnowflake()}_${filename}`;

            // Save media file to dedicated disk directory
            try {
                if (Native?.saveMediaFile) {
                    await Native.saveMediaFile(mediaId, b64);
                }
            } catch { }

            // Create instantaneous native Blob URL in memory
            let blobUrl = "";
            try {
                const blob = base64ToBlob(b64, contentType);
                blobUrl = URL.createObjectURL(blob);
                mediaBlobUrlCache.set(mediaId, blobUrl);
            } catch { }

            const isImage = contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(filename);
            const isVideo = contentType.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(filename);
            const isAudio = contentType.startsWith("audio/") || /\.(mp3|ogg|wav|m4a|flac|aac)$/i.test(filename);

            savedAttachments.push({
                id: generateSnowflake(),
                filename,
                contentType,
                size,
                dataUrl: blobUrl,
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

    savedMessagesCache.unshift(savedMsg);
    await persistCurrentMessages();
    notifyStoreChange();

    return savedMsg;
}

export async function deleteSavedMessage(messageId: string): Promise<void> {
    if (!isLoaded) {
        await loadSavedMessages();
    }

    const target = savedMessagesCache.find(m => m.id === messageId);
    if (target?.attachments?.length) {
        for (const att of target.attachments) {
            try {
                if (att.mediaId && mediaBlobUrlCache.has(att.mediaId)) {
                    try { URL.revokeObjectURL(mediaBlobUrlCache.get(att.mediaId)!); } catch { }
                    mediaBlobUrlCache.delete(att.mediaId);
                }
                if (Native?.deleteMediaFile && att.mediaId) {
                    await Native.deleteMediaFile(att.mediaId);
                }
            } catch { }
        }
    }

    savedMessagesCache = savedMessagesCache.filter(m => m.id !== messageId);
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
    for (const msg of savedMessagesCache) {
        for (const att of msg.attachments || []) {
            try {
                if (att.mediaId && mediaBlobUrlCache.has(att.mediaId)) {
                    try { URL.revokeObjectURL(mediaBlobUrlCache.get(att.mediaId)!); } catch { }
                    mediaBlobUrlCache.delete(att.mediaId);
                }
                if (Native?.deleteMediaFile && att.mediaId) {
                    await Native.deleteMediaFile(att.mediaId);
                }
            } catch { }
        }
    }

    savedMessagesCache = [];
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
