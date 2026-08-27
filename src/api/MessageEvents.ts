/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Logger } from "@utils/Logger";
import type { Channel, CloudUpload, CustomEmoji, Message } from "@vencord/discord-types";
import { waitFor } from "@webpack";
import { MessageStore } from "@webpack/common";
import type { Promisable } from "type-fest";

const MessageEventsLogger = new Logger("MessageEvents", "#e5c890");

const PROCESSED_PRESEND = Symbol("PROCESSED_PRESEND");
const PROCESSED_PREEDIT = Symbol("PROCESSED_PREEDIT");

export interface MessageObject {
    content: string,
    validNonShortcutEmojis: CustomEmoji[];
    invalidEmojis: any[];
    tts: boolean;
}

export interface MessageReplyOptions {
    messageReference: Message["messageReference"];
    allowedMentions?: {
        parse: Array<string>;
        users?: Array<string>;
        roles?: Array<string>;
        repliedUser: boolean;
    };
}

export interface MessageOptions {
    stickers?: string[];
    uploads?: CloudUpload[];
    replyOptions: MessageReplyOptions;
    content: string;
    channel: Channel;
    type?: any;
    openWarningPopout: (props: any) => any;
}

export type MessageSendListener = (channelId: string, messageObj: MessageObject, options: MessageOptions) => Promisable<void | { cancel: boolean; }>;
export type MessageEditListener = (channelId: string, messageId: string, messageObj: MessageObject) => Promisable<void | { cancel: boolean; }>;

const sendListeners = new Set<MessageSendListener>();
const editListeners = new Set<MessageEditListener>();

async function runWithTimeout<T>(fn: () => Promisable<T>, timeoutMs = 2500): Promise<T | undefined> {
    let timer: any;
    const timeoutPromise = new Promise<undefined>(resolve => {
        timer = setTimeout(resolve, timeoutMs);
    });
    try {
        return await Promise.race([Promise.resolve(fn()), timeoutPromise]);
    } finally {
        clearTimeout(timer);
    }
}

export async function _handlePreSend(channelId: string, messageObj: MessageObject, options: MessageOptions, replyOptions: MessageReplyOptions) {
    if ((messageObj as any)[PROCESSED_PRESEND]) {
        return false;
    }
    (messageObj as any)[PROCESSED_PRESEND] = true;
    options.replyOptions = replyOptions;
    for (const listener of sendListeners) {
        try {
            const result = await runWithTimeout(() => listener(channelId, messageObj, options));
            if (result?.cancel) {
                return true;
            }
        } catch (e) {
            MessageEventsLogger.error("MessageSendHandler: Listener encountered an unknown error\n", e);
        }
    }
    return false;
}

export async function _handlePreEdit(channelId: string, messageId: string, messageObj: MessageObject) {
    if ((messageObj as any)[PROCESSED_PREEDIT]) {
        return false;
    }
    (messageObj as any)[PROCESSED_PREEDIT] = true;
    for (const listener of editListeners) {
        try {
            const result = await runWithTimeout(() => listener(channelId, messageId, messageObj));
            if (result?.cancel) {
                return true;
            }
        } catch (e) {
            MessageEventsLogger.error("MessageEditHandler: Listener encountered an unknown error\n", e);
        }
    }
    return false;
}

// Runtime hook on MessageActions to ensure preSend and preEdit always run even if AST patches are bypassed
waitFor(["sendMessage", "editMessage"], (MessageActions: any) => {
    if (!MessageActions) return;

    if (typeof MessageActions.sendMessage === "function") {
        const origSendMessage = MessageActions.sendMessage;
        MessageActions.sendMessage = async function(channelId: string, message: any, ...rest: any[]) {
            if (message && typeof message === "object" && !message[PROCESSED_PRESEND]) {
                const options = rest[1] || rest[0] || {};
                const cancel = await _handlePreSend(channelId, message, options, options.replyOptions || {});
                if (cancel) return;
            }
            return origSendMessage.call(this, channelId, message, ...rest);
        };
    }

    if (typeof MessageActions._sendMessage === "function") {
        const orig_sendMessage = MessageActions._sendMessage;
        MessageActions._sendMessage = async function(channelId: string, message: any, ...rest: any[]) {
            if (message && typeof message === "object" && !message[PROCESSED_PRESEND]) {
                const options = rest[0] || {};
                const cancel = await _handlePreSend(channelId, message, options, options.replyOptions || {});
                if (cancel) return;
            }
            return orig_sendMessage.call(this, channelId, message, ...rest);
        };
    }

    if (typeof MessageActions.editMessage === "function") {
        const origEditMessage = MessageActions.editMessage;
        MessageActions.editMessage = async function(channelId: string, messageId: string, message: any, ...rest: any[]) {
            if (message && typeof message === "object" && !message[PROCESSED_PREEDIT]) {
                const cancel = await _handlePreEdit(channelId, messageId, message);
                if (cancel) return;
            }
            return origEditMessage.call(this, channelId, messageId, message, ...rest);
        };
    }
});

/**
 * Note: This event fires off before a message is sent, allowing you to edit the message.
 */
export function addMessagePreSendListener(listener: MessageSendListener) {
    sendListeners.add(listener);
    return listener;
}
/**
 * Note: This event fires off before a message's edit is applied, allowing you to further edit the message.
 */
export function addMessagePreEditListener(listener: MessageEditListener) {
    editListeners.add(listener);
    return listener;
}
export function removeMessagePreSendListener(listener: MessageSendListener) {
    return sendListeners.delete(listener);
}
export function removeMessagePreEditListener(listener: MessageEditListener) {
    return editListeners.delete(listener);
}

// Message clicks
export type MessageClickListener = (message: Message, channel: Channel, event: MouseEvent) => void;

const listeners = new Set<MessageClickListener>();

export function _handleClick(message: Message, channel: Channel, event: MouseEvent) {
    // message object may be outdated, so (try to) fetch latest one
    message = MessageStore.getMessage(channel.id, message.id) ?? message;
    for (const listener of listeners) {
        try {
            listener(message, channel, event);
        } catch (e) {
            MessageEventsLogger.error("MessageClickHandler: Listener encountered an unknown error\n", e);
        }
    }
}

export function addMessageClickListener(listener: MessageClickListener) {
    listeners.add(listener);
    return listener;
}

export function removeMessageClickListener(listener: MessageClickListener) {
    return listeners.delete(listener);
}
