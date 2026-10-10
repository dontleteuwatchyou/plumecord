/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface PremiumStory {
    id: string;
    url: string;
    type: "image" | "video";
    timestamp: number;
    isHighlight: boolean;
    soundcloudUrl?: string;
    startTime?: number;
}

export interface PremiumFavSong {
    id: string;
    title: string;
    artist: string;
    artworkUrl: string;
    url: string;
    type: "soundcloud" | "local";
    duration?: number;
}

export interface ProfileEffectsConfig {
    enabled?: boolean;
    mode: "preset" | "gif";
    presetName: string;
    showBanner: boolean;
    gifUrl: string;
    gifOpacity: number;
    gifFit: "cover" | "contain" | "fill";
    gifBgColor: string;
    gifBlendMode: string;
    nameEffect: "none" | "glow" | "glitch" | "rainbow" | "type";
    glowColor: string;
    chatUsernameEffect: "none" | "glow" | "glitch" | "rainbow" | "type";
    memberListEffect: "none" | "glow" | "glitch" | "rainbow" | "type";
}

export interface NightcordPremiumPayload {
    storiesEnabled: boolean;
    favSongsEnabled: boolean;
    profileEffectsEnabled: boolean;
    stories: PremiumStory[];
    favSongs: PremiumFavSong[];
    effects?: Partial<ProfileEffectsConfig>;
    updatedAt: number;
}

export interface NightcordPremiumSettings {
    enabled: boolean;
    storiesEnabled: boolean;
    favSongsEnabled: boolean;
    profileEffectsEnabled: boolean;
}
