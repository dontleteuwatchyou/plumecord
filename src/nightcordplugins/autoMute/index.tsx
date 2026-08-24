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

interface TargetUserInfo {
    name: string;
    username: string;
    avatarUrl: string;
}

const userCache = new Map<string, TargetUserInfo>();

function useTargetUser(userId: string): TargetUserInfo {
    const cachedStore = UserStore.getUser(userId);
    const initial: TargetUserInfo = userCache.get(userId) || {
        name: (cachedStore as any)?.globalName || (cachedStore as any)?.global_name || cachedStore?.username || userId,
        username: cachedStore?.username ? `@${cachedStore.username}` : "",
        avatarUrl: cachedStore?.avatar
            ? `https://cdn.discordapp.com/avatars/${userId}/${cachedStore.avatar}.webp?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`
    };

    const [info, setInfo] = React.useState<TargetUserInfo>(initial);

    React.useEffect(() => {
        const u = UserStore.getUser(userId);
        if (u) {
            const data: TargetUserInfo = {
                name: (u as any).globalName || (u as any).global_name || u.username,
                username: u.username ? `@${u.username}` : "",
                avatarUrl: u.avatar
                    ? `https://cdn.discordapp.com/avatars/${userId}/${u.avatar}.webp?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`
            };
            userCache.set(userId, data);
            setInfo(data);
            return;
        }

        if (userCache.has(userId)) {
            setInfo(userCache.get(userId)!);
            return;
        }

        RestAPI.get({ url: Constants.Endpoints.USER(userId) })
            .then((res: any) => {
                const b = res?.body;
                if (b) {
                    const data: TargetUserInfo = {
                        name: b.global_name || b.username || userId,
                        username: b.username ? `@${b.username}` : "",
                        avatarUrl: b.avatar
                            ? `https://cdn.discordapp.com/avatars/${userId}/${b.avatar}.webp?size=64`
                            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`
                    };
                    userCache.set(userId, data);
                    setInfo(data);
                }
            })
            .catch(() => { });
    }, [userId]);

    return info;
}

function TargetRow({ guildId, userId, onRemove }: { guildId: string; userId: string; onRemove: () => void; }) {
    const userInfo = useTargetUser(userId);
    const guild = GuildStore.getGuild(guildId);
    const serverName = guild?.name || guildId;

    return (
        <Card variant="primary" outline style={{ padding: "8px 12px", background: "var(--background-secondary, #2b2d31)", borderRadius: "8px" }}>
            <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                <Flex alignItems={FlexAlign.CENTER} gap="10px">
                    <Avatar src={userInfo.avatarUrl} size="SIZE_32" />
                    <Flex flexDirection={FlexDirection.VERTICAL} style={{ gap: "1px" }}>
                        <Flex alignItems={FlexAlign.CENTER} gap="6px">
                            <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "13px" }}>{userInfo.name}</span>
                            {userInfo.username && <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "11px" }}>{userInfo.username}</span>}
                        </Flex>
                        <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "11px" }}>
                            {t("Server")}: {serverName}
                        </span>
                    </Flex>
                </Flex>
                <Switch
                    checked={true}
                    onChange={onRemove}
                />
            </Flex>
        </Card>
    );
}

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
            <Card variant="primary" style={{ padding: "16px", textAlign: "center", color: "var(--text-muted, #949ba4)", marginTop: "8px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-muted, #949ba4)" }}>{t("No users currently in Auto Mute list.")}</span>
            </Card>
        );
    }

    return (
        <div style={{ width: "100%", marginTop: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "13px", letterSpacing: "0.2px" }}>
                    {t("Auto Mute Target List")}
                </span>
                <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px", fontWeight: 500 }}>
                    {entries.length} {entries.length === 1 ? "cible" : "cibles"}
                </span>
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    maxHeight: "260px",
                    overflowY: "auto",
                    paddingRight: "4px"
                }}
            >
                {entries.map(({ key, guildId, userId }) => (
                    <TargetRow
                        key={key}
                        guildId={guildId}
                        userId={userId}
                        onRemove={async () => {
                            autoMutedUsers.delete(key);
                            await saveAutoMuted();
                            await setServerMute(guildId, userId, false);
                        }}
                    />
                ))}
            </div>
        </div>
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
