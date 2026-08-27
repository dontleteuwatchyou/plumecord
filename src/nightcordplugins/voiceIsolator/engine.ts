/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, MediaEngineStore, SelectedChannelStore, UserStore, VoiceStateStore, showToast, Toasts } from "@webpack/common";
import { VoiceIsolatorState } from "./types";

type Listener = (state: VoiceIsolatorState) => void;

class VoiceIsolatorEngine {
    private state: VoiceIsolatorState = {
        isolatedUserId: null,
        isolatedUserName: null,
        isolatedUserAvatar: null,
        channelId: null,
        originalVolumes: {}
    };

    private listeners = new Set<Listener>();

    public getState(): VoiceIsolatorState {
        return { ...this.state, originalVolumes: { ...this.state.originalVolumes } };
    }

    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        const s = this.getState();
        this.listeners.forEach(l => l(s));
    }

    public setLocalUserVolume(userId: string, volume: number, mute: boolean = false) {
        try {
            FluxDispatcher.dispatch({
                type: "AUDIO_SET_LOCAL_VOLUME",
                context: "default",
                userId,
                volume
            });
        } catch { }

        try {
            FluxDispatcher.dispatch({
                type: "AUDIO_SET_LOCAL_MUTE",
                context: "default",
                userId,
                mute
            });
        } catch { }

        try {
            const mediaEngine = (MediaEngineStore as any)?.getMediaEngine?.();
            if (mediaEngine) {
                if (typeof mediaEngine.setLocalVolume === "function") {
                    mediaEngine.setLocalVolume(userId, volume);
                }
                if (typeof mediaEngine.setLocalMute === "function") {
                    mediaEngine.setLocalMute(userId, mute);
                }
            }
        } catch { }
    }

    public isolateUser(
        targetUserId: string,
        opts: {
            attenuationVolume?: number;
            boostTarget?: boolean;
            targetVolume?: number;
        } = {}
    ) {
        const currentChannelId = SelectedChannelStore.getVoiceChannelId();
        if (!currentChannelId) {
            showToast("You must be in a voice channel to isolate voice", Toasts.Type.DANGER);
            return;
        }

        const myId = UserStore.getCurrentUser()?.id;
        const targetUser = UserStore.getUser(targetUserId);
        const targetName = (targetUser as any)?.globalName || (targetUser as any)?.global_name || targetUser?.username || "Target";
        const targetAvatar = targetUser?.avatar
            ? `https://cdn.discordapp.com/avatars/${targetUserId}/${targetUser.avatar}.webp?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(targetUserId) >> 22n) % 6}.png`;

        const attenuation = opts.attenuationVolume !== undefined ? opts.attenuationVolume : 5;
        const targetVol = opts.boostTarget ? (opts.targetVolume || 150) : 100;

        const originalVolumesBackup: Record<string, number> = {};

        // Get all users in the channel
        const voiceStates = VoiceStateStore.getVoiceStatesForChannel(currentChannelId) || {};
        let userIds = Object.keys(voiceStates);

        if (userIds.length === 0) {
            const allStates = (VoiceStateStore as any).getAllVoiceStates?.() || {};
            userIds = Object.entries(allStates)
                .filter(([_, st]: any) => st?.channelId === currentChannelId)
                .map(([uid]) => uid);
        }

        for (const uid of userIds) {
            if (uid === myId) continue;

            const curVol = (MediaEngineStore as any)?.getLocalVolume?.(uid) ?? 100;
            originalVolumesBackup[uid] = curVol;

            if (uid === targetUserId) {
                this.setLocalUserVolume(uid, targetVol, false);
            } else {
                const shouldMute = attenuation === 0;
                this.setLocalUserVolume(uid, attenuation, shouldMute);
            }
        }

        this.state = {
            isolatedUserId: targetUserId,
            isolatedUserName: targetName,
            isolatedUserAvatar: targetAvatar,
            channelId: currentChannelId,
            originalVolumes: originalVolumesBackup
        };

        this.notify();
        showToast(`Voice Isolated: Hearing only @${targetName}`, Toasts.Type.SUCCESS);
    }

    public restoreAll() {
        if (!this.state.isolatedUserId && Object.keys(this.state.originalVolumes).length === 0) return;

        // Restore everyone's volume and unmute
        for (const [uid, origVol] of Object.entries(this.state.originalVolumes)) {
            this.setLocalUserVolume(uid, origVol, false);
        }

        // Restore target user volume
        if (this.state.isolatedUserId) {
            const targetOrig = this.state.originalVolumes[this.state.isolatedUserId] ?? 100;
            this.setLocalUserVolume(this.state.isolatedUserId, targetOrig, false);
        }

        this.state = {
            isolatedUserId: null,
            isolatedUserName: null,
            isolatedUserAvatar: null,
            channelId: null,
            originalVolumes: {}
        };

        this.notify();
        showToast("Voice Isolation OFF - All volumes restored", Toasts.Type.INFO);
    }

    public toggleIsolate(
        targetUserId: string,
        opts: {
            attenuationVolume?: number;
            boostTarget?: boolean;
            targetVolume?: number;
        } = {}
    ) {
        if (this.state.isolatedUserId === targetUserId) {
            this.restoreAll();
        } else {
            if (this.state.isolatedUserId) {
                this.restoreAll();
            }
            this.isolateUser(targetUserId, opts);
        }
    }

    public handleVoiceStateUpdate(state: any, opts: { attenuationVolume?: number; } = {}) {
        if (!this.state.isolatedUserId || !this.state.channelId) return;

        const uid = state.userId || state.user_id;
        const channelId = state.channelId !== undefined ? state.channelId : state.channel_id;
        const myId = UserStore.getCurrentUser()?.id;

        if (channelId === this.state.channelId && uid !== myId && uid !== this.state.isolatedUserId) {
            if (!(uid in this.state.originalVolumes)) {
                const curVol = (MediaEngineStore as any)?.getLocalVolume?.(uid) ?? 100;
                this.state.originalVolumes[uid] = curVol;
                const attenuation = opts.attenuationVolume !== undefined ? opts.attenuationVolume : 5;
                const shouldMute = attenuation === 0;
                this.setLocalUserVolume(uid, attenuation, shouldMute);
                this.notify();
            }
        }
    }

    public handleChannelChange(newChannelId: string | null) {
        if (this.state.isolatedUserId && this.state.channelId !== newChannelId) {
            this.restoreAll();
        }
    }
}

export const voiceIsolatorEngine = new VoiceIsolatorEngine();
