/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import {
    Button,
    React,
    showToast,
    Text,
    Toasts
} from "@webpack/common";
import { Card } from "@components/Card";
import { Flex, FlexAlign, FlexJustify } from "@components/Flex";
import { t } from "../autoTranslateNightcord";

const CSS_ID = "nightcord-lightcord-css";

const settings = definePluginSettings({
    disableBadges: {
        type: OptionType.BOOLEAN,
        description: "Hides badges on user profiles, cards, chat messages, and member lists.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    },
    disableActivities: {
        type: OptionType.BOOLEAN,
        description: "Hides playing, listening, streaming, voice status, and rich presence activities across member lists and profiles.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    },
    disableNametags: {
        type: OptionType.BOOLEAN,
        description: "Hides clan tags, guild badges, discriminator tags, and nameplate chips next to usernames.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    },
    disableQuestsAndShop: {
        type: OptionType.BOOLEAN,
        description: "Removes Quests, Shop, and Nitro tabs from the direct messages sidebar and hides quest popups.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    },
    disableChatSlop: {
        type: OptionType.BOOLEAN,
        description: "Removes the Nitro gift button and the App Launcher (Activities) button from the chat bar.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    },
    disableProfileEffects: {
        type: OptionType.BOOLEAN,
        description: "Removes avatar decorations, profile animation effects, nameplates, and banner effects.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    },
    disableReactionEffects: {
        type: OptionType.BOOLEAN,
        description: "Removes super reaction animations, glowing borders, and particle effects.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    },
    disableVoiceEffects: {
        type: OptionType.BOOLEAN,
        description: "Hides soundboard wave animations and voice call graphic effects.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    },
    disableNitroUpsells: {
        type: OptionType.BOOLEAN,
        description: "Removes server boost bars, nitro promotions, and upsell banners.",
        default: true,
        restartNeeded: false,
        onChange() { updateCssIfRunning(); }
    }
});

let isRunning = false;

function buildCss(): string {
    const rules: string[] = [];

    // 1. Badges
    if (settings.store.disableBadges) {
        rules.push(`
/* Lightcord: Badges */
[class*="badges-"],
[class*="badgeList-"],
[class*="profileBadges"],
[class*="badgeList_"],
[class*="badgeList"],
[class*="badges_"],
[class*="badgeContainer-"],
div[aria-label*="User Badges" i],
div[aria-label*="Badges de profil" i],
div[aria-label*="Badges de" i],
div[aria-label*="Badges" i],
[class*="member-"] [class*="badges-"],
[class*="member-"] [class*="badgeList-"],
.vc-sbic-badge {
    display: none !important;
}
`);
    }

    // 2. Activities on people
    if (settings.store.disableActivities) {
        rules.push(`
/* Lightcord: Activities */
[class*="activity-"],
[class*="activityText-"],
[class*="activityUserPopout-"],
[class*="userProfileActivity-"],
[class*="activityProfile-"],
[class*="hangStatus-"],
[class*="voiceUser-"] [class*="activity-"],
[class*="voiceUser-"] [class*="activityText-"],
[class*="member-"] [class*="subText-"]:has([class*="activity-"]),
[class*="member-"] [class*="subText-"]:has(svg[class*="icon-"]),
[class*="channel-"] [class*="subText-"]:has([class*="activity-"]),
[class*="channel-"] [class*="activityText-"] {
    display: none !important;
}
`);
    }

    // 3. Nametags / Clan tags / Discriminators
    if (settings.store.disableNametags) {
        rules.push(`
/* Lightcord: Nametags and Clan tags */
[class*="clanTag-"],
[class*="clanTagChip-"],
[class*="userTagClan-"],
[class*="clanTagContainer-"],
span:has(> [class*="clanTag-"]),
[class*="discriminator-"],
[class*="userTagDiscriminator-"],
[class*="headerTag-"] [class*="discriminator-"] {
    display: none !important;
}
`);
    }

    // 4. Quests, Shop, Nitro Home
    if (settings.store.disableQuestsAndShop) {
        rules.push(`
/* Lightcord: Quests, Shop, Nitro Home */
li:has(a[href="/shop"]),
a[href="/shop"],
[data-list-item-id*="shop"],
[data-list-item-id*="discord-shop"],
li:has(a[href="/nitro"]),
a[href="/nitro"],
[data-list-item-id*="nitro"],
li:has(a[href="/quest-home"]),
a[href="/quest-home"],
[data-list-item-id*="quests"],
[data-list-item-id*="quest-home"],
li:has(a[href="/discovery"]),
a[href="/discovery"],
[class*="questBar-"],
[class*="questBarWrapper-"],
[class*="questProgress-"],
[class*="questsCard-"],
[class*="questCard-"],
[class*="questDeliveryContainer-"],
[class*="questNotice-"],
div:has(> [class*="questBar-"]) {
    display: none !important;
}
`);
    }

    // 5. Chat Bar Slop (Gift button, App launcher)
    if (settings.store.disableChatSlop) {
        rules.push(`
/* Lightcord: Chat Bar Gift & App Launcher */
button[aria-label*="Gift" i],
button[aria-label*="Cadeau" i],
button[aria-label*="App Launcher" i],
button[aria-label*="Applications" i],
[class*="channelAppLauncher"],
[class*="channelTextArea-"] button:has(svg path[d*="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H4V6Zm16 4H4v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8Z"]) {
    display: none !important;
}
`);
    }

    // 6. Profile Effects & Avatar Decorations
    if (settings.store.disableProfileEffects) {
        rules.push(`
/* Lightcord: Profile Effects, Avatar Decorations, Nameplates */
[class*="avatarDecoration-"],
svg[class*="avatarDecoration-"],
img[class*="avatarDecoration-"],
[class*="avatarDecorationHint-"],
[class*="avatarStack-"] > [class*="avatarDecoration-"],
[class*="profileEffects-"],
[class*="profileEffectBackground-"],
[class*="profileEffect-"],
canvas[class*="profileEffect"],
[class*="animationWrapper-"] > [class*="profileEffect-"],
[class*="nameplate-"],
div[class*="nameplate-"],
[class*="bannerEffects-"],
[class*="profileBanner-"] video {
    display: none !important;
}
`);
    }

    // 7. Super Reactions & Reaction Effects
    if (settings.store.disableReactionEffects) {
        rules.push(`
/* Lightcord: Super Reactions & Burst Glow */
[class*="burstGlow-"],
[class*="burstReaction-"],
[class*="effects-"],
[class*="burstEffect-"],
[class*="reactionInner-"][class*="burst-"]::before,
[class*="reactionInner-"][class*="burst-"]::after {
    display: none !important;
    animation: none !important;
}
`);
    }

    // 8. Voice Call & Soundboard Effects
    if (settings.store.disableVoiceEffects) {
        rules.push(`
/* Lightcord: Soundboard waves & animations */
[class*="soundboardWave-"],
[class*="wave-"][class*="soundboard"] {
    display: none !important;
}
`);
    }

    // 9. Nitro Upsells & Server Boost Bar
    if (settings.store.disableNitroUpsells) {
        rules.push(`
/* Lightcord: Nitro Upsells & Boost Bar */
[class*="boostBar-"],
[class*="serverBoostNotice-"],
[class*="premiumUpsell-"],
[class*="upsellBanner-"],
[class*="nitroUpsell-"],
[class*="tierUpsell-"] {
    display: none !important;
}
`);
    }

    return rules.join("\n");
}

function updateCssIfRunning() {
    if (!isRunning) return;
    const css = buildCss();
    let style = document.getElementById(CSS_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement("style");
        style.id = CSS_ID;
        document.head?.appendChild(style);
    }
    style.textContent = css;
}

function removeCss() {
    const style = document.getElementById(CSS_ID);
    if (style) {
        style.remove();
    }
}

function LightcordSettingsAbout() {
    const handleEnableAll = () => {
        settings.store.disableBadges = true;
        settings.store.disableActivities = true;
        settings.store.disableNametags = true;
        settings.store.disableQuestsAndShop = true;
        settings.store.disableChatSlop = true;
        settings.store.disableProfileEffects = true;
        settings.store.disableReactionEffects = true;
        settings.store.disableVoiceEffects = true;
        settings.store.disableNitroUpsells = true;
        updateCssIfRunning();
        showToast(t("All Lightcord optimizations enabled"), Toasts.Type.SUCCESS);
    };

    const handleRestoreDefaults = () => {
        settings.store.disableBadges = true;
        settings.store.disableActivities = true;
        settings.store.disableNametags = true;
        settings.store.disableQuestsAndShop = true;
        settings.store.disableChatSlop = true;
        settings.store.disableProfileEffects = true;
        settings.store.disableReactionEffects = true;
        settings.store.disableVoiceEffects = true;
        settings.store.disableNitroUpsells = true;
        updateCssIfRunning();
        showToast(t("Lightcord settings restored to default"), Toasts.Type.SUCCESS);
    };

    return (
        <Card style={{ padding: "16px 20px", backgroundColor: "var(--background-secondary)", borderRadius: 8, marginBottom: 16 }}>
            <Flex justify={FlexJustify.BETWEEN} align={FlexAlign.CENTER} style={{ gap: 16 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        backgroundColor: "var(--background-floating)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0
                    }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                            <path
                                d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2Z"
                                stroke="var(--brand-500)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                    <div>
                        <Text variant="text-md/bold" style={{ color: "var(--header-primary)", marginBottom: 4 }}>
                            {t("Lightcord Mode Active")}
                        </Text>
                        <Text variant="text-sm/normal" style={{ color: "var(--text-muted)", lineHeight: "18px" }}>
                            {t("All bloat, badges, activities, and visual slop are stripped from Discord.")}
                        </Text>
                    </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.BRAND}
                        onClick={handleEnableAll}
                    >
                        {t("Enable All Optimizations")}
                    </Button>
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.PRIMARY}
                        onClick={handleRestoreDefaults}
                    >
                        {t("Restore Defaults")}
                    </Button>
                </div>
            </Flex>
        </Card>
    );
}

export default definePlugin({
    name: "Lightcord",
    description: "Lightweight Discord experience: removes badges, member activities, nametags, Discord slop (Quests, Shop, Nitro Home), profile effects, avatar decorations, and bloat animations.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: LightcordSettingsAbout,

    start() {
        isRunning = true;
        updateCssIfRunning();
    },

    stop() {
        isRunning = false;
        removeCss();
    }
});
