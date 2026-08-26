/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface VoiceIsolatorState {
    isolatedUserId: string | null;
    isolatedUserName: string | null;
    isolatedUserAvatar: string | null;
    channelId: string | null;
    originalVolumes: Record<string, number>;
}
