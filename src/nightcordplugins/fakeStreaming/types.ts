/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type StreamTarget = "both" | "camera" | "screenshare";

export interface FakeStreamConfig {
    videoUrl: string;
    videoName: string;
    target: StreamTarget;
    includeAudio: boolean;
    loop: boolean;
    playbackRate: number;
    volume: number;
    active: boolean;
}
