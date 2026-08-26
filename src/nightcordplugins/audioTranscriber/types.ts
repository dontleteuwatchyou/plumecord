/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface SubtitleEntry {
    id: string;
    userId?: string;
    username: string;
    avatarUrl?: string;
    text: string;
    isFinal: boolean;
    timestamp: number;
}

export type SubtitlePosition = "bottom" | "top";

export interface TranscriberSettings {
    language: string;
    fontSize: number; // 12 - 28
    bgOpacity: number; // 20 - 100
    fadeDelay: number; // 2 - 15 (seconds)
    showAvatar: boolean;
    showUsername: boolean;
    position: SubtitlePosition;
    alwaysOn: boolean;
}
