/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { authorizeUser, checkOAuthToken, clearToken, getStoredToken } from "@api/OAuth2";
import { getPluginSyncToken, getPublicPluginConfig, saveOwnPluginConfig } from "@api/SettingsSync/pluginSync";
import { UserStore } from "@webpack/common";
import type {
    NightcordPremiumPayload,
    NightcordPremiumSettings,
    PremiumFavSong,
    PremiumStory,
    ProfileEffectsConfig
} from "./types";

export const PREMIUM_SETTINGS_KEY = "Nightcord_Premium_Settings";
export const STORIES_KEY = "NightcordPremium_Stories";
export const FAV_SONGS_KEY = "NightcordPremium_FavSongs";
export const EFFECTS_KEY = "NightcordPremium_ProfileEffects";

export const DEFAULT_PREMIUM_SETTINGS: NightcordPremiumSettings = {
    enabled: true,
    storiesEnabled: false,
    favSongsEnabled: false,
    profileEffectsEnabled: false,
};

export const DEFAULT_EFFECTS_CONFIG: ProfileEffectsConfig = {
    enabled: false,
    mode: "preset",
    presetName: "cards-glitch",
    showBanner: false,
    gifUrl: "https://i.imgur.com/b8THXPt.gif",
    gifOpacity: 0.6,
    gifFit: "cover",
    gifBgColor: "#0a0010",
    gifBlendMode: "normal",
    nameEffect: "none",
    glowColor: "#a78bfa",
    chatUsernameEffect: "none",
    memberListEffect: "none",
};

// ─── Settings Store ──────────────────────────────────────────────────────────

let inMemorySettings: NightcordPremiumSettings | null = null;
const settingsListeners = new Set<(s: NightcordPremiumSettings) => void>();

export async function getPremiumSettings(): Promise<NightcordPremiumSettings> {
    if (inMemorySettings) return inMemorySettings;
    const saved = await DataStore.get<NightcordPremiumSettings>(PREMIUM_SETTINGS_KEY);
    inMemorySettings = { ...DEFAULT_PREMIUM_SETTINGS, ...(saved || {}) };
    return inMemorySettings;
}

export function getCachedPremiumSettings(): NightcordPremiumSettings {
    return inMemorySettings ?? DEFAULT_PREMIUM_SETTINGS;
}

export async function setPremiumSettings(update: Partial<NightcordPremiumSettings>): Promise<NightcordPremiumSettings> {
    const current = await getPremiumSettings();
    const next = { ...current, ...update };
    inMemorySettings = next;
    await DataStore.set(PREMIUM_SETTINGS_KEY, next);
    for (const listener of settingsListeners) {
        try { listener(next); } catch {}
    }
    void syncOwnDataToCloud();
    return next;
}

export function subscribePremiumSettings(listener: (s: NightcordPremiumSettings) => void): () => void {
    settingsListeners.add(listener);
    return () => settingsListeners.delete(listener);
}

// ─── OAuth2 Verification & Auth ──────────────────────────────────────────────

export async function getValidOAuthToken(): Promise<string | null> {
    let token = await getStoredToken();
    if (!token) {
        token = (await getPluginSyncToken()) || null;
    }
    if (!token) {
        token = (await DataStore.get<string>("nightcord_oauth_token")) || null;
    }
    if (!token) return null;

    try {
        const check = await checkOAuthToken(token);
        if (check) return token;
    } catch {}
    return null;
}

export async function isOAuthAuthenticated(): Promise<boolean> {
    const token = await getValidOAuthToken();
    return !!token;
}

export async function promptDiscordOAuth(): Promise<string | null> {
    const token = await authorizeUser();
    if (token) {
        // Trigger auto sync
        void syncOwnDataToCloud();
    }
    return token;
}

export async function disconnectDiscordOAuth(): Promise<void> {
    await clearToken();
    await DataStore.del("nightcord_oauth_token");
}

// ─── Local Data Storage ──────────────────────────────────────────────────────

export async function getLocalStories(userId?: string): Promise<PremiumStory[]> {
    const curId = UserStore.getCurrentUser()?.id;
    const uid = userId || curId;
    if (uid) {
        const saved = await DataStore.get<PremiumStory[]>(`${STORIES_KEY}_${uid}`);
        if (Array.isArray(saved) && saved.length > 0) return saved;
    }
    if (!userId || userId === curId) {
        const fallback = await DataStore.get<PremiumStory[]>(STORIES_KEY);
        return Array.isArray(fallback) ? fallback : [];
    }
    return [];
}

export async function saveLocalStories(stories: PremiumStory[]): Promise<void> {
    const uid = UserStore.getCurrentUser()?.id;
    if (uid) {
        await DataStore.set(`${STORIES_KEY}_${uid}`, stories);
    }
    await DataStore.set(STORIES_KEY, stories);
    void syncOwnDataToCloud();
}

export async function getLocalFavSongs(userId?: string): Promise<PremiumFavSong[]> {
    const curId = UserStore.getCurrentUser()?.id;
    const uid = userId || curId;
    if (uid) {
        const saved = await DataStore.get<PremiumFavSong[]>(`${FAV_SONGS_KEY}_${uid}`);
        if (Array.isArray(saved) && saved.length > 0) return saved;
    }
    if (!userId || userId === curId) {
        const fallback = await DataStore.get<PremiumFavSong[]>(FAV_SONGS_KEY);
        return Array.isArray(fallback) ? fallback : [];
    }
    return [];
}

export async function saveLocalFavSongs(songs: PremiumFavSong[]): Promise<void> {
    const uid = UserStore.getCurrentUser()?.id;
    if (uid) {
        await DataStore.set(`${FAV_SONGS_KEY}_${uid}`, songs);
    }
    await DataStore.set(FAV_SONGS_KEY, songs);
    void syncOwnDataToCloud();
}

export async function getLocalEffectsConfig(userId?: string): Promise<ProfileEffectsConfig> {
    const curId = UserStore.getCurrentUser()?.id;
    const uid = userId || curId;
    if (uid) {
        const saved = await DataStore.get<ProfileEffectsConfig>(`${EFFECTS_KEY}_${uid}`);
        if (saved) return { ...DEFAULT_EFFECTS_CONFIG, ...saved };
    }
    if (!userId || userId === curId) {
        const fallback = await DataStore.get<ProfileEffectsConfig>(EFFECTS_KEY);
        return { ...DEFAULT_EFFECTS_CONFIG, ...(fallback || {}) };
    }
    return DEFAULT_EFFECTS_CONFIG;
}

export async function saveLocalEffectsConfig(config: ProfileEffectsConfig): Promise<void> {
    const uid = UserStore.getCurrentUser()?.id;
    if (uid) {
        await DataStore.set(`${EFFECTS_KEY}_${uid}`, config);
    }
    await DataStore.set(EFFECTS_KEY, config);
    void syncOwnDataToCloud();
}

// ─── Cloud Sync via Nightcord OAuth2 ─────────────────────────────────────────

export const profileCache = new Map<string, { data: NightcordPremiumPayload | null; ts: number }>();
const CACHE_TTL_MS = 20 * 1000;

export async function syncOwnDataToCloud(): Promise<boolean> {
    const token = await getValidOAuthToken();
    if (!token) return false;

    const [stories, favSongs, effects, st] = await Promise.all([
        getLocalStories(),
        getLocalFavSongs(),
        getLocalEffectsConfig(),
        getPremiumSettings(),
    ]);

    const payload: NightcordPremiumPayload = {
        storiesEnabled: st.storiesEnabled,
        favSongsEnabled: st.favSongsEnabled,
        profileEffectsEnabled: st.profileEffectsEnabled,
        stories,
        favSongs,
        effects,
        updatedAt: Date.now(),
    };

    try {
        await saveOwnPluginConfig("nightcord_premium", token, payload as any);
        const curUser = UserStore.getCurrentUser();
        if (curUser?.id) {
            profileCache.set(curUser.id, { data: payload, ts: Date.now() });
        }
        return true;
    } catch (e) {
        console.warn("[NightcordPremium] Cloud sync write failed:", e);
        return false;
    }
}

export async function readUserPremiumData(userId: string): Promise<NightcordPremiumPayload | null> {
    const curUser = UserStore.getCurrentUser();
    const isSelf = curUser?.id && String(curUser.id) === String(userId);

    if (isSelf) {
        const [stories, favSongs, effects, st] = await Promise.all([
            getLocalStories(userId),
            getLocalFavSongs(userId),
            getLocalEffectsConfig(userId),
            getPremiumSettings(),
        ]);
        return {
            storiesEnabled: st.storiesEnabled,
            favSongsEnabled: st.favSongsEnabled,
            profileEffectsEnabled: st.profileEffectsEnabled,
            stories,
            favSongs,
            effects,
            updatedAt: Date.now(),
        };
    }

    const cached = profileCache.get(userId);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        return cached.data;
    }

    try {
        const remote = await getPublicPluginConfig("nightcord_premium", userId);
        const data = (remote && typeof remote === "object") ? (remote as NightcordPremiumPayload) : null;
        if (data) {
            profileCache.set(userId, { data, ts: Date.now() });
            return data;
        }
    } catch {}

    // Fallback: check if local storage has data specifically for this userId
    const [localStories, localSongs, localEffects] = await Promise.all([
        getLocalStories(userId),
        getLocalFavSongs(userId),
        getLocalEffectsConfig(userId),
    ]);
    if (localStories.length > 0 || localSongs.length > 0 || localEffects.enabled || (localEffects.nameEffect && localEffects.nameEffect !== "none")) {
        const fallbackData: NightcordPremiumPayload = {
            storiesEnabled: localStories.length > 0,
            favSongsEnabled: localSongs.length > 0,
            profileEffectsEnabled: localEffects.enabled || (localEffects.nameEffect && localEffects.nameEffect !== "none"),
            stories: localStories,
            favSongs: localSongs,
            effects: localEffects,
            updatedAt: Date.now(),
        };
        profileCache.set(userId, { data: fallbackData, ts: Date.now() });
        return fallbackData;
    }

    profileCache.set(userId, { data: null, ts: Date.now() });
    return null;
}

// ─── Imgur Hosting ───────────────────────────────────────────────────────────

const IMGUR_CLIENT_ID = "546c25a59c58ad7";

export async function uploadToImgur(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append("image", file);
    try {
        const res = await fetch("https://api.imgur.com/3/image", {
            method: "POST",
            headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
            body: formData,
        });
        const json = await res.json();
        return json?.data?.link ?? null;
    } catch {
        return null;
    }
}
