/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MediaEngineStore, showToast, Toasts } from "@webpack/common";
import { ScreenFreezeState } from "./types";

type Listener = (state: ScreenFreezeState) => void;

class ScreenFreezeEngine {
    private isFrozen = false;
    private frozenTimestamp: number | undefined = undefined;
    private listeners = new Set<Listener>();

    private activeLiveStreams = new Set<MediaStream>();
    private activeSenders: any[] = [];
    private originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;
    private originalPrototypeGetUserMedia: any = null;

    private captureVideo: HTMLVideoElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private canvasCtx: CanvasRenderingContext2D | null = null;
    private loopInterval: ReturnType<typeof setInterval> | null = null;
    private frozenTrack: MediaStreamTrack | null = null;
    private isPatched = false;

    constructor() {
        // Lazy init
    }

    public getState(): ScreenFreezeState {
        return {
            isFrozen: this.isFrozen,
            frozenTimestamp: this.frozenTimestamp,
            hasActiveStream: this.activeLiveStreams.size > 0
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

    private initElements() {
        if (typeof document === "undefined") return;
        if (this.captureVideo && this.canvas) return;

        try {
            const video = document.createElement("video");
            video.id = "nc-screen-freeze-capture";
            video.style.position = "fixed";
            video.style.left = "-9999px";
            video.style.top = "-9999px";
            video.style.opacity = "0.01";
            video.style.pointerEvents = "none";
            video.muted = true;
            video.playsInline = true;

            const canvas = document.createElement("canvas");
            canvas.style.position = "fixed";
            canvas.style.left = "-9999px";
            canvas.style.top = "-9999px";
            canvas.style.opacity = "0.01";
            canvas.style.pointerEvents = "none";
            canvas.width = 1920;
            canvas.height = 1080;

            const mount = document.body || document.documentElement;
            if (mount) {
                mount.appendChild(video);
                mount.appendChild(canvas);
            }

            this.captureVideo = video;
            this.canvas = canvas;
            this.canvasCtx = canvas.getContext("2d");
        } catch (e) {
            console.error("[ScreenFreeze] Init elements error:", e);
        }
    }

    public startPatch() {
        if (this.isPatched || !navigator.mediaDevices) return;

        this.initElements();
        this.originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const MediaDevicesProto = Object.getPrototypeOf(navigator.mediaDevices);
        if (MediaDevicesProto && MediaDevicesProto.getUserMedia) {
            this.originalPrototypeGetUserMedia = MediaDevicesProto.getUserMedia;
        }

        const self = this;

        const patchedGetUserMedia = async function (constraints: MediaStreamConstraints | undefined) {
            const stream = await self.originalGetUserMedia!.call(navigator.mediaDevices, constraints);

            if (stream && stream.getVideoTracks().length > 0) {
                self.registerActiveStream(stream);
            }

            return stream;
        };

        navigator.mediaDevices.getUserMedia = patchedGetUserMedia;
        if (MediaDevicesProto) {
            MediaDevicesProto.getUserMedia = patchedGetUserMedia;
        }

        this.isPatched = true;
    }

    public stopPatch() {
        if (this.isFrozen) {
            this.unfreeze();
        }

        if (this.isPatched) {
            if (this.originalGetUserMedia && navigator.mediaDevices) {
                navigator.mediaDevices.getUserMedia = this.originalGetUserMedia;
            }
            const MediaDevicesProto = Object.getPrototypeOf(navigator.mediaDevices);
            if (MediaDevicesProto && this.originalPrototypeGetUserMedia) {
                MediaDevicesProto.getUserMedia = this.originalPrototypeGetUserMedia;
            }
            this.isPatched = false;
        }

        this.activeLiveStreams.clear();
        this.activeSenders = [];
    }

    private registerActiveStream(stream: MediaStream) {
        this.activeLiveStreams.add(stream);

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            this.initElements();
            if (this.captureVideo) {
                this.captureVideo.srcObject = new MediaStream([videoTrack]);
                this.captureVideo.play().catch(() => { });
            }

            videoTrack.addEventListener("ended", () => {
                this.activeLiveStreams.delete(stream);
                if (this.activeLiveStreams.size === 0 && this.isFrozen) {
                    this.unfreeze();
                }
                this.notify();
            });
        }

        this.notify();
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
        this.initElements();
        if (!this.captureVideo || !this.canvas || !this.canvasCtx) return;

        // 1. Capture current frame from video onto canvas
        if (this.captureVideo.videoWidth > 0 && this.captureVideo.videoHeight > 0) {
            this.canvas.width = this.captureVideo.videoWidth;
            this.canvas.height = this.captureVideo.videoHeight;
            this.canvasCtx.drawImage(this.captureVideo, 0, 0, this.canvas.width, this.canvas.height);
        } else {
            // Draw dark frame if video has no dimensions
            this.canvasCtx.fillStyle = "#1e1f22";
            this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // 2. Start continuous 30fps canvas broadcast loop
        if (this.loopInterval) clearInterval(this.loopInterval);
        this.loopInterval = setInterval(() => {
            if (this.canvas && this.canvasCtx && this.captureVideo) {
                // Keep the static frame rendered
            }
        }, 1000 / 30);

        // 3. Generate frozen track
        const frozenStream = (this.canvas as any).captureStream ? (this.canvas as any).captureStream(30) : null;
        if (frozenStream && frozenStream.getVideoTracks().length > 0) {
            this.frozenTrack = frozenStream.getVideoTracks()[0];
        }

        // 4. Swap tracks on active WebRTC senders in Discord MediaEngine
        this.replaceWebRtcTracks(this.frozenTrack);

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

        // Restore original live tracks on active WebRTC senders
        let liveTrack: MediaStreamTrack | null = null;
        for (const stream of this.activeLiveStreams) {
            const track = stream.getVideoTracks()[0];
            if (track && track.readyState === "live") {
                liveTrack = track;
                break;
            }
        }

        this.replaceWebRtcTracks(liveTrack);

        if (this.frozenTrack) {
            try { this.frozenTrack.stop(); } catch { }
            this.frozenTrack = null;
        }

        this.isFrozen = false;
        this.frozenTimestamp = undefined;
        this.notify();

        showToast("Screen Freeze OFF - Screenshare resumed live", Toasts.Type.SUCCESS);
    }

    private replaceWebRtcTracks(newTrack: MediaStreamTrack | null) {
        if (!newTrack) return;

        try {
            const mediaEngine = (MediaEngineStore as any)?.getMediaEngine?.();
            if (mediaEngine?.connections) {
                for (const conn of mediaEngine.connections) {
                    // Try standard RTCPeerConnection getSenders
                    const pc: RTCPeerConnection = conn.pc || conn.peerConnection || conn._pc;
                    if (pc && typeof pc.getSenders === "function") {
                        for (const sender of pc.getSenders()) {
                            if (sender.track && sender.track.kind === "video") {
                                sender.replaceTrack(newTrack).catch(() => { });
                            }
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
