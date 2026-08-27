/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MediaEngineStore, UserStore, showToast, Toasts } from "@webpack/common";
import { ScreenFreezeState } from "./types";

type Listener = (state: ScreenFreezeState) => void;

interface FrozenVideoElementBackup {
    element: HTMLVideoElement;
    originalSrcObject: MediaStream | null;
    wasPaused: boolean;
}

class ScreenFreezeEngine {
    private isFrozen = false;
    private frozenTimestamp: number | undefined = undefined;
    private listeners = new Set<Listener>();

    private originalLiveTrack: MediaStreamTrack | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private canvasCtx: CanvasRenderingContext2D | null = null;
    private loopInterval: ReturnType<typeof setInterval> | null = null;
    private frozenTrack: MediaStreamTrack | null = null;
    private frozenVideos: FrozenVideoElementBackup[] = [];

    public getState(): ScreenFreezeState {
        return {
            isFrozen: this.isFrozen,
            frozenTimestamp: this.frozenTimestamp,
            hasActiveStream: this.getActiveMediaStream() !== null || document.querySelectorAll("video").length > 0
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

    private initCanvas() {
        if (typeof document === "undefined") return;
        if (!this.canvas) {
            this.canvas = document.createElement("canvas");
            this.canvas.width = 1920;
            this.canvas.height = 1080;
            this.canvasCtx = this.canvas.getContext("2d", { alpha: false });
        }
    }

    public getActiveMediaStream(): MediaStream | null {
        try {
            const mediaEngine = (MediaEngineStore as any)?.getMediaEngine?.();
            if (mediaEngine?.connections) {
                const myId = UserStore.getCurrentUser()?.id;
                for (const conn of mediaEngine.connections) {
                    if (!myId || conn.streamUserId === myId || !conn.streamUserId) {
                        const stream = conn.input?.stream || conn._input?.stream;
                        if (stream && stream.getVideoTracks().length > 0) {
                            return stream;
                        }
                    }
                }
                for (const conn of mediaEngine.connections) {
                    const stream = conn.input?.stream || conn._input?.stream;
                    if (stream && stream.getVideoTracks().length > 0) {
                        return stream;
                    }
                }
            }
        } catch { }
        return null;
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
        this.initCanvas();
        if (!this.canvas || !this.canvasCtx) return;

        // 1. Find the best video source to grab frame from
        const allVideos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
        let sourceVideo: HTMLVideoElement | null = null;

        for (const vid of allVideos) {
            if (vid.videoWidth > 0 && vid.videoHeight > 0 && !vid.paused) {
                sourceVideo = vid;
                break;
            }
        }

        // 2. Get active stream track
        const activeStream = this.getActiveMediaStream();
        if (activeStream) {
            this.originalLiveTrack = activeStream.getVideoTracks()[0] || null;
        }

        // 3. Draw frame onto canvas
        if (sourceVideo && sourceVideo.videoWidth > 0) {
            this.canvas.width = sourceVideo.videoWidth;
            this.canvas.height = sourceVideo.videoHeight;
            try {
                this.canvasCtx.drawImage(sourceVideo, 0, 0, this.canvas.width, this.canvas.height);
            } catch (e) {
                console.warn("[ScreenFreeze] drawImage error:", e);
            }
        } else {
            // Draw a neutral frame
            this.canvasCtx.fillStyle = "#1e1f22";
            this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // 4. Start 30fps broadcast loop to keep static image alive in WebRTC
        if (this.loopInterval) clearInterval(this.loopInterval);
        this.loopInterval = setInterval(() => {
            if (this.canvas && this.canvasCtx) {
                // Keep the static frame rendered
            }
        }, 1000 / 30);

        // 5. Generate frozen WebRTC track
        const frozenStream = (this.canvas as any).captureStream ? (this.canvas as any).captureStream(30) : null;
        if (frozenStream && frozenStream.getVideoTracks().length > 0) {
            this.frozenTrack = frozenStream.getVideoTracks()[0];
        }

        // 6. Swap WebRTC tracks in Discord MediaEngine senders
        if (this.frozenTrack) {
            this.replaceWebRtcTracks(this.frozenTrack);
        }

        // 7. Freeze all local preview videos so the screen is completely frozen on your end too
        this.frozenVideos = [];
        for (const vid of allVideos) {
            if (vid.videoWidth > 0) {
                this.frozenVideos.push({
                    element: vid,
                    originalSrcObject: (vid.srcObject as MediaStream) || null,
                    wasPaused: vid.paused
                });
                try {
                    vid.pause();
                } catch { }
            }
        }

        this.isFrozen = true;
        this.frozenTimestamp = Date.now();
        this.notify();

        showToast("Screen Freeze ACTIVE - Screenshare is now frozen on this frame", Toasts.Type.DANGER);
    }

    public unfreeze() {
        if (this.loopInterval) {
            clearInterval(this.loopInterval);
            this.loopInterval = null;
        }

        // 1. Restore original WebRTC live track
        let liveTrack = this.originalLiveTrack;
        if (!liveTrack || liveTrack.readyState !== "live") {
            const activeStream = this.getActiveMediaStream();
            if (activeStream) {
                liveTrack = activeStream.getVideoTracks()[0] || null;
            }
        }

        if (liveTrack) {
            this.replaceWebRtcTracks(liveTrack);
        }

        // 2. Unpause and restore local video elements
        for (const item of this.frozenVideos) {
            try {
                if (item.originalSrcObject && item.element.srcObject !== item.originalSrcObject) {
                    item.element.srcObject = item.originalSrcObject;
                }
                if (!item.wasPaused) {
                    item.element.play().catch(() => { });
                }
            } catch { }
        }
        this.frozenVideos = [];

        // 3. Stop frozen track
        if (this.frozenTrack) {
            try { this.frozenTrack.stop(); } catch { }
            this.frozenTrack = null;
        }
        this.originalLiveTrack = null;

        this.isFrozen = false;
        this.frozenTimestamp = undefined;
        this.notify();

        showToast("Screen Freeze OFF - Screenshare resumed live", Toasts.Type.SUCCESS);
    }

    private replaceWebRtcTracks(newTrack: MediaStreamTrack) {
        try {
            const mediaEngine = (MediaEngineStore as any)?.getMediaEngine?.();
            if (mediaEngine?.connections) {
                for (const conn of mediaEngine.connections) {
                    // Method 1: RTCPeerConnection Senders
                    const pc: RTCPeerConnection = conn.pc || conn.peerConnection || conn._pc;
                    if (pc && typeof pc.getSenders === "function") {
                        for (const sender of pc.getSenders()) {
                            if (sender.track && sender.track.kind === "video") {
                                sender.replaceTrack(newTrack).catch(() => { });
                            }
                        }
                    }

                    // Method 2: MediaStream input tracks
                    const input = conn.input || conn._input;
                    if (input?.stream) {
                        const oldTracks = input.stream.getVideoTracks();
                        for (const ot of oldTracks) {
                            if (ot !== newTrack) {
                                input.stream.removeTrack(ot);
                            }
                        }
                        if (!input.stream.getVideoTracks().includes(newTrack)) {
                            input.stream.addTrack(newTrack);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("[ScreenFreeze] replaceWebRtcTracks error:", e);
        }
    }
}

export const screenFreezeEngine = new ScreenFreezeEngine();
