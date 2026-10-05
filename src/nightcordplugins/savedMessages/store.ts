/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { PluginNative } from "@utils/types";
import { FluxDispatcher, UserStore } from "@webpack/common";

import { decryptData, EncryptedEnvelope, encryptData } from "./crypto";

export const SAVED_MESSAGES_CHANNEL_ID = "888888888888888888";
export const SAVED_MESSAGES_USER_ID = "888888888888888880";

const DATASTORE_KEY = "nightcord_saved_messages_vault_v1";

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

let sessionPassword: string | null = null;
let isUnlockedState = false;
let isPasswordSetState = false;
let decryptedMessagesCache: SavedMessage[] = [];

export const storeListeners = new Set<() => void>();
export function notifyStoreChange() {
    storeListeners.forEach(fn => { try { fn(); } catch { } });
}

export function isVaultUnlocked(): boolean {
    return isUnlockedState;
}

export function isVaultPasswordSet(): boolean {
    return isPasswordSetState;
}

export function getDecryptedMessages(): SavedMessage[] {
    return [...decryptedMessagesCache];
}

async function readRawEnvelope(): Promise<EncryptedEnvelope | null> {
    try {
        if (Native?.readVaultFile) {
            const diskContent = await Native.readVaultFile();
            if (diskContent) {
                const parsed = JSON.parse(diskContent) as EncryptedEnvelope;
                if (parsed?.version === 1 && parsed.ciphertext) return parsed;
            }
        }
    } catch { }

    try {
        const dsContent = await DataStore.get<EncryptedEnvelope>(DATASTORE_KEY);
        if (dsContent?.version === 1 && dsContent.ciphertext) return dsContent;
    } catch { }

    return null;
}

async function writeRawEnvelope(envelope: EncryptedEnvelope): Promise<void> {
    const jsonStr = JSON.stringify(envelope);
    try {
        if (Native?.writeVaultFile) {
            await Native.writeVaultFile(jsonStr);
        }
    } catch { }

    try {
        await DataStore.set(DATASTORE_KEY, envelope);
    } catch { }
}

export async function checkVaultStatus(): Promise<{ isPasswordSet: boolean; isUnlocked: boolean }> {
    const envelope = await readRawEnvelope();
    isPasswordSetState = Boolean(envelope);
    if (!isPasswordSetState) {
        isUnlockedState = false;
    }
    notifyStoreChange();
    return { isPasswordSet: isPasswordSetState, isUnlocked: isUnlockedState };
}

export async function unlockVault(password: string): Promise<boolean> {
    if (!password || !password.trim()) throw new Error("Password cannot be empty");

    const envelope = await readRawEnvelope();
    if (!envelope) {
        // First time initializing vault
        sessionPassword = password;
        isUnlockedState = true;
        isPasswordSetState = true;
        decryptedMessagesCache = [];

        const payload: SavedMessagesPayload = {
            version: 1,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        const newEnvelope = await encryptData(JSON.stringify(payload), password);
        await writeRawEnvelope(newEnvelope);
        notifyStoreChange();
        return true;
    }

    const decryptedStr = await decryptData(envelope, password);
    const payload = JSON.parse(decryptedStr) as SavedMessagesPayload;
    decryptedMessagesCache = Array.isArray(payload.messages) ? payload.messages : [];
    sessionPassword = password;
    isUnlockedState = true;
    isPasswordSetState = true;

    notifyStoreChange();
    return true;
}

export function lockVault(): void {
    sessionPassword = null;
    isUnlockedState = false;
    decryptedMessagesCache = [];

    // Clear messages from Discord Flux store
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

    notifyStoreChange();
}

async function persistCurrentMessages(): Promise<void> {
    if (!sessionPassword || !isUnlockedState) return;

    const payload: SavedMessagesPayload = {
        version: 1,
        messages: decryptedMessagesCache,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    const envelope = await encryptData(JSON.stringify(payload), sessionPassword);
    await writeRawEnvelope(envelope);
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
    if (!isUnlockedState || !sessionPassword) {
        throw new Error("Vault is locked. Please unlock first.");
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

    decryptedMessagesCache.unshift(savedMsg);
    await persistCurrentMessages();
    notifyStoreChange();

    return savedMsg;
}

export async function deleteSavedMessage(messageId: string): Promise<void> {
    if (!isUnlockedState || !sessionPassword) return;

    const target = decryptedMessagesCache.find(m => m.id === messageId);
    if (target?.attachments?.length) {
        for (const att of target.attachments) {
            try {
                if (Native?.deleteMediaFile && att.mediaId) {
                    await Native.deleteMediaFile(att.mediaId);
                }
            } catch { }
        }
    }

    decryptedMessagesCache = decryptedMessagesCache.filter(m => m.id !== messageId);
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
    if (!isUnlockedState || !sessionPassword) return;

    for (const msg of decryptedMessagesCache) {
        for (const att of msg.attachments || []) {
            try {
                if (Native?.deleteMediaFile && att.mediaId) {
                    await Native.deleteMediaFile(att.mediaId);
                }
            } catch { }
        }
    }

    decryptedMessagesCache = [];
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

export async function changeVaultPassword(oldPass: string, newPass: string): Promise<boolean> {
    if (!newPass || !newPass.trim()) throw new Error("New password cannot be empty");

    const envelope = await readRawEnvelope();
    if (!envelope) {
        return unlockVault(newPass);
    }

    const decryptedStr = await decryptData(envelope, oldPass);
    const payload = JSON.parse(decryptedStr) as SavedMessagesPayload;
    payload.updatedAt = Date.now();

    sessionPassword = newPass;
    const newEnvelope = await encryptData(JSON.stringify(payload), newPass);
    await writeRawEnvelope(newEnvelope);

    isUnlockedState = true;
    isPasswordSetState = true;
    notifyStoreChange();
    return true;
}
