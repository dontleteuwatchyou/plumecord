/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { t } from "@api/i18n";
import { addPatch } from "@api/PluginManager";
import { React, UserStore } from "@webpack/common";

import { CustomizationTab } from "./CustomizationTab";
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

export { CustomizationTab };

export const CustomizationIcon = ({ width = 24, height = 24, className, ...props }: any) => (
    <svg
        className={`vc-ic-save-icon ${className ?? ""}`}
        aria-hidden="true"
        role="img"
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        fill="none"
        viewBox="0 0 24 24"
        {...props}
    >
        <path
            fill="currentColor"
            d="m9.17 12.67 2.16 2.16a1 1 0 0 0 .99.25l2.57-.75A3 3 0 0 0 16.6 13l4.91-8.05a1.8 1.8 0 0 0-2.47-2.47L11 7.39a3 3 0 0 0-1.32 1.72l-.75 2.57a1 1 0 0 0 .25.99ZM8.03 13.14c.27.07.51.23.7.43l1.7 1.7c.2.19.36.43.43.7A4 4 0 0 1 7 21H2a1 1 0 1 1 0-2c.68 0 1.13-.77 1.04-1.44a4 4 0 0 1 5-4.42Z"
        />
    </svg>
);

export function isCustomizationEnabled(): boolean {
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
                sections.unshift({ text: t("Song"), section: "FAV_SONGS" });
            }
            if (st.storiesEnabled) {
                sections.unshift({ text: t("Story"), section: "MY_STORY" });
            }
        } else {
            void readUserPremiumData(user.id).then(data => {
                if (!data) return;
                let changed = false;
                if (data.favSongsEnabled !== false && Array.isArray(data.favSongs) && data.favSongs.length > 0) {
                    if (!sections.some(s => s?.section === "FAV_SONGS")) {
                        sections.unshift({ text: t("Song"), section: "FAV_SONGS" });
                        changed = true;
                    }
                }
                if (data.storiesEnabled !== false && Array.isArray(data.stories) && data.stories.length > 0) {
                    if (!sections.some(s => s?.section === "MY_STORY")) {
                        sections.unshift({ text: t("Story"), section: "MY_STORY" });
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
        console.error("[NightcordCustomization] pushPremiumSections error:", e);
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

let patchesRegistered = false;
export function registerCustomizationPatches() {
    if (patchesRegistered) return;
    patchesRegistered = true;

    const globals = {
        pushPremiumSections,
        renderPremiumTab
    };

    (window as any).NightcordCustomizationGlobals = globals;
    if (typeof Vencord !== "undefined") {
        (Vencord as any).Customization = globals;
    }

    addPatch({
        find: "#{intl::USER_PROFILE_ACTIVITY}",
        replacement: {
            match: /(\i)\.id!==\i\?\.id&&\i&&\(.{0,300}\.MUTUAL_GUILDS\}\)\)(?=,(\i))/,
            replace: "$&,NightcordCustomizationGlobals.pushPremiumSections($2,$1)",
        }
    }, "NightcordCustomization", "NightcordCustomizationGlobals");

    addPatch({
        find: ".WIDGETS?",
        replacement: {
            match: /(\i)===\i\.\i\.WISHLIST/,
            replace: "$1===\"MY_STORY\"||$1===\"FAV_SONGS\"?NightcordCustomizationGlobals.renderPremiumTab($1,arguments[0]):$&",
        }
    }, "NightcordCustomization", "NightcordCustomizationGlobals");
}

let initialized = false;
export async function initCustomization() {
    if (initialized) return;
    initialized = true;

    registerCustomizationPatches();

    const st = await getPremiumSettings();

    if (st.enabled) {
        if (st.storiesEnabled) startStories();
        if (st.profileEffectsEnabled) startProfileEffects();
    }

    subscribePremiumSettings(next => {
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
