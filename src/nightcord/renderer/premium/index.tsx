/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import SettingsPlugin from "@plugins/_core/settings";
import { removeFromArray } from "@utils/misc";
import { React, UserStore } from "@webpack/common";

import { NightcordPremiumDashboard } from "./components/NightcordPremiumDashboard";
import { FavSongsProfileTab } from "./favSongs/FavSongsProfileTab";
import { startProfileEffects, stopProfileEffects } from "./profileEffects/effectsManager";
import { startStories, stopStories } from "./stories/storiesManager";
import { StoryGallery } from "./stories/StoryGallery";
import {
    getCachedPremiumSettings,
    getPremiumSettings,
    readUserPremiumData,
    subscribePremiumSettings
} from "./sync";

export const SETTINGS_ENTRY_KEY = "nightcord_premium";

export const PremiumSparkleIcon = ({ width = 20, height = 20 }: { width?: number; height?: number; }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        <path d="M5 3v4" />
        <path d="M19 17v4" />
        <path d="M3 5h4" />
        <path d="M17 19h4" />
    </svg>
);

export function isNightcordPremiumEnabled(): boolean {
    const st = getCachedPremiumSettings();
    return st.enabled;
}

export function pushPremiumSections(sections: any[], user: any) {
    try {
        if (!user || !Array.isArray(sections)) return;
        const st = getCachedPremiumSettings();
        if (!st.enabled) return;

        if (sections.some(s => s?.section === "MY_STORY" || s?.section === "FAV_SONGS")) return;

        const currentUserId = UserStore.getCurrentUser()?.id;
        const isSelf = user.id && String(user.id) === String(currentUserId);

        if (isSelf) {
            if (st.favSongsEnabled) {
                sections.unshift({ text: "My Fav Song", section: "FAV_SONGS" });
            }
            if (st.storiesEnabled) {
                sections.unshift({ text: "My Story", section: "MY_STORY" });
            }
        } else {
            // Asynchronously pre-fetch remote data; cached return handles current frame
            void readUserPremiumData(user.id).then(data => {
                if (!data) return;
                let changed = false;
                if (data.favSongsEnabled !== false && Array.isArray(data.favSongs) && data.favSongs.length > 0) {
                    if (!sections.some(s => s?.section === "FAV_SONGS")) {
                        sections.unshift({ text: "My Fav Song", section: "FAV_SONGS" });
                        changed = true;
                    }
                }
                if (data.storiesEnabled !== false && Array.isArray(data.stories) && data.stories.length > 0) {
                    if (!sections.some(s => s?.section === "MY_STORY")) {
                        sections.unshift({ text: "My Story", section: "MY_STORY" });
                        changed = true;
                    }
                }
                if (changed) {
                    try {
                        const { FluxDispatcher } = Vencord.Webpack.Common;
                        FluxDispatcher?.dispatch?.({
                            type: "USER_PROFILE_MODAL_OPEN",
                            userId: user.id,
                            section: "ACTIVITY"
                        });
                    } catch {}
                }
            });
        }
    } catch (e) {
        console.error("[NightcordPremium] pushPremiumSections error:", e);
    }
}

export function renderPremiumTab(section: string, props: any) {
    if (section === "MY_STORY") {
        return <StoryGallery user={props.user} />;
    }
    if (section === "FAV_SONGS") {
        return <FavSongsProfileTab user={props.user} />;
    }
    return null;
}

function syncSidebarEntry(enabled: boolean) {
    while (SettingsPlugin.customEntries.some(e => e.key === SETTINGS_ENTRY_KEY)) {
        removeFromArray(SettingsPlugin.customEntries, e => e.key === SETTINGS_ENTRY_KEY);
    }

    if (enabled) {
        SettingsPlugin.customEntries.push({
            key: SETTINGS_ENTRY_KEY,
            title: "Nightcord Premium",
            Component: ErrorBoundary.wrap(NightcordPremiumDashboard, { noop: true }),
            Icon: PremiumSparkleIcon,
        });
    }
}

export async function initPremium() {
    const st = await getPremiumSettings();

    syncSidebarEntry(st.enabled);

    if (st.enabled) {
        if (st.storiesEnabled) startStories();
        if (st.profileEffectsEnabled) startProfileEffects();
    }

    subscribePremiumSettings(next => {
        syncSidebarEntry(next.enabled);
        if (!next.enabled) {
            stopStories();
            stopProfileEffects();
        } else {
            if (next.storiesEnabled) startStories();
            else stopStories();

            if (next.profileEffectsEnabled) startProfileEffects();
            else stopProfileEffects();
        }
    });
}
