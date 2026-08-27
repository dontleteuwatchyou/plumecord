/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MediaEngineStore, UserStore, showToast, Toasts } from "@webpack/common";
import { ScreenFreezeState } from "./types";

type Listener = (state: ScreenFreezeState) => void;

interface LocalVideoBackup {
    video: HTMLVideoElement;
    originalSrcObject: MediaStream | null;
    wasPaused: boolean;
}

class ScreenFreezeEngine {
    private isFrozen = false;
    private frozenTimestamp: number | undefined = undefined;
    private listeners = new Set<Listener>();

    private originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;
    private originalPrototypeGetUserMedia: any = null;
    private isPatched = false;

    private activeLiveStreams = new Set<MediaStream>();
    private activeLiveTrack: MediaStreamTrack | null = null;

    private canvas: HTMLCanvasElement | null = null;
    private canvasCtx: CanvasRenderingContext2D | null = null;
    private frozenImageBitmap: ImageBitmap | null = null;
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private frozenStream: MediaStream | null = null;
    private frozenTrack: MediaStreamTrack | null = null;
    private localVideoBackups: LocalVideoBackup[] = [];

    public getState(): ScreenFreezeState {
        return {
            isFrozen: this.isFrozen,
            frozenTimestamp: this.frozenTimestamp,
            hasActiveStream: this.activeLiveStreams.size > 0 || this.getActiveDiscordStream() !== null || document.querySelectorAll("video").length > 0
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
            const c = document.createElement("canvas");
            c.width = 1920;
            c.height = 1080;
            c.style.position = "fixed";
            c.style.left = "-9999px";
            c.style.top = "-9999px";
            c.style.opacity = "0.001";
            c.style.pointerEvents = "none";
            document.body?.appendChild(c);
            this.canvas = c;
            this.canvasCtx = c.getContext("2d", { alpha: false });
        }
    }

    public startPatch() {
        if (this.isPatched || !navigator.mediaDevices) return;

        this.initCanvas();
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
        this.activeLiveTrack = null;
    }

    private registerActiveStream(stream: MediaStream) {
        this.activeLiveStreams.add(stream);
        const vt = stream.getVideoTracks()[0];
        if (vt) {
            this.activeLiveTrack = vt;
            vt.addEventListener("ended", () => {
                this.activeLiveStreams.delete(stream);
                if (this.activeLiveTrack === vt) {
                    this.activeLiveTrack = null;
                }
                if (this.activeLiveStreams.size === 0 && this.isFrozen) {
                    this.unfreeze();
                }
                this.notify();
            });
        }
        this.notify();
    }

    public getActiveDiscordStream(): MediaStream | null {
        // 1. From intercepted getUserMedia
        for (const s of this.activeLiveStreams) {
            if (s.active && s.getVideoTracks().some(t => t.readyState === "live")) {
                return s;
            }
        }

        // 2. From MediaEngine connections
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

    public async freeze() {
        this.initCanvas();
        if (!this.canvas || !this.canvasCtx) return;

        // 1. Find live video source to capture exact frame
        let sourceVideo: HTMLVideoElement | null = null;
        const allVideos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
        for (const vid of allVideos) {
            if (vid.videoWidth > 0 && vid.videoHeight > 0) {
                sourceVideo = vid;
                break;
            }
        }

        const activeStream = this.getActiveDiscordStream();
        if (activeStream) {
            const vt = activeStream.getVideoTracks().find(t => t.readyState === "live") || activeStream.getVideoTracks()[0];
            if (vt) {
                this.activeLiveTrack = vt;
            }
        }

        // 2. Grab current frame into canvas & ImageBitmap
        if (sourceVideo && sourceVideo.videoWidth > 0) {
            this.canvas.width = sourceVideo.videoWidth;
            this.canvas.height = sourceVideo.videoHeight;
            try {
                this.canvasCtx.drawImage(sourceVideo, 0, 0, this.canvas.width, this.canvas.height);
                this.frozenImageBitmap = await createImageBitmap(sourceVideo);
            } catch (e) {
                console.warn("[ScreenFreeze] capture frame error:", e);
            }
        } else {
            this.canvasCtx.fillStyle = "#1e1f22";
            this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // 3. Start high-frequency 30 FPS render loop so WebRTC receives continuous frames of the frozen still image
        if (this.renderInterval) clearInterval(this.renderInterval);
        this.renderInterval = setInterval(() => {
            if (this.canvas && this.canvasCtx) {
                if (this.frozenImageBitmap) {
                    try {
                        this.canvasCtx.drawImage(this.frozenImageBitmap, 0, 0, this.canvas.width, this.canvas.height);
                    } catch { }
                }
            }
        }, 1000 / 30);

        // 4. Create frozen WebRTC video track from canvas
        if ((this.canvas as any).captureStream) {
            this.frozenStream = (this.canvas as any).captureStream(30);
            this.frozenTrack = this.frozenStream?.getVideoTracks()[0] || null;
        }

        // 5. Replace WebRTC Track on all active senders
        if (this.frozenTrack) {
            await this.replaceWebRtcTracks(this.frozenTrack);
        }

        // 6. Freeze all local preview videos so the screen is completely frozen on your end too
        this.localVideoBackups = [];
        for (const vid of allVideos) {
            if (vid.videoWidth > 0) {
                this.localVideoBackups.push({
                    video: vid,
                    originalSrcObject: (vid.srcObject as MediaStream) || null,
                    wasPaused: vid.paused
                });
                try {
                    if (this.frozenStream) {
                        vid.srcObject = this.frozenStream;
                        vid.play().catch(() => { });
                    } else {
                        vid.pause();
                    }
                } catch { }
            }
        }

        this.isFrozen = true;
        this.frozenTimestamp = Date.now();
        this.notify();

        showToast("Screen Freeze ACTIVE - Screenshare is now frozen on this frame", Toasts.Type.DANGER);
    }

    public async unfreeze() {
        if (this.renderInterval) {
            clearInterval(this.renderInterval);
            this.renderInterval = null;
        }

        if (this.frozenImageBitmap) {
            try { this.frozenImageBitmap.close(); } catch { }
            this.frozenImageBitmap = null;
        }

        // 1. Restore original live track
        let liveTrack = this.activeLiveTrack;
        if (!liveTrack || liveTrack.readyState !== "live") {
            const s = this.getActiveDiscordStream();
            if (s) {
                liveTrack = s.getVideoTracks().find(t => t.readyState === "live") || s.getVideoTracks()[0] || null;
            }
        }

        if (liveTrack) {
            await this.replaceWebRtcTracks(liveTrack);
        }

        // 2. Restore local video previews
        for (const item of this.localVideoBackups) {
            try {
                if (item.originalSrcObject) {
                    item.video.srcObject = item.originalSrcObject;
                }
                if (!item.wasPaused) {
                    item.video.play().catch(() => { });
                }
            } catch { }
        }
        this.localVideoBackups = [];

        // 3. Stop frozen track
        if (this.frozenTrack) {
            try { this.frozenTrack.stop(); } catch { }
            this.frozenTrack = null;
        }
        this.frozenStream = null;

        this.isFrozen = false;
        this.frozenTimestamp = undefined;
        this.notify();

        showToast("Screen Freeze OFF - Screenshare resumed live", Toasts.Type.SUCCESS);
    }

    private async replaceWebRtcTracks(newTrack: MediaStreamTrack) {
        try {
            const mediaEngine = (MediaEngineStore as any)?.getMediaEngine?.();
            if (mediaEngine?.connections) {
                for (const conn of mediaEngine.connections) {
                    // Method A: RTCRtpSender.replaceTrack
                    const pc: RTCPeerConnection = conn.pc || conn.peerConnection || conn._pc;
                    if (pc && typeof pc.getSenders === "function") {
                        for (const sender of pc.getSenders()) {
                            if (sender.track && sender.track.kind === "video") {
                                try {
                                    await sender.replaceTrack(newTrack);
                                } catch (e) {
                                    console.warn("[ScreenFreeze] sender.replaceTrack error:", e);
                                }
                            }
                        }
                    }

                    // Method B: Stream Input Track replacement
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
            console.error("[ScreenFreeze] replaceWebRtcTracks error:", e);
        }
    }
}

export const screenFreezeEngine = new ScreenFreezeEngine();
