/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Avatar, Constants, GuildStore, Menu, PermissionsBits, PermissionStore, React, RestAPI, Text, UserStore, VoiceStateStore } from "@webpack/common";
import { Card } from "@components/Card";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Switch } from "@components/Switch";
import { t } from "../autoTranslateNightcord";

// Key format: `${guildId}:${userId}`
const autoMutedUsers = new Set<string>();
const listeners = new Set<() => void>();

function notifyChange() {
    listeners.forEach(l => l());
}

async function loadAutoMuted() {
    try {
        const saved = await DataStore.get<string[]>("AutoMute_users");
        if (Array.isArray(saved)) {
            autoMutedUsers.clear();
            saved.forEach(k => autoMutedUsers.add(k));
            notifyChange();
        }
    } catch { }
}

async function saveAutoMuted() {
    try {
        await DataStore.set("AutoMute_users", Array.from(autoMutedUsers));
        notifyChange();
    } catch { }
}

async function setServerMute(guildId: string, userId: string, mute: boolean): Promise<boolean> {
    try {
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
            body: { mute }
        });
        return true;
    } catch (e: any) {
        console.error("[AutoMute] Server mute failed:", e);
        return false;
    }
}

function checkAllMutes() {
    if (autoMutedUsers.size === 0) return;
    for (const key of autoMutedUsers) {
        const [guildId, userId] = key.split(":");
        if (!guildId || !userId) continue;

        const vs = VoiceStateStore?.getVoiceStateForUser?.(userId)
            ?? VoiceStateStore?.getVoiceState?.(guildId, userId);

        if (vs?.channelId && !vs.mute) {
            setServerMute(guildId, userId, true).catch(() => {});
        }
    }
}

function processVoiceState(state: any) {
    if (!state) return;
    const userId = state.userId || state.user_id;
    const guildId = state.guildId || state.guild_id || GuildStore.getGuildId();
    const mute = state.mute !== undefined ? Boolean(state.mute) : false;
    const channelId = state.channelId !== undefined ? state.channelId : state.channel_id;

    if (!userId || !guildId) return;

    const key = `${guildId}:${userId}`;
    if (autoMutedUsers.has(key)) {
        if (channelId && !mute) {
            setServerMute(guildId, userId, true).catch(() => {});
            setTimeout(() => {
                const vs = VoiceStateStore?.getVoiceStateForUser?.(userId);
                if (autoMutedUsers.has(key) && vs?.channelId && !vs?.mute) {
                    setServerMute(guildId, userId, true).catch(() => {});
                }
            }, 150);
            setTimeout(() => {
                const vs = VoiceStateStore?.getVoiceStateForUser?.(userId);
                if (autoMutedUsers.has(key) && vs?.channelId && !vs?.mute) {
                    setServerMute(guildId, userId, true).catch(() => {});
                }
            }, 400);
        }
    }
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { user?: any; guildId?: string; channel?: any; } = {}) => {
    const { user, channel } = ctx;
    if (!user || !Array.isArray(children)) return;

    const guildId = ctx.guildId ?? channel?.guild_id ?? GuildStore.getGuildId();
    if (!guildId) return;

    const guild = GuildStore.getGuild(guildId);
    if (!guild) return;

    const context = channel || guild;
    if (!PermissionStore.can(PermissionsBits.MUTE_MEMBERS, context)) return;

    const key = `${guildId}:${user.id}`;
    const isAutoMuted = autoMutedUsers.has(key);

    const menuItem = (
        <Menu.MenuCheckboxItem
            key="auto-mute-toggle"
            id="vc-auto-mute-toggle"
            label={t("Auto Mute")}
            color="danger"
            checked={isAutoMuted}
            action={async () => {
                const next = !isAutoMuted;
                if (next) {
                    autoMutedUsers.add(key);
                    await saveAutoMuted();
                    await setServerMute(guildId, user.id, true);
                } else {
                    autoMutedUsers.delete(key);
                    await saveAutoMuted();
                    await setServerMute(guildId, user.id, false);
                }
            }}
        />
    );

    const targetGroup = findGroupChildrenByChildId("server-mute", children)
        ?? findGroupChildrenByChildId("server-deafen", children)
        ?? findGroupChildrenByChildId("disconnect", children)
        ?? findGroupChildrenByChildId("mod-view", children);

    if (targetGroup && Array.isArray(targetGroup)) {
        targetGroup.push(menuItem);
    } else {
        children.push(<Menu.MenuGroup>{menuItem}</Menu.MenuGroup>);
    }
};

function AutoMuteSettingsComponent() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        const listener = () => forceUpdate();
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    const entries = Array.from(autoMutedUsers).map(key => {
        const [guildId, userId] = key.split(":");
        return { key, guildId, userId };
    });

    if (entries.length === 0) {
        return (
            <Card variant="primary" style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", marginTop: "8px" }}>
                <Text variant="text-sm/normal">{t("No users currently in Auto Mute list.")}</Text>
            </Card>
        );
    }

    return (
        <Flex flexDirection={FlexDirection.VERTICAL} gap="8px" style={{ width: "100%", marginTop: "8px" }}>
            <Text variant="text-sm/bold" style={{ color: "var(--header-primary)", marginBottom: "4px" }}>
                {t("Auto Mute Target List")} ({entries.length})
            </Text>
            {entries.map(({ key, guildId, userId }) => {
                const user = UserStore.getUser(userId);
                const guild = GuildStore.getGuild(guildId);
                const username = user?.globalName || (user as any)?.global_name || user?.username || userId;
                const handle = user?.username ? `@${user.username}` : "";
                const serverName = guild?.name || guildId;
                const avatarUrl = user?.avatar
                    ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.webp?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;

                return (
                    <Card key={key} variant="primary" outline style={{ padding: "10px 14px" }}>
                        <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                            <Flex alignItems={FlexAlign.CENTER} gap="12px">
                                <Avatar src={avatarUrl} size="SIZE_32" />
                                <Flex flexDirection={FlexDirection.VERTICAL} style={{ gap: "2px" }}>
                                    <Flex alignItems={FlexAlign.CENTER} gap="6px">
                                        <Text variant="text-sm/bold" style={{ color: "var(--header-primary)" }}>{username}</Text>
                                        {handle && <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>{handle}</Text>}
                                    </Flex>
                                    <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                                        {t("Server")}: {serverName}
                                    </Text>
                                </Flex>
                            </Flex>
                            <Switch
                                checked={true}
                                onChange={async () => {
                                    autoMutedUsers.delete(key);
                                    await saveAutoMuted();
                                    await setServerMute(guildId, userId, false);
                                }}
                            />
                        </Flex>
                    </Card>
                );
            })}
        </Flex>
    );
}

export default definePlugin({
    name: "AutoMute",
    description: "Automatically server mutes selected users and re-mutes them instantly if they unmute.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,

    settingsAboutComponent: AutoMuteSettingsComponent,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            checkAllMutes();
            if (Array.isArray(voiceStates)) {
                for (const state of voiceStates) {
                    processVoiceState(state);
                }
            }
        },
        VOICE_STATE_UPDATE(state: any) {
            checkAllMutes();
            processVoiceState(state);
        },
        PASSIVE_UPDATE_V2() {
            checkAllMutes();
        }
    },

    start() {
        loadAutoMuted();
        try {
            VoiceStateStore?.addChangeListener?.(checkAllMutes);
        } catch { }
    },

    stop() {
        try {
            VoiceStateStore?.removeChangeListener?.(checkAllMutes);
        } catch { }
        autoMutedUsers.clear();
        notifyChange();
    }
});
