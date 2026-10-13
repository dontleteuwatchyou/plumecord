/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { fetchUserProfile, openUserProfile } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelActionCreators,
    ChannelStore,
    Constants,
    FluxDispatcher,
    GuildMemberStore,
    GuildStore,
    IconUtils,
    RelationshipStore,
    RestAPI,
    SelectedGuildStore,
    UserProfileActions,
    UserStore,
    UserUtils,
} from "@webpack/common";

import { t } from "../autoTranslateNightcord";

const RelationshipActions = findByPropsLazy("removeFriend", "sendFriendRequest") as any;

export const settings = definePluginSettings({
    searchById: {
        type: OptionType.BOOLEAN,
        description: "Search by User ID (Snowflake)",
        default: true,
    },
    includeBlocked: {
        type: OptionType.BOOLEAN,
        description: "Include blocked users in search results",
        default: true,
    },
    includeAllUsers: {
        type: OptionType.BOOLEAN,
        description: "Include all known and cached users in search results",
        default: true,
    },
    searchAllServers: {
        type: OptionType.BOOLEAN,
        description: "Search across all joined servers",
        default: true,
    },
    resolveStrangers: {
        type: OptionType.BOOLEAN,
        description: "Resolve stranger usernames without mutual servers",
        default: true,
    },
    fallbackToProfile: {
        type: OptionType.BOOLEAN,
        description: "Open profile modal if direct message cannot be opened",
        default: true,
    },
});

const fetchingIds = new Set<string>();
const failedIds = new Set<string>();
const resolvingUsernames = new Set<string>();
const failedUsernames = new Set<string>();
const extraUsersCache = new Map<string, any>();

let activeSwitcher: any = null;
let lastServerQuery = "";
let serverSearchTimer: any = null;
let strangerResolveTimer: any = null;
let unpatchOpenPrivateChannel: (() => void) | null = null;
let boundOnChunk: ((event: any) => void) | null = null;
let boundOnChunkBatch: ((event: any) => void) | null = null;

const USERNAME_REGEX = /^[a-zA-Z0-9_.]{2,32}$/;

async function fetchAndCacheUser(userId: string, switcher?: any): Promise<any> {
    if (fetchingIds.has(userId) || failedIds.has(userId)) return null;
    const existing = UserStore.getUser(userId) || extraUsersCache.get(userId);
    if (existing) return existing;

    fetchingIds.add(userId);
    try {
        let user: any = null;

        // 1. Try Discord UserUtils.getUser
        try {
            if (typeof UserUtils?.getUser === "function") {
                user = await UserUtils.getUser(userId);
            }
        } catch {}

        // 2. Try RestAPI GET USER endpoint
        if (!user) {
            try {
                const res = await RestAPI.get({
                    url: Constants.Endpoints.USER(userId),
                });
                if (res?.body) {
                    FluxDispatcher.dispatch({
                        type: "USER_UPDATE",
                        user: res.body,
                    });
                    user = UserStore.getUser(userId) || res.body;
                }
            } catch {}
        }

        // 3. Try fetchUserProfile fallback
        if (!user) {
            try {
                await fetchUserProfile(userId, {}, false);
                user = UserStore.getUser(userId);
            } catch {}
        }

        if (user) {
            extraUsersCache.set(userId, user);
            try {
                switcher?.forceUpdate?.();
            } catch {}
            return user;
        } else {
            failedIds.add(userId);
            return null;
        }
    } catch {
        failedIds.add(userId);
        return null;
    } finally {
        fetchingIds.delete(userId);
    }
}

function triggerGuildMembersSearch(cleanQuery: string, switcher?: any) {
    if (!settings.store.searchAllServers || cleanQuery.length < 2) return;
    if (lastServerQuery === cleanQuery) return;
    lastServerQuery = cleanQuery;

    clearTimeout(serverSearchTimer);
    serverSearchTimer = setTimeout(() => {
        try {
            const guilds = Object.keys(GuildStore.getGuilds?.() ?? {});
            if (guilds.length === 0) return;

            // Batch gateway requests in chunks of 25 guilds
            for (let i = 0; i < guilds.length; i += 25) {
                const batch = guilds.slice(i, i + 25);
                FluxDispatcher.dispatch({
                    type: "GUILD_MEMBERS_REQUEST",
                    guildIds: batch,
                    query: cleanQuery,
                    limit: 30,
                });
            }

            // Also search selected guild via REST if active
            const activeGuildId = SelectedGuildStore?.getGuildId?.();
            if (activeGuildId) {
                RestAPI.get({
                    url: `/guilds/${activeGuildId}/members/search`,
                    query: { query: cleanQuery, limit: 30 },
                }).then((res: any) => {
                    if (Array.isArray(res?.body)) {
                        let added = false;
                        for (const m of res.body) {
                            if (m?.user?.id) {
                                extraUsersCache.set(m.user.id, m.user);
                                FluxDispatcher.dispatch({ type: "USER_UPDATE", user: m.user });
                                added = true;
                            }
                        }
                        if (added) {
                            try { switcher?.forceUpdate?.(); } catch {}
                        }
                    }
                }).catch(() => {});
            }
        } catch {}
    }, 80);
}

function triggerStrangerResolution(cleanQuery: string, switcher?: any) {
    if (!settings.store.resolveStrangers) return;
    if (!USERNAME_REGEX.test(cleanQuery)) return;
    if (resolvingUsernames.has(cleanQuery) || failedUsernames.has(cleanQuery)) return;

    // Check if user is already present in extraUsersCache
    for (const [_, u] of extraUsersCache.entries()) {
        if (u?.username?.toLowerCase() === cleanQuery) return;
    }

    clearTimeout(strangerResolveTimer);
    strangerResolveTimer = setTimeout(async () => {
        if (resolvingUsernames.has(cleanQuery) || failedUsernames.has(cleanQuery)) return;
        resolvingUsernames.add(cleanQuery);

        try { switcher?.forceUpdate?.(); } catch {}

        let resolvedUser: any = null;
        let resolveUserPromise: ((user: any) => void) | null = null;

        const userPromise = new Promise<any>((resolve) => {
            resolveUserPromise = resolve;
        });

        const waitTimer = setTimeout(() => {
            if (resolveUserPromise) {
                resolveUserPromise(null);
                resolveUserPromise = null;
            }
        }, 3000);

        const onRelAdd = (event: any) => {
            const rel = event?.relationship || event;
            const u = rel?.user || event?.user;
            if (u?.id) {
                const uName = (u.username || "").toLowerCase();
                if (uName === cleanQuery || rel?.type === 4 || rel?.type === "4") {
                    resolvedUser = u;
                    clearTimeout(waitTimer);
                    if (resolveUserPromise) {
                        resolveUserPromise(u);
                        resolveUserPromise = null;
                    }
                }
            }
        };

        const onRelUpdate = (event: any) => {
            const rel = event?.relationship || event;
            const u = rel?.user || event?.user;
            if (u?.id) {
                const uName = (u.username || "").toLowerCase();
                if (uName === cleanQuery) {
                    resolvedUser = u;
                    clearTimeout(waitTimer);
                    if (resolveUserPromise) {
                        resolveUserPromise(u);
                        resolveUserPromise = null;
                    }
                }
            }
        };

        try {
            FluxDispatcher.subscribe("RELATIONSHIP_ADD", onRelAdd);
            FluxDispatcher.subscribe("RELATIONSHIP_UPDATE", onRelUpdate);

            let queryUsername = cleanQuery;
            let queryDiscrim: number | undefined = undefined;
            if (cleanQuery.includes("#")) {
                const parts = cleanQuery.split("#");
                queryUsername = parts[0];
                if (parts[1]) {
                    const parsed = parseInt(parts[1], 10);
                    if (!isNaN(parsed) && parsed > 0) {
                        queryDiscrim = parsed;
                    }
                }
            }

            const body: Record<string, any> = { username: queryUsername };
            if (queryDiscrim !== undefined) {
                body.discriminator = queryDiscrim;
            }

            let requestDispatched = false;
            if (typeof RelationshipActions?.sendFriendRequest === "function") {
                try {
                    await RelationshipActions.sendFriendRequest({
                        username: queryUsername,
                        discriminator: queryDiscrim,
                    });
                    requestDispatched = true;
                } catch (e: any) {
                    const code = e?.body?.code || e?.status;
                    if (code === 80004) {
                        failedUsernames.add(cleanQuery);
                    }
                }
            }

            if (!requestDispatched && !failedUsernames.has(cleanQuery)) {
                try {
                    await RestAPI.post({
                        url: "/users/@me/relationships",
                        body,
                    });
                } catch (e: any) {
                    const code = e?.body?.code || e?.status;
                    if (code === 80004) {
                        failedUsernames.add(cleanQuery);
                    }
                }
            }

            const finalUser = await userPromise;
            const targetUser = finalUser || resolvedUser;

            if (targetUser?.id) {
                // Instantly cancel outgoing friend request so no trace remains
                try {
                    await RestAPI.del({ url: `/users/@me/relationships/${targetUser.id}` });
                } catch {
                    try {
                        if (typeof RelationshipActions?.cancelFriendRequest === "function") {
                            await RelationshipActions.cancelFriendRequest(targetUser.id);
                        } else if (typeof RelationshipActions?.removeFriend === "function") {
                            await RelationshipActions.removeFriend(targetUser.id);
                        }
                    } catch {}
                }

                extraUsersCache.set(targetUser.id, targetUser);
                FluxDispatcher.dispatch({
                    type: "USER_UPDATE",
                    user: targetUser,
                });
            }
        } catch {
            // Ignore unexpected exceptions
        } finally {
            clearTimeout(waitTimer);
            FluxDispatcher.unsubscribe("RELATIONSHIP_ADD", onRelAdd);
            FluxDispatcher.unsubscribe("RELATIONSHIP_UPDATE", onRelUpdate);
            resolvingUsernames.delete(cleanQuery);
            try { switcher?.forceUpdate?.(); } catch {}
        }
    }, 200);
}

function getAllCachedUsersWithNicks(): Array<{ user: any; nicks: Set<string> }> {
    const map = new Map<string, { user: any; nicks: Set<string> }>();

    const getOrCreate = (id: string, fallbackUser?: any) => {
        let entry = map.get(id);
        if (!entry) {
            const u = UserStore.getUser(id) || fallbackUser || extraUsersCache.get(id);
            if (u?.id) {
                entry = { user: u, nicks: new Set<string>() };
                map.set(id, entry);
            }
        }
        return entry;
    };

    // 1. Session extra cache
    for (const [id, u] of extraUsersCache.entries()) {
        getOrCreate(id, u);
    }

    // 2. UserStore
    try {
        const users = (UserStore as any).getUsers?.() ?? (UserStore as any)._users;
        if (users) {
            if (users instanceof Map) {
                for (const [id, u] of users.entries()) {
                    if (u?.id) getOrCreate(id, u);
                }
            } else if (typeof users === "object") {
                for (const id of Object.keys(users)) {
                    const u = users[id];
                    if (u?.id) getOrCreate(id, u);
                }
            }
        }
    } catch {}

    // 3. Blocked users
    try {
        const blockedIds = RelationshipStore.getBlockedIDs?.() ?? [];
        for (const id of blockedIds) {
            getOrCreate(id);
        }
    } catch {}

    // 4. Friends & Relationships
    try {
        const friendIds = RelationshipStore.getFriendIDs?.() ?? [];
        for (const id of friendIds) {
            getOrCreate(id);
        }
        const rels = RelationshipStore.getRelationships?.();
        if (rels && typeof rels === "object") {
            for (const id of Object.keys(rels)) {
                getOrCreate(id);
            }
        }
    } catch {}

    // 5. ChannelStore DMs
    try {
        const dmIds = ChannelStore.getDMUserIds?.() ?? [];
        for (const id of dmIds) {
            getOrCreate(id);
        }
        const privateChannels = (ChannelStore as any).getSortedPrivateChannels?.() ?? [];
        for (const ch of privateChannels) {
            const recIds = ch?.recipientIDs ?? ch?.recipients ?? [];
            for (const id of recIds) {
                if (typeof id === "string") getOrCreate(id);
                else if (id?.id) getOrCreate(id.id, id);
            }
        }
    } catch {}

    // 6. Guild members
    try {
        const guilds = GuildStore.getGuilds?.();
        if (guilds && typeof guilds === "object") {
            for (const guildId of Object.keys(guilds)) {
                const members = GuildMemberStore.getMembers?.(guildId);
                if (Array.isArray(members)) {
                    for (const m of members) {
                        if (m?.userId) {
                            const entry = getOrCreate(m.userId);
                            if (entry && m.nick) {
                                entry.nicks.add(m.nick);
                            }
                        }
                    }
                }
            }
        }
    } catch {}

    return Array.from(map.values());
}

function matchesQuery(user: any, cleanQuery: string, nicks?: Set<string>): boolean {
    if (!user) return false;
    const username = (user.username || "").toLowerCase();
    const globalName = (user.globalName || user.global_name || "").toLowerCase();
    const displayName = (user.displayName || "").toLowerCase();
    const id = user.id || "";

    if (username.includes(cleanQuery)
        || globalName.includes(cleanQuery)
        || displayName.includes(cleanQuery)
        || id.includes(cleanQuery)) {
        return true;
    }

    if (nicks) {
        for (const n of nicks) {
            if (n.toLowerCase().includes(cleanQuery)) return true;
        }
    }

    return false;
}

function computeScore(user: any, cleanQuery: string, isBlocked?: boolean, nicks?: Set<string>): number {
    const username = (user.username || "").toLowerCase();
    const globalName = (user.globalName || user.global_name || "").toLowerCase();
    const id = user.id || "";

    let score = 10000;
    let exactNick = false;
    let prefixNick = false;

    if (nicks) {
        for (const n of nicks) {
            const lower = n.toLowerCase();
            if (lower === cleanQuery) exactNick = true;
            else if (lower.startsWith(cleanQuery)) prefixNick = true;
        }
    }

    if (username === cleanQuery || globalName === cleanQuery || exactNick || id === cleanQuery) {
        score = 60000;
    } else if (username.startsWith(cleanQuery) || globalName.startsWith(cleanQuery) || prefixNick) {
        score = 30000;
    }

    if (isBlocked) {
        score += 500;
    }

    return score;
}

function createDummyUserRecord(id: string, username: string, label: string): any {
    const safeId = /^\d{17,20}$/.test(id) ? id : "0";
    const URec: any = UserStore.getCurrentUser()?.constructor;
    if (URec && safeId !== "0") {
        try {
            return new URec({
                id: safeId,
                username,
                globalName: label,
                global_name: label,
                discriminator: "0",
                avatar: null,
                bot: false,
            });
        } catch {}
    }

    return {
        id: safeId,
        username,
        globalName: label,
        global_name: label,
        tag: username,
        discriminator: "0",
        avatar: null,
        getAvatarURL: () => (IconUtils as any)?.getDefaultAvatarURL?.("0") || "",
        isSystemUser: () => false,
        isStaff: () => false,
        hasFlag: () => false,
    };
}

export default definePlugin({
    name: "ValidSearch",
    description: "Find any user in Quick Switcher by User ID or username, including blocked users and users without mutual servers.",
    authors: [{ name: "Nightcord", id: 0n }],
    settings,
    patches: [
        {
            find: "#{intl::QUICKSWITCHER_PLACEHOLDER}",
            replacement: {
                match: /let{selectedIndex:\i,results:\i}/,
                replace: "$self.prepareProps(this);$&",
            },
        },
    ],

    start() {
        // 1. Subscribe to Gateway member chunks
        boundOnChunk = (event: any) => {
            const members = event?.members;
            if (!Array.isArray(members) || members.length === 0) return;

            let foundMatch = false;
            for (const m of members) {
                const u = m?.user;
                if (u?.id) {
                    extraUsersCache.set(u.id, u);
                    if (lastServerQuery && matchesQuery(u, lastServerQuery)) {
                        foundMatch = true;
                    }
                }
            }

            if (foundMatch && activeSwitcher) {
                try { activeSwitcher.forceUpdate?.(); } catch {}
            }
        };

        boundOnChunkBatch = (event: any) => {
            const chunks = Array.isArray(event?.chunks) ? event.chunks : [];
            let foundMatch = false;
            for (const chunk of chunks) {
                const members = chunk?.members;
                if (Array.isArray(members)) {
                    for (const m of members) {
                        const u = m?.user;
                        if (u?.id) {
                            extraUsersCache.set(u.id, u);
                            if (lastServerQuery && matchesQuery(u, lastServerQuery)) {
                                foundMatch = true;
                            }
                        }
                    }
                }
            }

            if (foundMatch && activeSwitcher) {
                try { activeSwitcher.forceUpdate?.(); } catch {}
            }
        };

        try {
            FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK", boundOnChunk);
            FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK_BATCH", boundOnChunkBatch);
        } catch {}

        // 2. Patch openPrivateChannel fallback
        try {
            const origOpen = ChannelActionCreators.openPrivateChannel;
            if (typeof origOpen === "function" && !(origOpen as any).__validSearchPatched) {
                ChannelActionCreators.openPrivateChannel = async function(arg: any, ...rest: any[]) {
                    const targetId = typeof arg === "string" ? arg : (arg?.recipientId || arg?.userId || arg?.id || arg?.recipientIds?.[0]);
                    let res: any;
                    let failed = false;
                    try {
                        res = await origOpen.apply(this, [arg, ...rest]);
                    } catch {
                        failed = true;
                    }
                    if ((failed || (!res && targetId && !ChannelStore.getDMFromUserId(targetId))) && settings.store.fallbackToProfile) {
                        if (targetId) {
                            try {
                                await openUserProfile(targetId);
                            } catch {
                                try {
                                    UserProfileActions.openUserProfileModal({
                                        userId: targetId,
                                        analyticsLocation: { page: "DM Channel", section: "Profile Popout" },
                                    });
                                } catch {}
                            }
                        }
                    }
                    return res;
                };
                (ChannelActionCreators.openPrivateChannel as any).__validSearchPatched = true;
                unpatchOpenPrivateChannel = () => {
                    ChannelActionCreators.openPrivateChannel = origOpen;
                };
            }
        } catch {}
    },

    stop() {
        if (unpatchOpenPrivateChannel) {
            unpatchOpenPrivateChannel();
            unpatchOpenPrivateChannel = null;
        }

        if (boundOnChunk) {
            try { FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", boundOnChunk); } catch {}
            boundOnChunk = null;
        }

        if (boundOnChunkBatch) {
            try { FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK_BATCH", boundOnChunkBatch); } catch {}
            boundOnChunkBatch = null;
        }

        clearTimeout(serverSearchTimer);
        clearTimeout(strangerResolveTimer);
        activeSwitcher = null;
        fetchingIds.clear();
        failedIds.clear();
        resolvingUsernames.clear();
        failedUsernames.clear();
    },

    prepareProps(switcher: any) {
        if (!switcher || !switcher.state) return;
        activeSwitcher = switcher;

        const query = (switcher.state.query ?? "").trim();
        if (!query) {
            failedUsernames.clear();
        }
        const currentResults = Array.isArray(switcher.props.results) ? switcher.props.results : [];

        switcher.props.results = this.enhanceResults(query, currentResults, switcher);

        if (switcher.props.results.length > 0 && (switcher.props.selectedIndex == null || switcher.props.selectedIndex < 0)) {
            switcher.props.selectedIndex = 0;
        }

        if (switcher.props.onSelect && !switcher.props.onSelect.__validSearchPatched) {
            const origOnSelect = switcher.props.onSelect;
            switcher.props.onSelect = async function(result: any) {
                if (result?.type === "USER" && result?.record?.id) {
                    const userId = result.record.id;
                    if (userId === "100000000000000000" || userId === "0") {
                        return;
                    }

                    const existingDm = ChannelStore.getDMFromUserId(userId);
                    if (existingDm) {
                        return origOnSelect.call(this, result);
                    }

                    if (settings.store.fallbackToProfile) {
                        try {
                            const ch = await ChannelActionCreators.openPrivateChannel(userId);
                            if (ch) return origOnSelect.call(this, result);
                        } catch {}
                        try {
                            await openUserProfile(userId);
                        } catch {
                            try {
                                UserProfileActions.openUserProfileModal({
                                    userId,
                                    analyticsLocation: { page: "DM Channel", section: "Profile Popout" },
                                });
                            } catch {}
                        }
                        try { switcher.props?.close?.(); } catch {}
                        try { switcher.props?.onClose?.(); } catch {}
                        return;
                    }
                }
                return origOnSelect.call(this, result);
            };
            switcher.props.onSelect.__validSearchPatched = true;
        }
    },

    enhanceResults(query: string, currentResults: any[], switcher: any): any[] {
        const trimmed = (query || "").trim();
        if (!trimmed) return currentResults;

        const results = [...currentResults];
        const existingIds = new Set<string>();

        for (const item of results) {
            if (item?.type === "USER" && item?.record?.id) {
                existingIds.add(item.record.id);
            }
        }

        // 1. Check if query is a Snowflake User ID
        const ID_REGEX = /^(?:<@!?)?(\d{17,20})>?$/;
        const PREFIXED_ID_REGEX = /^(?:id:|user:|@)\s*(\d{17,20})$/i;
        const idMatch = trimmed.match(ID_REGEX) || trimmed.match(PREFIXED_ID_REGEX);

        if (settings.store.searchById && idMatch) {
            const userId = idMatch[1];
            let user = UserStore.getUser(userId) || extraUsersCache.get(userId);

            if (!user) {
                fetchAndCacheUser(userId, switcher);
                user = createDummyUserRecord(userId, userId, t("Loading user..."));
            }

            const filtered = results.filter(r => !(r?.type === "USER" && r?.record?.id === userId));
            const idItem = {
                type: "USER",
                record: user,
                score: 100000,
                comparator: trimmed,
                sortable: trimmed,
            };

            filtered.unshift(idItem);
            return filtered;
        }

        // 2. Search by username / display name / nickname
        const cleanQuery = trimmed.toLowerCase().replace(/^@/, "").trim();
        if (!cleanQuery) return results;

        const extraItems: any[] = [];

        // Check blocked users
        if (settings.store.includeBlocked) {
            const blockedIds = RelationshipStore.getBlockedIDs?.() ?? [];
            for (const id of blockedIds) {
                if (existingIds.has(id)) continue;
                const user = UserStore.getUser(id) || extraUsersCache.get(id);
                if (!user) continue;

                if (matchesQuery(user, cleanQuery)) {
                    existingIds.add(id);
                    extraItems.push({
                        type: "USER",
                        record: user,
                        score: computeScore(user, cleanQuery, true),
                        comparator: user.globalName || user.username || user.id,
                        sortable: user.globalName || user.username || user.id,
                    });
                }
            }
        }

        // Check all cached users across UserStore, DMs, Guilds, and session
        if (settings.store.includeAllUsers) {
            const allCached = getAllCachedUsersWithNicks();
            for (const { user, nicks } of allCached) {
                if (!user?.id || existingIds.has(user.id)) continue;
                if (matchesQuery(user, cleanQuery, nicks)) {
                    existingIds.add(user.id);
                    const isBlocked = RelationshipStore.isBlocked?.(user.id);
                    extraItems.push({
                        type: "USER",
                        record: user,
                        score: computeScore(user, cleanQuery, isBlocked, nicks),
                        comparator: user.globalName || user.username || user.id,
                        sortable: user.globalName || user.username || user.id,
                    });
                }
            }
        }

        // Trigger background search across joined guilds
        triggerGuildMembersSearch(cleanQuery, switcher);

        // Check if we already have an exact username match in results or extraItems
        const hasExactMatch = results.some(r => r?.type === "USER" && (r?.record?.username?.toLowerCase() === cleanQuery || r?.record?.tag?.toLowerCase() === cleanQuery)) ||
            extraItems.some(r => r?.type === "USER" && (r?.record?.username?.toLowerCase() === cleanQuery || r?.record?.tag?.toLowerCase() === cleanQuery));

        // If no exact match and query is a valid username pattern, attempt stranger resolution
        if (!hasExactMatch && USERNAME_REGEX.test(cleanQuery) && cleanQuery.length >= 2) {
            triggerStrangerResolution(cleanQuery, switcher);

            if (resolvingUsernames.has(cleanQuery)) {
                extraItems.push({
                    type: "USER",
                    record: createDummyUserRecord("100000000000000000", cleanQuery, `@${cleanQuery} (${t("Searching user...")})`),
                    score: 55000,
                    comparator: cleanQuery,
                    sortable: cleanQuery,
                });
            }
        }

        if (extraItems.length === 0) return results;

        const combined = [...results, ...extraItems];
        combined.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return combined.slice(0, 100);
    },
});
