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
    ChannelActions,
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

const VoiceChannelActions = findByPropsLazy("selectVoiceChannel");

const settings = definePluginSettings({
    allowedUserIds: {
        type: OptionType.STRING,
        name: "Allowed User IDs",
        description: "User IDs allowed to auto-join (separated by comma, space, or newline)",
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

function parseAllowedUserIds(raw: string): Set<string> {
    const matches = (raw || "").match(/\d{15,22}/g);
    return new Set(matches ?? []);
}

const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const lastJoinedTime = new Map<string, number>();

function triggerJoin(channelId: string, callerId: string) {
    const now = Date.now();
    const last = lastJoinedTime.get(channelId) ?? 0;
    if (now - last < 5000) return;
    lastJoinedTime.set(channelId, now);

    const currentUserId = UserStore.getCurrentUser()?.id;

    // Locally silence the incoming ringtone
    if (currentUserId) {
        try {
            FluxDispatcher.dispatch({
                type: "CALL_UPDATE",
                channelId,
                ringing: [],
            });
        } catch { }
    }

    // Connect to voice call
    try {
        const withVideo = Boolean(settings.store.video);
        if (VoiceChannelActions?.selectVoiceChannel) {
            VoiceChannelActions.selectVoiceChannel(channelId, withVideo);
        } else if (ChannelActions?.selectVoiceChannel) {
            ChannelActions.selectVoiceChannel(channelId, withVideo);
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
    const channelId = event?.channelId ?? event?.channel_id;
    if (!channelId) return;

    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId) return;

    // Only proceed if this call is actually ringing the current user
    const ringing: string[] = Array.isArray(event?.ringing) ? event.ringing : [];
    if (!ringing.includes(currentUserId)) return;

    // Skip if already in this voice channel
    try {
        if (SelectedChannelStore.getVoiceChannelId() === channelId) return;
    } catch { }

    const allowed = parseAllowedUserIds(settings.store.allowedUserIds);
    if (allowed.size === 0) return;

    const channel = ChannelStore.getChannel(channelId);
    let matchedCallerId: string | null = null;

    // 1. Direct Message recipient check
    const dmRecipientId = channel?.isDM?.()
        ? (channel.getRecipientId?.() ?? channel.recipients?.[0] ?? (channel as any).rawRecipients?.[0]?.id)
        : null;

    if (dmRecipientId && allowed.has(dmRecipientId)) {
        matchedCallerId = dmRecipientId;
    }

    // 2. Voice states caller check (who is already in call)
    if (!matchedCallerId && Array.isArray(event.voiceStates)) {
        for (const vs of event.voiceStates) {
            const uId = vs?.userId ?? vs?.user_id;
            if (uId && uId !== currentUserId && allowed.has(uId)) {
                matchedCallerId = uId;
                break;
            }
        }
    }

    // 3. Channel recipients check (Group DMs)
    if (!matchedCallerId && Array.isArray(channel?.recipients)) {
        for (const rId of channel.recipients) {
            if (rId && rId !== currentUserId && allowed.has(rId)) {
                matchedCallerId = rId;
                break;
            }
        }
    }

    if (!matchedCallerId) return;

    // Check if join already scheduled or recently performed
    const now = Date.now();
    const last = lastJoinedTime.get(channelId) ?? 0;
    if (now - last < 5000) return;
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

    const allowed = parseAllowedUserIds(settings.store.allowedUserIds);
    const isAllowed = allowed.has(user.id);
    const [checked, setChecked] = React.useState(isAllowed);

    children.push(
        <Menu.MenuCheckboxItem
            id="vc-auto-join-toggle"
            label={t("Auto-Join Calls")}
            checked={checked}
            action={() => {
                const currentSet = parseAllowedUserIds(settings.store.allowedUserIds);
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
            const channelId = event?.channelId ?? event?.channel_id;
            if (channelId && pendingTimeouts.has(channelId)) {
                clearTimeout(pendingTimeouts.get(channelId)!);
                pendingTimeouts.delete(channelId);
            }
        },
    },
    stop() {
        for (const t of pendingTimeouts.values()) {
            clearTimeout(t);
        }
        pendingTimeouts.clear();
        lastJoinedTime.clear();
    },
});
