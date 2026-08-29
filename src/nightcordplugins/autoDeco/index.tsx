/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Avatar, ChannelStore, Constants, FluxDispatcher, GuildStore, Menu, PermissionsBits, PermissionStore, React, RestAPI, ScrollerThin, SelectedGuildStore, Text, UserStore, VoiceActions, VoiceStateStore } from "@webpack/common";
import { Card } from "@components/Card";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Switch } from "@components/Switch";
import { t } from "../autoTranslateNightcord";

// Key format: `${guildId}:${userId}`
const autoDecoedUsers = new Set<string>();
const listeners = new Set<() => void>();
let radarInterval: ReturnType<typeof setInterval> | null = null;
const pendingDecos = new Set<string>();
const decoCooldowns = new Map<string, number>();

function notifyChange() {
    listeners.forEach(l => l());
}

async function loadAutoDecoed() {
    try {
        const saved = await DataStore.get<string[]>("AutoDeco_users");
        if (Array.isArray(saved)) {
            autoDecoedUsers.clear();
            saved.forEach(k => autoDecoedUsers.add(k));
            notifyChange();
            radarSweepDecos();
        }
    } catch { }
}

async function saveAutoDecoed() {
    try {
        await DataStore.set("AutoDeco_users", Array.from(autoDecoedUsers));
        notifyChange();
    } catch { }
}

async function setServerDisconnect(guildId: string, userId: string): Promise<boolean> {
    const key = `${guildId}:${userId}`;
    const now = Date.now();

    // 1. Strict status check: check if the user is in a voice channel
    const vs = VoiceStateStore?.getVoiceStateForUser?.(userId)
        ?? VoiceStateStore?.getVoiceState?.(guildId, userId);

    if (vs && !vs.channelId) {
        // Already disconnected from voice (0 network calls, 0 spam)
        return true;
    }

    // 2. Cooldown check (prevent spam on 403 Forbidden or 429 Rate-Limit)
    const cooldownUntil = decoCooldowns.get(key) || 0;
    if (now < cooldownUntil) {
        return false;
    }

    // 3. In-flight request lock (prevent duplicate concurrent requests)
    if (pendingDecos.has(key)) {
        return false;
    }
    pendingDecos.add(key);

    // 4. Instant optimistic UI and internal Discord action (0ms latency)
    try {
        if (typeof (VoiceActions as any)?.setChannel === "function") {
            (VoiceActions as any).setChannel(guildId, userId, null);
        }
    } catch { }

    // 5. Dual-layer REST API patch with error handling
    try {
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
            body: { channel_id: null }
        });
        decoCooldowns.delete(key);
        return true;
    } catch (e: any) {
        const status = e?.status || e?.statusCode || e?.body?.code;
        if (status === 403 || String(e?.message).includes("403")) {
            // Missing permission or target user has higher role hierarchy -> cooldown 20s
            decoCooldowns.set(key, Date.now() + 20_000);
        } else if (status === 429 || String(e?.message).includes("429")) {
            const retryAfter = e?.body?.retry_after ? Number(e.body.retry_after) * 1000 : 5000;
            decoCooldowns.set(key, Date.now() + Math.max(retryAfter, 5000));
        } else {
            decoCooldowns.set(key, Date.now() + 5000);
        }
        return false;
    } finally {
        pendingDecos.delete(key);
    }
}

function radarSweepDecos() {
    if (autoDecoedUsers.size === 0) return;

    for (const key of autoDecoedUsers) {
        const [guildId, userId] = key.split(":");
        if (!guildId || !userId) continue;

        const vs = VoiceStateStore?.getVoiceStateForUser?.(userId)
            ?? VoiceStateStore?.getVoiceState?.(guildId, userId);

        // ONLY trigger if user is actively connected in a voice channel
        if (vs?.channelId) {
            setServerDisconnect(guildId, userId).catch(() => { });
        }
    }
}

function processVoiceState(state: any) {
    if (!state) return;
    const userId = state.userId || state.user_id;
    if (!userId) return;

    const channelId = state.channelId !== undefined ? state.channelId : state.channel_id;

    // If target is connected to a voice channel, immediately disconnect them
    for (const key of autoDecoedUsers) {
        if (key.endsWith(`:${userId}`)) {
            const [guildId] = key.split(":");
            if (channelId) {
                setServerDisconnect(guildId, userId).catch(() => { });
            }
        }
    }
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { user?: any; guildId?: string; channel?: any; } = {}) => {
    const { user, channel } = ctx;
    if (!user || !Array.isArray(children)) return;

    const guildId = ctx.guildId ?? channel?.guild_id ?? (SelectedGuildStore as any)?.getGuildId?.();
    if (!guildId) return;

    const guild = GuildStore.getGuild(guildId);
    if (!guild) return;

    const context = channel || guild;
    if (!PermissionStore.can(PermissionsBits.MOVE_MEMBERS, context)) return;

    const key = `${guildId}:${user.id}`;
    const isAutoDecoed = autoDecoedUsers.has(key);

    const menuItem = (
        <Menu.MenuCheckboxItem
            key="auto-deco-toggle"
            id="vc-auto-deco-toggle"
            label={t("Auto Deco")}
            color="danger"
            checked={isAutoDecoed}
            action={() => {
                const next = !isAutoDecoed;
                if (next) {
                    autoDecoedUsers.add(key);
                    setServerDisconnect(guildId, user.id);
                    saveAutoDecoed();
                    setTimeout(() => radarSweepDecos(), 50);
                } else {
                    autoDecoedUsers.delete(key);
                    saveAutoDecoed();
                }
            }}
        />
    );

    const targetGroup = findGroupChildrenByChildId("vc-auto-mute-toggle", children)
        ?? findGroupChildrenByChildId("server-mute", children)
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

function AutoDecoSettingsComponent() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        const listener = () => forceUpdate();
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    const entries = Array.from(autoDecoedUsers).map(key => {
        const [guildId, userId] = key.split(":");
        return { key, guildId, userId };
    });

    if (entries.length === 0) {
        return (
            <Card variant="primary" style={{ padding: "16px", textAlign: "center", color: "var(--text-muted, #949ba4)", marginTop: "8px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-muted, #949ba4)" }}>{t("No users currently in Auto Deco list.")}</span>
            </Card>
        );
    }

    return (
        <div style={{ width: "100%", marginTop: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "13px", letterSpacing: "0.2px" }}>
                    {t("Auto Deco Target List")}
                </span>
                <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px", fontWeight: 500 }}>
                    {entries.length} {entries.length === 1 ? "cible" : "cibles"}
                </span>
            </div>
            <ScrollerThin
                fade
                style={{
                    maxHeight: "260px",
                    paddingRight: "6px"
                }}
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {entries.map(({ key, guildId, userId }) => (
                        <TargetRow
                            key={key}
                            guildId={guildId}
                            userId={userId}
                            onRemove={() => {
                                autoDecoedUsers.delete(key);
                                saveAutoDecoed();
                            }}
                        />
                    ))}
                </div>
            </ScrollerThin>
        </div>
    );
}

export default definePlugin({
    name: "AutoDeco",
    description: "Automatically disconnects selected users whenever they join a voice channel.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,

    settingsAboutComponent: AutoDecoSettingsComponent,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            radarSweepDecos();
            if (Array.isArray(voiceStates)) {
                for (const state of voiceStates) {
                    processVoiceState(state);
                }
            }
        },
        VOICE_STATE_UPDATE(state: any) {
            radarSweepDecos();
            processVoiceState(state);
        },
        PASSIVE_UPDATE_V2() {
            radarSweepDecos();
        },
        CHANNEL_UPDATES() {
            radarSweepDecos();
        },
        AUDIO_SET_LOCAL_MUTE() {
            radarSweepDecos();
        },
        RTC_CONNECTION_STATE() {
            radarSweepDecos();
        },
        GUILD_MEMBER_UPDATE() {
            radarSweepDecos();
        }
    },

    start() {
        loadAutoDecoed();
        try {
            VoiceStateStore?.addChangeListener?.(radarSweepDecos);
        } catch { }

        if (!radarInterval) {
            radarInterval = setInterval(() => {
                radarSweepDecos();
            }, 3000);
        }
    },

    stop() {
        if (radarInterval) {
            clearInterval(radarInterval);
            radarInterval = null;
        }
        try {
            VoiceStateStore?.removeChangeListener?.(radarSweepDecos);
        } catch { }
        autoDecoedUsers.clear();
        pendingDecos.clear();
        decoCooldowns.clear();
        notifyChange();
    }
});
