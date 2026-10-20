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
    ChannelRTCStore,
    ChannelStore,
    FluxDispatcher,
    RTCConnectionStore,
    SelectedChannelStore,
    showToast,
    Toasts,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import { t } from "../autoTranslateNightcord";

interface StreamDescriptor {
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

const watchStreamAction = findByCodeLazy('type:"STREAM_WATCH"');
const ChannelRTCActions = findByPropsLazy("selectParticipant");

const manuallyClosedStreams = new Set<string>();
const watchedStreams = new Set<string>();
const debounceTimers = new Map<string, any>();
const channelRetryTimers: any[] = [];
let currentVoiceChannelId: string | null = null;

function parseStreamKey(streamKey: string): StreamDescriptor | null {
    if (!streamKey || typeof streamKey !== "string") return null;
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
    const isGuild = Boolean(stream.guildId) || stream.streamType === "guild";
    if (isGuild && stream.guildId) {
        return `guild:${stream.guildId}:${stream.channelId}:${stream.ownerId}`;
    }
    return `call:${stream.channelId}:${stream.ownerId}`;
}

function triggerWatchStream(stream: StreamDescriptor, streamKey: string) {
    const myId = UserStore.getCurrentUser()?.id;
    if (!stream || stream.ownerId === myId) return;

    if (manuallyClosedStreams.has(streamKey)) return;
    if (watchedStreams.has(streamKey)) return;

    watchedStreams.add(streamKey);

    const allowMultiple = Boolean(settings.store.allowMultipleStreams);
    const streamObj = {
        streamType: stream.streamType || (stream.guildId ? "guild" : "call"),
        guildId: stream.guildId,
        channelId: stream.channelId,
        ownerId: stream.ownerId
    };

    // 1. Invoke Discord internal watchStream action if present
    try {
        const watchFn = typeof watchStreamAction === "function"
            ? watchStreamAction
            : typeof (watchStreamAction as any)?.watchStream === "function"
                ? (watchStreamAction as any).watchStream
                : typeof (watchStreamAction as any)?.A9 === "function"
                    ? (watchStreamAction as any).A9
                    : null;

        if (watchFn) {
            watchFn(streamObj, {
                forceMultiple: allowMultiple,
                allowMultiple,
                forceFocus: true
            });
        }
    } catch {}

    // 2. Dispatch STREAM_WATCH Flux event for RTC signalling
    try {
        FluxDispatcher.dispatch({
            type: "STREAM_WATCH",
            streamKey,
            allowMultiple
        });
    } catch {}

    // 3. Select participant to bring stream onto active stage
    try {
        if (typeof ChannelRTCActions?.selectParticipant === "function") {
            ChannelRTCActions.selectParticipant(stream.channelId, streamKey);
        } else {
            FluxDispatcher.dispatch({
                type: "CHANNEL_RTC_SELECT_PARTICIPANT",
                channelId: stream.channelId,
                id: streamKey
            });
        }
    } catch {}

    if (settings.store.showToast) {
        try {
            const owner = UserStore.getUser(stream.ownerId);
            const name = owner?.globalName || owner?.username || "user";
            showToast(`${t("Auto-watching stream from")} ${name}`, Toasts.Type.SUCCESS);
        } catch {}
    }
}

function queueWatchStream(stream: StreamDescriptor, streamKey: string, delayMs = 120) {
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
    const currentVoice = SelectedChannelStore.getVoiceChannelId();
    if (currentVoice !== channelId) return;

    const myId = UserStore.getCurrentUser()?.id;
    const channel = ChannelStore.getChannel(channelId);
    const guildId = channel?.guild_id;
    const defaultStreamType: "guild" | "call" = guildId ? "guild" : "call";

    const candidateStreams: Array<{ stream: StreamDescriptor; key: string }> = [];

    // 1. ChannelRTCStore: stream participants currently in the channel
    try {
        if (typeof ChannelRTCStore?.getStreamParticipants === "function") {
            const participants = ChannelRTCStore.getStreamParticipants(channelId) as any[];
            if (Array.isArray(participants)) {
                for (const p of participants) {
                    const ownerId = p?.user?.id || p?.userId;
                    if (!ownerId || ownerId === myId) continue;

                    const rawKey = p.id || p.streamId;
                    if (rawKey && typeof rawKey === "string") {
                        const parsed = parseStreamKey(rawKey);
                        if (parsed) {
                            candidateStreams.push({ stream: parsed, key: rawKey });
                            continue;
                        }
                    }

                    const fallback: StreamDescriptor = {
                        streamType: defaultStreamType,
                        guildId,
                        channelId,
                        ownerId
                    };
                    candidateStreams.push({ stream: fallback, key: makeStreamKey(fallback) });
                }
            }
        }
    } catch {}

    // 2. ApplicationStreamingStore: all broadcasted application streams in this channel
    try {
        if (typeof (ApplicationStreamingStore as any)?.getAllApplicationStreamsForChannel === "function") {
            const list = (ApplicationStreamingStore as any).getAllApplicationStreamsForChannel(channelId) as any[];
            if (Array.isArray(list)) {
                for (const s of list) {
                    if (s && s.ownerId && s.ownerId !== myId) {
                        const streamType = (s.streamType as "guild" | "call") || (s.guildId ? "guild" : "call") || defaultStreamType;
                        const desc: StreamDescriptor = {
                            streamType,
                            guildId: s.guildId || guildId,
                            channelId: s.channelId || channelId,
                            ownerId: s.ownerId
                        };
                        candidateStreams.push({ stream: desc, key: makeStreamKey(desc) });
                    }
                }
            }
        }
    } catch {}

    // 3. ApplicationStreamingStore: active broadcast streams
    try {
        if (typeof (ApplicationStreamingStore as any)?.getAllActiveStreams === "function") {
            const list = (ApplicationStreamingStore as any).getAllActiveStreams() as any[];
            if (Array.isArray(list)) {
                for (const s of list) {
                    if (s && s.channelId === channelId && s.ownerId && s.ownerId !== myId) {
                        const streamType = (s.streamType as "guild" | "call") || (s.guildId ? "guild" : "call") || defaultStreamType;
                        const desc: StreamDescriptor = {
                            streamType,
                            guildId: s.guildId || guildId,
                            channelId: s.channelId || channelId,
                            ownerId: s.ownerId
                        };
                        candidateStreams.push({ stream: desc, key: makeStreamKey(desc) });
                    }
                }
            }
        }
    } catch {}

    // 4. VoiceStateStore: scan for users with selfStream: true
    try {
        if (typeof VoiceStateStore?.getVoiceStatesForChannel === "function") {
            const states = VoiceStateStore.getVoiceStatesForChannel(channelId);
            if (states) {
                const list = Object.values(states) as any[];
                for (const vs of list) {
                    if (vs && vs.userId && vs.userId !== myId && vs.selfStream) {
                        const appStream = (ApplicationStreamingStore as any)?.getStreamForUser?.(vs.userId, vs.guildId || guildId)
                            ?? (ApplicationStreamingStore as any)?.getAnyStreamForUser?.(vs.userId);

                        if (appStream) {
                            const streamType = (appStream.streamType as "guild" | "call") || (appStream.guildId ? "guild" : "call") || defaultStreamType;
                            const desc: StreamDescriptor = {
                                streamType,
                                guildId: appStream.guildId || guildId,
                                channelId: appStream.channelId || channelId,
                                ownerId: vs.userId
                            };
                            candidateStreams.push({ stream: desc, key: makeStreamKey(desc) });
                        } else {
                            const fallback: StreamDescriptor = {
                                streamType: defaultStreamType,
                                guildId,
                                channelId,
                                ownerId: vs.userId
                            };
                            candidateStreams.push({ stream: fallback, key: makeStreamKey(fallback) });
                        }
                    }
                }
            }
        }
    } catch {}

    // Deduplicate and queue watch
    const seen = new Set<string>();
    for (const item of candidateStreams) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);

        if (manuallyClosedStreams.has(item.key) || watchedStreams.has(item.key)) continue;

        if (!settings.store.allowMultipleStreams && watchedStreams.size > 0) {
            break;
        }

        queueWatchStream(item.stream, item.key, 120);
    }
}

function scheduleChannelChecks(channelId: string) {
    clearChannelRetryTimers();
    checkChannelStreams(channelId);

    const delays = [250, 600, 1200, 2000];
    for (const delay of delays) {
        const timer = setTimeout(() => {
            if (SelectedChannelStore.getVoiceChannelId() === channelId) {
                checkChannelStreams(channelId);
            }
        }, delay);
        channelRetryTimers.push(timer);
    }
}

function clearChannelRetryTimers() {
    for (const timer of channelRetryTimers) {
        clearTimeout(timer);
    }
    channelRetryTimers.length = 0;
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
            scheduleChannelChecks(currentVoiceChannelId);
        }
    },

    stop() {
        currentVoiceChannelId = null;
        manuallyClosedStreams.clear();
        watchedStreams.clear();
        clearChannelRetryTimers();
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
                clearChannelRetryTimers();
                for (const timer of debounceTimers.values()) {
                    clearTimeout(timer);
                }
                debounceTimers.clear();

                if (channelId) {
                    scheduleChannelChecks(channelId);
                }
            }
        },

        RTC_CONNECTION_STATE({ state }: { state: string }) {
            if (state === "RTC_CONNECTED") {
                const activeVoice = SelectedChannelStore.getVoiceChannelId();
                if (activeVoice) {
                    checkChannelStreams(activeVoice);
                }
            }
        },

        CHANNEL_RTC_ACTIVE_CHANNELS() {
            const activeVoice = SelectedChannelStore.getVoiceChannelId();
            if (activeVoice) {
                checkChannelStreams(activeVoice);
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

            queueWatchStream(parsed, streamKey, 100);
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
                    clearChannelRetryTimers();
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
