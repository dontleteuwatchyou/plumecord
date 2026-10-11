/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import {
    CallStore,
    ChannelActions,
    ChannelRouter,
    ChannelStore,
    FluxDispatcher,
    Menu,
    React,
    SelectedChannelStore,
    showToast,
    Toasts,
    UserStore,
} from "@webpack/common";
import { t } from "../autoTranslateNightcord";

const ChannelVoiceActions = findByPropsLazy("selectVoiceChannel", "disconnect");
const VoiceStateActions = findByPropsLazy("selectVoiceChannel", "connectToVoiceChannel");
const FallbackVoiceActions = findByPropsLazy("selectVoiceChannel");

const settings = definePluginSettings({
    allowedUserIds: {
        type: OptionType.STRING,
        name: "Allowed User IDs",
        description: "User IDs allowed to auto-join (separated by comma, space, or newline, or * for all)",
        default: "",
        restartNeeded: false,
    },
    video: {
        type: OptionType.BOOLEAN,
        name: "Answer with Video",
        description: "Answer calls with video/camera enabled.",
        default: false,
        restartNeeded: false,
    },
    delay: {
        type: OptionType.NUMBER,
        name: "Join Delay (ms)",
        description: "Delay before automatically answering in milliseconds (0 for instant).",
        default: 0,
        restartNeeded: false,
    },
    notify: {
        type: OptionType.BOOLEAN,
        name: "Show Notification",
        description: "Show a toast notification when automatically joining a call.",
        default: true,
        restartNeeded: false,
    },
});

function parseAllowedUserIds(raw: string): { set: Set<string>; all: boolean; } {
    if (!raw) return { set: new Set(), all: false };
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "*" || trimmed === "all" || trimmed === "tous") {
        return { set: new Set(), all: true };
    }
    const matches = raw.match(/\d{15,22}/g);
    return { set: new Set(matches ?? []), all: false };
}

const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const lastJoinedTime = new Map<string, number>();

function triggerJoin(channelId: string, callerId: string) {
    const now = Date.now();
    const last = lastJoinedTime.get(channelId) ?? 0;
    if (now - last < 4000) return;
    lastJoinedTime.set(channelId, now);

    const withVideo = Boolean(settings.store.video);

    // Answer & connect to voice call using Discord's official voice action methods
    let connected = false;
    try {
        if (typeof ChannelVoiceActions?.selectVoiceChannel === "function") {
            ChannelVoiceActions.selectVoiceChannel(channelId, withVideo);
            connected = true;
        }
    } catch { }

    if (!connected) {
        try {
            if (typeof VoiceStateActions?.selectVoiceChannel === "function") {
                VoiceStateActions.selectVoiceChannel(channelId, withVideo);
                connected = true;
            }
        } catch { }
    }

    if (!connected) {
        try {
            if (typeof FallbackVoiceActions?.selectVoiceChannel === "function") {
                FallbackVoiceActions.selectVoiceChannel(channelId, withVideo);
                connected = true;
            }
        } catch { }
    }

    // Complementary Flux dispatch to ensure local voice state synchronizes immediately
    try {
        FluxDispatcher.dispatch({
            type: "VOICE_CHANNEL_SELECT",
            channelId,
            guildId: null,
            video: withVideo,
            stream: false,
            currentVoiceChannelId: null,
        });
    } catch { }

    // Navigate user view to the channel
    try {
        if (typeof ChannelActions?.selectChannel === "function") {
            ChannelActions.selectChannel(channelId);
        } else if (typeof ChannelRouter?.transitionToChannel === "function") {
            ChannelRouter.transitionToChannel(channelId);
        }
    } catch { }

    // Notify user
    if (settings.store.notify) {
        try {
            const caller = UserStore.getUser(callerId);
            const callerName = caller?.globalName || caller?.username || callerId;
            showToast(
                `${t("Auto-joined call from")} ${callerName}`,
                Toasts.Type.SUCCESS
            );
        } catch { }
    }
}

function handleIncomingCall(event: any) {
    if (!event) return;

    const channelId: string | undefined =
        event?.channelId ??
        event?.channel_id ??
        event?.call?.channelId ??
        event?.call?.channel_id;
    if (!channelId) return;

    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId) return;

    // Skip if already connected in this voice channel
    try {
        if (SelectedChannelStore.getVoiceChannelId() === channelId) return;
    } catch { }

    const { set: allowedSet, all: allowAll } = parseAllowedUserIds(settings.store.allowedUserIds);
    if (!allowAll && allowedSet.size === 0) return;

    // Check ringing users
    const ringingList: string[] = Array.isArray(event?.ringing)
        ? event.ringing
        : Array.isArray(event?.call?.ringing)
        ? event.call.ringing
        : Array.isArray(event?.ongoingRings)
        ? event.ongoingRings
        : Array.isArray(event?.call?.ongoingRings)
        ? event.call.ongoingRings
        : Array.isArray(CallStore?.getCall?.(channelId)?.ringing)
        ? (CallStore.getCall(channelId)?.ringing ?? [])
        : [];

    // If a ringing list is present and does not include the current user, it's ringing someone else
    if (ringingList.length > 0 && !ringingList.includes(currentUserId)) {
        return;
    }

    // Collect candidate caller IDs
    const candidateCallerIds = new Set<string>();

    if (event?.userId && event.userId !== currentUserId) candidateCallerIds.add(event.userId);
    if (event?.user_id && event.user_id !== currentUserId) candidateCallerIds.add(event.user_id);
    if (event?.call?.userId && event.call.userId !== currentUserId) candidateCallerIds.add(event.call.userId);
    if (event?.call?.user_id && event.call.user_id !== currentUserId) candidateCallerIds.add(event.call.user_id);

    const voiceStates: any[] =
        (Array.isArray(event?.voiceStates) && event.voiceStates) ||
        (Array.isArray(event?.voice_states) && event.voice_states) ||
        (Array.isArray(event?.call?.voiceStates) && event.call.voiceStates) ||
        (Array.isArray(event?.call?.voice_states) && event.call.voice_states) ||
        [];

    for (const vs of voiceStates) {
        const uId = vs?.userId ?? vs?.user_id;
        if (uId && uId !== currentUserId) {
            candidateCallerIds.add(uId);
        }
    }

    let channel = ChannelStore.getChannel(channelId);
    if (!channel) {
        try {
            ChannelActions?.preload?.(null, channelId);
        } catch { }
        channel = ChannelStore.getChannel(channelId);
    }

    if (channel) {
        if (channel.isDM?.() || (channel as any).type === 1) {
            const recipientId = channel.getRecipientId?.() ?? channel.recipients?.[0] ?? (channel as any).rawRecipients?.[0]?.id;
            if (recipientId && recipientId !== currentUserId) {
                candidateCallerIds.add(recipientId);
            }
        } else if (Array.isArray(channel.recipients)) {
            for (const rId of channel.recipients) {
                if (rId && rId !== currentUserId) {
                    candidateCallerIds.add(rId);
                }
            }
        }
    }

    // Match candidate caller against allowed filter
    let matchedCallerId: string | null = null;
    if (allowAll) {
        matchedCallerId = candidateCallerIds.values().next().value ?? null;
    } else {
        for (const id of candidateCallerIds) {
            if (allowedSet.has(id)) {
                matchedCallerId = id;
                break;
            }
        }
    }

    if (!matchedCallerId) return;

    // Check cooldown / existing join schedule
    const now = Date.now();
    const last = lastJoinedTime.get(channelId) ?? 0;
    if (now - last < 4000) return;
    if (pendingTimeouts.has(channelId)) return;

    const delayMs = Math.max(0, Number(settings.store.delay) || 0);
    if (delayMs <= 0) {
        triggerJoin(channelId, matchedCallerId);
    } else {
        const timeout = setTimeout(() => {
            pendingTimeouts.delete(channelId);
            triggerJoin(channelId, matchedCallerId!);
        }, delayMs);
        pendingTimeouts.set(channelId, timeout);
    }
}

const ContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;

    const { set: allowed } = parseAllowedUserIds(settings.store.allowedUserIds);
    const isAllowed = allowed.has(user.id);
    const [checked, setChecked] = React.useState(isAllowed);

    children.push(
        <Menu.MenuCheckboxItem
            id="vc-auto-join-toggle"
            label={t("Auto-Join Calls")}
            checked={checked}
            action={() => {
                const { set: currentSet } = parseAllowedUserIds(settings.store.allowedUserIds);
                if (checked) {
                    currentSet.delete(user.id);
                } else {
                    currentSet.add(user.id);
                }
                settings.store.allowedUserIds = Array.from(currentSet).join(", ");
                setChecked(!checked);
            }}
        />
    );
};

export default definePlugin({
    name: "AutoJoin",
    description: "Automatically and instantly answers incoming calls from specified users.",
    tags: ["Voice"],
    authors: [{ name: "Nightcord", id: 0n }],
    settings,
    contextMenus: {
        "user-context": ContextMenuPatch,
    },
    flux: {
        CALL_CREATE(event: any) {
            handleIncomingCall(event);
        },
        CALL_UPDATE(event: any) {
            handleIncomingCall(event);
        },
        CALL_DELETE(event: any) {
            const channelId =
                event?.channelId ??
                event?.channel_id ??
                event?.call?.channel_id ??
                event?.call?.channelId;
            if (channelId && pendingTimeouts.has(channelId)) {
                clearTimeout(pendingTimeouts.get(channelId)!);
                pendingTimeouts.delete(channelId);
            }
        },
    },
    start() {
        try {
            const calls = CallStore?.getCalls?.();
            if (Array.isArray(calls)) {
                for (const call of calls) {
                    handleIncomingCall({ call });
                }
            }
        } catch { }
    },
    stop() {
        for (const t of pendingTimeouts.values()) {
            clearTimeout(t);
        }
        pendingTimeouts.clear();
        lastJoinedTime.clear();
    },
});
