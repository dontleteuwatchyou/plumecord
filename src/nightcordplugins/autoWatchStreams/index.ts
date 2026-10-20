/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import {
    ApplicationStreamingStore,
    ChannelStore,
    FluxDispatcher,
    SelectedChannelStore,
    showToast,
    Toasts,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import { t } from "../autoTranslateNightcord";

interface ParsedStreamKey {
    streamType: "guild" | "call";
    guildId?: string;
    channelId: string;
    ownerId: string;
}

const settings = definePluginSettings({
    allowMultipleStreams: {
        type: OptionType.BOOLEAN,
        description: "Auto-watch multiple simultaneous streams",
        default: true
    },
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show notification",
        default: false
    }
});

const watchStreamByCode = findByCodeLazy('type:"STREAM_WATCH"');
const streamActions = findByPropsLazy("watchStream") ?? findByPropsLazy("stopWatchingStream");
const streamKeyUtils = findByPropsLazy("encodeStreamKey", "decodeStreamKey");

const manuallyClosedStreams = new Set<string>();
const watchedStreams = new Set<string>();
const debounceTimers = new Map<string, any>();
let currentVoiceChannelId: string | null = null;

function parseStreamKey(streamKey: string): ParsedStreamKey | null {
    if (typeof streamKeyUtils?.decodeStreamKey === "function") {
        try {
            const decoded = streamKeyUtils.decodeStreamKey(streamKey);
            if (decoded && decoded.channelId && decoded.ownerId) {
                return {
                    streamType: decoded.streamType || (decoded.guildId ? "guild" : "call"),
                    guildId: decoded.guildId || undefined,
                    channelId: decoded.channelId,
                    ownerId: decoded.ownerId
                };
            }
        } catch {}
    }

    const parts = streamKey.split(":");
    if (parts[0] === "guild" && parts.length >= 4) {
        return {
            streamType: "guild",
            guildId: parts[1],
            channelId: parts[2],
            ownerId: parts[3]
        };
    } else if (parts[0] === "call" && parts.length >= 3) {
        return {
            streamType: "call",
            guildId: undefined,
            channelId: parts[1],
            ownerId: parts[2]
        };
    }
    return null;
}

function makeStreamKey(stream: { streamType?: string; guildId?: string; channelId: string; ownerId: string }): string {
    if (typeof streamKeyUtils?.encodeStreamKey === "function") {
        try {
            const encoded = streamKeyUtils.encodeStreamKey(stream);
            if (typeof encoded === "string" && encoded.length > 0) return encoded;
        } catch {}
    }

    const isGuild = Boolean(stream.guildId) || stream.streamType === "guild";
    if (isGuild && stream.guildId) {
        return `guild:${stream.guildId}:${stream.channelId}:${stream.ownerId}`;
    }
    return `call:${stream.channelId}:${stream.ownerId}`;
}

function triggerWatchStream(stream: { streamType?: string; guildId?: string; channelId: string; ownerId: string }, streamKey: string) {
    const myId = UserStore.getCurrentUser()?.id;
    if (stream.ownerId === myId) return;

    if (manuallyClosedStreams.has(streamKey)) return;
    if (watchedStreams.has(streamKey)) return;

    watchedStreams.add(streamKey);

    const watchFn = streamActions?.watchStream ?? watchStreamByCode;
    let success = false;

    if (typeof watchFn === "function") {
        try {
            const streamObj = {
                streamType: stream.streamType || (stream.guildId ? "guild" : "call"),
                guildId: stream.guildId,
                channelId: stream.channelId,
                ownerId: stream.ownerId
            };
            watchFn(streamObj, {
                allowMultiple: settings.store.allowMultipleStreams,
                forceMultiple: settings.store.allowMultipleStreams
            });
            success = true;
        } catch {}
    }

    if (!success) {
        try {
            FluxDispatcher.dispatch({
                type: "STREAM_WATCH",
                streamKey,
                allowMultiple: settings.store.allowMultipleStreams
            });
            success = true;
        } catch {}
    }

    if (success && settings.store.showToast) {
        try {
            const owner = UserStore.getUser(stream.ownerId);
            const name = owner?.globalName || owner?.username || "user";
            showToast(`${t("Auto-watching stream from")} ${name}`, Toasts.Type.SUCCESS);
        } catch {}
    }
}

function queueWatchStream(stream: { streamType?: string; guildId?: string; channelId: string; ownerId: string }, streamKey: string, delayMs = 150) {
    if (manuallyClosedStreams.has(streamKey) || watchedStreams.has(streamKey)) return;

    if (debounceTimers.has(streamKey)) {
        clearTimeout(debounceTimers.get(streamKey));
    }

    const timer = setTimeout(() => {
        debounceTimers.delete(streamKey);
        const currentChannel = SelectedChannelStore.getVoiceChannelId();
        if (currentChannel !== stream.channelId) return;
        triggerWatchStream(stream, streamKey);
    }, delayMs);

    debounceTimers.set(streamKey, timer);
}

function checkChannelStreams(channelId: string) {
    if (!channelId) return;
    const myId = UserStore.getCurrentUser()?.id;
    const streamsToWatch: Array<{ stream: any; key: string }> = [];

    // 1. ApplicationStreamingStore.getAllActiveStreamsForChannel
    try {
        if (typeof ApplicationStreamingStore?.getAllActiveStreamsForChannel === "function") {
            const list = ApplicationStreamingStore.getAllActiveStreamsForChannel(channelId);
            if (Array.isArray(list)) {
                for (const s of list) {
                    if (s && s.ownerId && s.ownerId !== myId) {
                        streamsToWatch.push({ stream: s, key: makeStreamKey(s) });
                    }
                }
            }
        }
    } catch {}

    // 2. ApplicationStreamingStore.getActiveStreamsForChannel
    try {
        if (typeof ApplicationStreamingStore?.getActiveStreamsForChannel === "function") {
            const list = ApplicationStreamingStore.getActiveStreamsForChannel(channelId);
            if (Array.isArray(list)) {
                for (const s of list) {
                    if (s && s.ownerId && s.ownerId !== myId) {
                        streamsToWatch.push({ stream: s, key: makeStreamKey(s) });
                    }
                }
            }
        }
    } catch {}

    // 3. ApplicationStreamingStore.getAllActiveStreams
    try {
        if (typeof ApplicationStreamingStore?.getAllActiveStreams === "function") {
            const list = ApplicationStreamingStore.getAllActiveStreams();
            if (Array.isArray(list)) {
                for (const s of list) {
                    if (s && s.channelId === channelId && s.ownerId && s.ownerId !== myId) {
                        streamsToWatch.push({ stream: s, key: makeStreamKey(s) });
                    }
                }
            }
        }
    } catch {}

    // 4. VoiceStateStore scan for streaming members
    try {
        if (typeof VoiceStateStore?.getVoiceStatesForChannel === "function") {
            const states = VoiceStateStore.getVoiceStatesForChannel(channelId);
            if (states) {
                const list = Object.values(states) as any[];
                for (const vs of list) {
                    if (vs && vs.userId && vs.userId !== myId && vs.selfStream) {
                        const userStream = ApplicationStreamingStore?.getAnyStreamForUser?.(vs.userId)
                            ?? ApplicationStreamingStore?.getActiveStreamForUser?.(vs.userId);
                        if (userStream && userStream.channelId === channelId) {
                            streamsToWatch.push({ stream: userStream, key: makeStreamKey(userStream) });
                        } else {
                            const ch = ChannelStore.getChannel(channelId);
                            const synth = {
                                streamType: ch?.guild_id ? "guild" : "call",
                                guildId: ch?.guild_id,
                                channelId,
                                ownerId: vs.userId
                            };
                            streamsToWatch.push({ stream: synth, key: makeStreamKey(synth) });
                        }
                    }
                }
            }
        }
    } catch {}

    // Deduplicate and queue watch
    const seen = new Set<string>();
    for (const item of streamsToWatch) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        if (manuallyClosedStreams.has(item.key) || watchedStreams.has(item.key)) continue;
        queueWatchStream(item.stream, item.key, 200);
    }
}

export default definePlugin({
    name: "AutoWatchStreams",
    description: "Automatically watch screen shares and streams when joining a voice channel or when someone starts streaming.",
    authors: [{ name: "Nightcord", id: 0n }],
    tags: ["Media", "Voice"],
    settings,

    start() {
        currentVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
        if (currentVoiceChannelId) {
            checkChannelStreams(currentVoiceChannelId);
            setTimeout(() => {
                if (SelectedChannelStore.getVoiceChannelId() === currentVoiceChannelId) {
                    checkChannelStreams(currentVoiceChannelId!);
                }
            }, 500);
        }
    },

    stop() {
        currentVoiceChannelId = null;
        manuallyClosedStreams.clear();
        watchedStreams.clear();
        for (const timer of debounceTimers.values()) {
            clearTimeout(timer);
        }
        debounceTimers.clear();
    },

    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null }) {
            if (channelId !== currentVoiceChannelId) {
                currentVoiceChannelId = channelId;
                manuallyClosedStreams.clear();
                watchedStreams.clear();
                for (const timer of debounceTimers.values()) {
                    clearTimeout(timer);
                }
                debounceTimers.clear();

                if (channelId) {
                    checkChannelStreams(channelId);
                    setTimeout(() => {
                        if (SelectedChannelStore.getVoiceChannelId() === channelId) {
                            checkChannelStreams(channelId);
                        }
                    }, 400);
                }
            }
        },

        STREAM_CREATE({ streamKey }: { streamKey: string }) {
            if (!streamKey) return;
            const parsed = parseStreamKey(streamKey);
            if (!parsed) return;

            const activeVoice = SelectedChannelStore.getVoiceChannelId();
            if (!activeVoice || parsed.channelId !== activeVoice) return;

            const myId = UserStore.getCurrentUser()?.id;
            if (parsed.ownerId === myId) return;

            if (manuallyClosedStreams.has(streamKey)) return;

            queueWatchStream(parsed, streamKey, 150);
        },

        STREAM_DELETE({ streamKey }: { streamKey: string }) {
            if (!streamKey) return;
            manuallyClosedStreams.delete(streamKey);
            watchedStreams.delete(streamKey);
            if (debounceTimers.has(streamKey)) {
                clearTimeout(debounceTimers.get(streamKey));
                debounceTimers.delete(streamKey);
            }
        },

        STREAM_CLOSE({ streamKey }: { streamKey: string }) {
            if (!streamKey) return;
            const myId = UserStore.getCurrentUser()?.id;
            const owner = streamKey.split(":").at(-1);

            if (owner && owner !== myId) {
                manuallyClosedStreams.add(streamKey);
                watchedStreams.delete(streamKey);
                if (debounceTimers.has(streamKey)) {
                    clearTimeout(debounceTimers.get(streamKey));
                    debounceTimers.delete(streamKey);
                }
            }
        },

        STREAM_STOP(data: { streamKey?: string }) {
            if (!data?.streamKey) return;
            const myId = UserStore.getCurrentUser()?.id;
            const owner = data.streamKey.split(":").at(-1);

            if (owner && owner !== myId) {
                manuallyClosedStreams.add(data.streamKey);
                watchedStreams.delete(data.streamKey);
                if (debounceTimers.has(data.streamKey)) {
                    clearTimeout(debounceTimers.get(data.streamKey));
                    debounceTimers.delete(data.streamKey);
                }
            }
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[] }) {
            const activeVoice = SelectedChannelStore.getVoiceChannelId();
            if (!activeVoice) return;
            const myId = UserStore.getCurrentUser()?.id;

            let hasNewStreamer = false;
            for (const vs of voiceStates) {
                if (vs.userId === myId && !vs.channelId) {
                    currentVoiceChannelId = null;
                    manuallyClosedStreams.clear();
                    watchedStreams.clear();
                    for (const timer of debounceTimers.values()) {
                        clearTimeout(timer);
                    }
                    debounceTimers.clear();
                    return;
                }

                if (vs.channelId === activeVoice && vs.userId !== myId && vs.selfStream) {
                    hasNewStreamer = true;
                }
            }

            if (hasNewStreamer) {
                checkChannelStreams(activeVoice);
            }
        }
    }
});
