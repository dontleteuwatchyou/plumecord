/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, MessageStore, SelectedChannelStore } from "@webpack/common";

import { Flogger, settings, recordDeleted, recordDeletedBulk } from ".";
import * as idb from "./db";
import { addMessage } from "./LoggedMessageManager";
import { LoggedMessage, LoggedMessageJSON } from "./types";
import { cleanUpCachedMessage, isGhostPinged, messageJsonToMessageClass } from "./utils";
import { shouldIgnore } from "./utils/index";
import { LimitedMap } from "./utils/LimitedMap";
import { getNative } from "./utils";

export const Native = getNative();
export const cacheSentMessages = new LimitedMap<string, LoggedMessageJSON>();
const handledMessageIds = new Set<string>();
let oldGetMessage: typeof MessageStore.getMessage;

export async function clearLogs(showToast = true) {
    await idb.clearMessagesIDB(showToast);
    cacheSentMessages.clear();
}

async function messageDeleteHandler(payload: any) {
    if (payload.mlDeleted) {
        if ((settings.store as any).permanentlyRemoveLogByDefault)
            await idb.deleteMessageIDB(payload.id);
        return;
    }

    if (handledMessageIds.has(payload.id)) return;

    try {
        handledMessageIds.add(payload.id);

        let message: LoggedMessage | LoggedMessageJSON | null = oldGetMessage?.(payload.channelId, payload.id) as any;
        if (message == null) {
            const cachedMessage = cacheSentMessages.get(`${payload.channelId},${payload.id}`);
            if (!cachedMessage) return;
            message = { ...cachedMessage, deleted: true } as LoggedMessageJSON;
        }

        const ghostPinged = isGhostPinged(message as any);

        if (shouldIgnore({
            channelId: message?.channel_id ?? payload.channelId,
            guildId: payload.guildId ?? (message as any).guildId ?? (message as any).guild_id,
            authorId: message?.author?.id,
            bot: (message as any).bot || message?.author?.bot,
            flags: message?.flags,
            ghostPinged,
            isCachedByUs: (message as LoggedMessageJSON).ourCache,
            webhookId: (message as any).webhookId,
            content: message?.content
        })) {
            return FluxDispatcher.dispatch({
                type: "MESSAGE_DELETE",
                channelId: payload.channelId,
                id: payload.id,
                mlDeleted: true
            });
        }

        if (message == null || message.channel_id == null || !(message as any).deleted) return;
        if (payload.isBulk) return message;

        const currentChannelId = SelectedChannelStore.getChannelId();
        await addMessage(message, ghostPinged ? idb.DBMessageStatus.GHOST_PINGED : idb.DBMessageStatus.DELETED, currentChannelId);
    } finally {
        handledMessageIds.delete(payload.id);
    }
}

async function messageDeleteBulkHandler({ channelId, guildId, ids }: { channelId: string; guildId?: string; ids: string[]; }) {
    if (!ids || ids.length === 0) return;
    const messages: LoggedMessageJSON[] = [];
    const bulkRecordItems: { id: string; channelId?: string; attachments?: any[]; }[] = [];

    for (const id of ids) {
        if (handledMessageIds.has(id)) continue;
        let message: LoggedMessage | LoggedMessageJSON | null = oldGetMessage?.(channelId, id) as any;
        if (message == null) {
            const cachedMessage = cacheSentMessages.get(`${channelId},${id}`);
            if (cachedMessage) {
                message = { ...cachedMessage, deleted: true } as LoggedMessageJSON;
            }
        }
        if (message) {
            bulkRecordItems.push({ id, channelId, attachments: message.attachments });
            messages.push({ ...message, deleted: true } as LoggedMessageJSON);
        }
    }

    if (bulkRecordItems.length > 0) {
        recordDeletedBulk(bulkRecordItems);
    }
    if (messages.length > 0) {
        await idb.addMessagesBulkIDB(messages);
    }
}

async function messageUpdateHandler(payload: any) {
    const cachedMessage = cacheSentMessages.get(`${payload.message.channel_id},${payload.message.id}`);

    if (shouldIgnore({
        channelId: payload.message?.channel_id,
        guildId: payload.guildId ?? payload?.guild_id,
        authorId: payload.message?.author?.id,
        bot: (payload.message?.author as any)?.bot,
        flags: payload.message?.flags,
        ghostPinged: isGhostPinged(payload.message as any),
        isCachedByUs: cachedMessage?.ourCache ?? false,
        content: payload.message?.content
    })) return;

    let message = oldGetMessage?.(payload.message.channel_id, payload.message.id) as LoggedMessage | LoggedMessageJSON | null;

    if (message == null) {
        if (cachedMessage != null && payload.message.content != null && cachedMessage.content !== payload.message.content) {
            message = {
                ...cachedMessage,
                content: payload.message.content,
                editHistory: [
                    ...(cachedMessage.editHistory ?? []),
                    {
                        content: cachedMessage.content,
                        timestamp: (new Date()).toISOString()
                    }
                ]
            };
            cacheSentMessages.set(`${payload.message.channel_id},${payload.message.id}`, message);
        }
    }

    if (message == null || message.channel_id == null || (message as LoggedMessageJSON).editHistory == null || (message as LoggedMessageJSON).editHistory!.length === 0) return;

    const currentChannelId = SelectedChannelStore.getChannelId();
    await addMessage(message, idb.DBMessageStatus.EDITED, currentChannelId);
}

function messageCreateHandler(payload: any) {
    cacheSentMessages.set(`${payload.message.channel_id},${payload.message.id}`, cleanUpCachedMessage(payload.message));
}

/**
 * Intercepts LOAD_MESSAGES_SUCCESS to inject permanently-saved deleted messages
 * back into the message list. Uses a BOUNDED time window [oldest..newest] from the
 * current batch so that deleted messages from other time periods never bleed in.
 */
async function loadMessagesSuccessHandler(payload: any) {
    try {
        const messages: any[] = payload.messages;
        if (!Array.isArray(messages)) return;

        const channelId: string = payload.channelId;
        if (!channelId) return;

        // Query all logged messages for this channel
        const records = await idb.getMessagesForChannelIDB(channelId);
        if (!records.length) return;

        const existingIds = new Set(messages.map((m: any) => m?.id));

        // Attach edit history to existing messages and re-register deleted state
        for (const record of records) {
            if (record.status === idb.DBMessageStatus.EDITED) {
                const existing = messages.find((m: any) => m?.id === record.message_id);
                if (existing && record.message.editHistory?.length) {
                    existing.editHistory = record.message.editHistory;
                }
            } else if (record.status === idb.DBMessageStatus.DELETED || record.status === idb.DBMessageStatus.GHOST_PINGED) {
                recordDeleted(record.message_id, record.channel_id, record.message?.attachments);
            }
        }

        // Inject deleted messages that are NOT already in the batch
        const toInject = records
            .filter(r =>
                (r.status === idb.DBMessageStatus.DELETED || r.status === idb.DBMessageStatus.GHOST_PINGED) &&
                !existingIds.has(r.message_id)
            )
            .map(r => {
                r.message.deleted = true;
                if (Array.isArray(r.message.attachments)) {
                    r.message.attachments.forEach((a: any) => { a.deleted = true; });
                }
                const msg = messageJsonToMessageClass({ message: r.message });
                if (msg) {
                    msg.deleted = true;
                    if (Array.isArray(msg.attachments)) {
                        msg.attachments.forEach((a: any) => { a.deleted = true; });
                    }
                }
                return msg;
            })
            .filter(Boolean);

        if (!toInject.length) return;

        // Sort descending by ID (newest first)
        toInject.sort((a: any, b: any) => {
            try {
                return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
            } catch {
                return 0;
            }
        });

        // Insert deleted messages into the array, maintaining snowflake ID order (DESC)
        for (const deleted of toInject) {
            const delId = (deleted as any).id;
            let insertAt = -1;
            try {
                const delBig = BigInt(delId);
                insertAt = messages.findIndex((m: any) => m?.id && BigInt(m.id) < delBig);
            } catch {}
            if (insertAt === -1) insertAt = messages.length;
            messages.splice(insertAt, 0, deleted);
        }
    } catch (e) {
        Flogger.error("loadMessagesSuccessHandler failed", e);
    }
}

let didClearLogsOnStartup = false;
const combinedMessageCache = new Map<string, any>();

export async function startEnhanced(this: any) {
    oldGetMessage = MessageStore.getMessage;

    MessageStore.getMessage = (channelId: string, messageId: string) => {
        const MLMessage = idb.cachedMessages.get(messageId);
        if (!MLMessage) return oldGetMessage(channelId, messageId);

        if (combinedMessageCache.has(messageId)) {
            return combinedMessageCache.get(messageId);
        }

        if (MLMessage.deleted) {
            const combined = messageJsonToMessageClass({ message: MLMessage });
            if (combined) {
                combined.deleted = true;
                if (Array.isArray(combined.attachments)) {
                    combined.attachments.forEach((a: any) => { a.deleted = true; });
                }
            }
            combinedMessageCache.set(messageId, combined);
            return combined;
        }

        const latestMessage = oldGetMessage(channelId, messageId);
        const combined = messageJsonToMessageClass({
            message: { ...MLMessage, ...(latestMessage ?? {}) }
        });

        combinedMessageCache.set(messageId, combined);
        if (combinedMessageCache.size > 1000) {
            combinedMessageCache.delete(combinedMessageCache.keys().next().value!);
        }
        return combined;
    };

    Native.init();

    if ((settings.store as any).clearLogsOnRestart && !didClearLogsOnStartup) {
        try {
            await clearLogs(false);
            didClearLogsOnStartup = true;
        } catch (e) {
            Flogger.error("Failed to clear logs on restart", e);
        }
    }

    try {
        const { imageCacheDir, logsDir } = await Native.getSettings();
        (settings.store as any).imageCacheDir = imageCacheDir;
        (settings.store as any).logsDir = logsDir;
    } catch { /* native might not be available */ }

    FluxDispatcher.subscribe("MESSAGE_DELETE", messageDeleteHandler as any);
    FluxDispatcher.subscribe("MESSAGE_DELETE_BULK", messageDeleteBulkHandler as any);
    FluxDispatcher.subscribe("MESSAGE_UPDATE", messageUpdateHandler as any);
    FluxDispatcher.subscribe("MESSAGE_CREATE", messageCreateHandler as any);
    FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", loadMessagesSuccessHandler as any);
}

export function stopEnhanced() {
    if (oldGetMessage) MessageStore.getMessage = oldGetMessage;
    FluxDispatcher.unsubscribe("MESSAGE_DELETE", messageDeleteHandler as any);
    FluxDispatcher.unsubscribe("MESSAGE_DELETE_BULK", messageDeleteBulkHandler as any);
    FluxDispatcher.unsubscribe("MESSAGE_UPDATE", messageUpdateHandler as any);
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", messageCreateHandler as any);
    FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", loadMessagesSuccessHandler as any);
}
