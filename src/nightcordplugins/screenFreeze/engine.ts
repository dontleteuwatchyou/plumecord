/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MediaEngineStore, UserStore, showToast, Toasts } from "@webpack/common";
import { ScreenFreezeState } from "./types";

type Listener = (state: ScreenFreezeState) => void;

interface FrozenVideoBackup {
    video: HTMLVideoElement;
    wasPaused: boolean;
}

class ScreenFreezeEngine {
    private isFrozen = false;
    private frozenTimestamp: number | undefined = undefined;
    private listeners = new Set<Listener>();

    private disabledTracks: MediaStreamTrack[] = [];
    private frozenVideos: FrozenVideoBackup[] = [];
    private broadcastStoppedConnections: any[] = [];
    private canvasOverlay: HTMLCanvasElement | null = null;

    public getState(): ScreenFreezeState {
        return {
            isFrozen: this.isFrozen,
            frozenTimestamp: this.frozenTimestamp,
            hasActiveStream: this.hasActiveStreamingConnection()
        };
    }

    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        const state = this.getState();
        this.listeners.forEach(l => l(state));
    }

    public hasActiveStreamingConnection(): boolean {
        try {
            const mediaEngine = (MediaEngineStore as any)?.getMediaEngine?.();
            if (mediaEngine?.connections) {
                for (const conn of mediaEngine.connections) {
                    if (conn.input?.stream || conn._input?.stream || conn.videoStreamParameters?.length > 0) {
                        return true;
                    }
                }
            }
        } catch { }
        return document.querySelectorAll("video").length > 0;
    }

    public toggleFreeze(): boolean {
        if (this.isFrozen) {
            this.unfreeze();
            return false;
        } else {
            this.freeze();
            return true;
        }
    }

    public freeze() {
        this.disabledTracks = [];
        this.broadcastStoppedConnections = [];
        this.frozenVideos = [];

        // 1. Freeze Discord Native MediaEngine Connections
        try {
            const mediaEngine = (MediaEngineStore as any)?.getMediaEngine?.();
            if (mediaEngine?.connections) {
                for (const conn of mediaEngine.connections) {
                    // Method A: Native Discord setVideoBroadcast(false) -> Freezes transmission on exact last frame in WebRTC
                    try {
                        if (typeof conn.setVideoBroadcast === "function") {
                            conn.setVideoBroadcast(false);
                            this.broadcastStoppedConnections.push(conn);
                        }
                    } catch (e) {
                        console.warn("[ScreenFreeze] setVideoBroadcast(false) error:", e);
                    }

                    // Method B: Stream Input Video Tracks
                    const stream = conn.input?.stream || conn._input?.stream;
                    if (stream && typeof stream.getVideoTracks === "function") {
                        for (const track of stream.getVideoTracks()) {
                            if (track.enabled) {
                                track.enabled = false;
                                this.disabledTracks.push(track);
                            }
                        }
                    }

                    // Method C: WebRTC RTCRtpSender Tracks
                    const pc: RTCPeerConnection = conn.pc || conn.peerConnection || conn._pc;
                    if (pc && typeof pc.getSenders === "function") {
                        for (const sender of pc.getSenders()) {
                            if (sender.track && sender.track.kind === "video") {
                                if (sender.track.enabled) {
                                    sender.track.enabled = false;
                                    this.disabledTracks.push(sender.track);
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error("[ScreenFreeze] MediaEngine freeze error:", e);
        }

        // 2. Pause and Freeze all local Discord video previews
        try {
            const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
            for (const vid of videos) {
                if (vid.videoWidth > 0 && !vid.paused) {
                    this.frozenVideos.push({
                        video: vid,
                        wasPaused: vid.paused
                    });
                    vid.pause();
                }
            }
        } catch { }

        this.isFrozen = true;
        this.frozenTimestamp = Date.now();
        this.notify();

        showToast("Screen Freeze ACTIVE - Screenshare is now frozen on this frame", Toasts.Type.DANGER);
    }

    public unfreeze() {
        // 1. Resume Discord Native MediaEngine Connections
        for (const conn of this.broadcastStoppedConnections) {
            try {
                if (typeof conn.setVideoBroadcast === "function") {
                    conn.setVideoBroadcast(true);
                }
            } catch (e) {
                console.warn("[ScreenFreeze] setVideoBroadcast(true) error:", e);
            }
        }
        this.broadcastStoppedConnections = [];

        // 2. Re-enable video tracks
        for (const track of this.disabledTracks) {
            try {
                track.enabled = true;
            } catch { }
        }
        this.disabledTracks = [];

        // 3. Unpause local Discord video previews
        for (const item of this.frozenVideos) {
            try {
                if (!item.wasPaused) {
                    item.video.play().catch(() => { });
                }
            } catch { }
        }
        this.frozenVideos = [];

        this.isFrozen = false;
        this.frozenTimestamp = undefined;
        this.notify();

        showToast("Screen Freeze OFF - Screenshare resumed live", Toasts.Type.SUCCESS);
    }

    public startPatch() {
        // Ready
    }

    public stopPatch() {
        if (this.isFrozen) {
            this.unfreeze();
        }
    }
}

export const screenFreezeEngine = new ScreenFreezeEngine();
