/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { fetchUserProfile, openUserProfile } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import {
    ChannelActionCreators,
    ChannelStore,
    Constants,
    FluxDispatcher,
    IconUtils,
    RelationshipStore,
    RestAPI,
    UserProfileActions,
    UserStore,
    UserUtils,
} from "@webpack/common";

import { t } from "../autoTranslateNightcord";

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
    fallbackToProfile: {
        type: OptionType.BOOLEAN,
        description: "Open profile modal if direct message cannot be opened",
        default: true,
    },
});

const fetchingIds = new Set<string>();
const failedIds = new Set<string>();
let unpatchOpenPrivateChannel: (() => void) | null = null;

async function fetchAndCacheUser(userId: string, switcher?: any): Promise<any> {
    if (fetchingIds.has(userId) || failedIds.has(userId)) return null;
    const existing = UserStore.getUser(userId);
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
                    user = UserStore.getUser(userId);
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

function getAllCachedUsers(): any[] {
    const map = new Map<string, any>();

    try {
        const users = (UserStore as any).getUsers?.() ?? (UserStore as any)._users;
        if (users) {
            if (users instanceof Map) {
                for (const [id, u] of users.entries()) {
                    if (u?.id) map.set(id, u);
                }
            } else if (typeof users === "object") {
                for (const id of Object.keys(users)) {
                    const u = users[id];
                    if (u?.id) map.set(id, u);
                }
            }
        }
    } catch {}

    try {
        const blockedIds = RelationshipStore.getBlockedIDs?.() ?? [];
        for (const id of blockedIds) {
            if (!map.has(id)) {
                const u = UserStore.getUser(id);
                if (u) map.set(id, u);
            }
        }
    } catch {}

    try {
        const friendIds = RelationshipStore.getFriendIDs?.() ?? [];
        for (const id of friendIds) {
            if (!map.has(id)) {
                const u = UserStore.getUser(id);
                if (u) map.set(id, u);
            }
        }
    } catch {}

    return Array.from(map.values());
}

function matchesQuery(user: any, cleanQuery: string): boolean {
    if (!user) return false;
    const username = (user.username || "").toLowerCase();
    const globalName = (user.globalName || user.global_name || "").toLowerCase();
    const displayName = (user.displayName || "").toLowerCase();
    const id = user.id || "";

    return username.includes(cleanQuery)
        || globalName.includes(cleanQuery)
        || displayName.includes(cleanQuery)
        || id.includes(cleanQuery);
}

function computeScore(user: any, cleanQuery: string, isBlocked?: boolean): number {
    const username = (user.username || "").toLowerCase();
    const globalName = (user.globalName || user.global_name || "").toLowerCase();
    const id = user.id || "";

    let score = 10000;
    if (username === cleanQuery || globalName === cleanQuery || id === cleanQuery) {
        score = 50000;
    } else if (username.startsWith(cleanQuery) || globalName.startsWith(cleanQuery)) {
        score = 25000;
    }

    if (isBlocked) {
        score += 500;
    }

    return score;
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
        fetchingIds.clear();
        failedIds.clear();
    },

    prepareProps(switcher: any) {
        if (!switcher || !switcher.state) return;
        const query = (switcher.state.query ?? "").trim();
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
            let user = UserStore.getUser(userId);

            if (!user) {
                fetchAndCacheUser(userId, switcher);
                const URec: any = UserStore.getCurrentUser()?.constructor;
                user = URec ? new URec({
                    id: userId,
                    username: userId,
                    globalName: t("Loading user..."),
                    global_name: t("Loading user..."),
                    discriminator: "0",
                    avatar: null,
                    bot: false,
                }) : {
                    id: userId,
                    username: userId,
                    globalName: t("Loading user..."),
                    tag: userId,
                    discriminator: "0",
                    getAvatarURL: () => (IconUtils as any)?.getDefaultAvatarURL?.("0") || "",
                    isSystemUser: () => false,
                    isStaff: () => false,
                    hasFlag: () => false,
                };
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

        // 2. Search by username / display name
        const cleanQuery = trimmed.toLowerCase().replace(/^@/, "").trim();
        if (!cleanQuery) return results;

        const extraItems: any[] = [];

        // Blocked users
        if (settings.store.includeBlocked) {
            const blockedIds = RelationshipStore.getBlockedIDs?.() ?? [];
            for (const id of blockedIds) {
                if (existingIds.has(id)) continue;
                const user = UserStore.getUser(id);
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

        // All cached / known users
        if (settings.store.includeAllUsers) {
            const allUsers = getAllCachedUsers();
            for (const user of allUsers) {
                if (!user?.id || existingIds.has(user.id)) continue;
                if (matchesQuery(user, cleanQuery)) {
                    existingIds.add(user.id);
                    const isBlocked = RelationshipStore.isBlocked?.(user.id);
                    extraItems.push({
                        type: "USER",
                        record: user,
                        score: computeScore(user, cleanQuery, isBlocked),
                        comparator: user.globalName || user.username || user.id,
                        sortable: user.globalName || user.username || user.id,
                    });
                }
            }
        }

        if (extraItems.length === 0) return results;

        const combined = [...results, ...extraItems];
        combined.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return combined.slice(0, 100);
    },
});
