/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FakeStreamConfig, StreamTarget } from "./types";

type StateListener = () => void;

class FakeStreamEngine {
    private videoElement: HTMLVideoElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private canvasCtx: CanvasRenderingContext2D | null = null;
    private animFrameId: number | null = null;
    private originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;

    private config: FakeStreamConfig = {
        videoUrl: "",
        videoName: "",
        target: "both",
        includeAudio: true,
        loop: true,
        playbackRate: 1,
        volume: 1,
        active: false
    };

    private listeners = new Set<StateListener>();
    private isPatched = false;

    constructor() {
        // Lazy initialization when DOM is ready
    }

    public getVideoElement(): HTMLVideoElement | null {
        if (!this.videoElement) {
            this.initVideoElement();
        }
        return this.videoElement;
    }

    private initVideoElement() {
        if (typeof document === "undefined") return;
        if (this.videoElement) return;

        try {
            const video = document.createElement("video");
            video.id = "nc-fake-streaming-video";
            video.style.display = "none";
            video.crossOrigin = "anonymous";
            video.playsInline = true;
            video.muted = false;
            video.loop = this.config.loop;
            video.playbackRate = this.config.playbackRate;
            video.volume = this.config.volume;

            const mount = document.body || document.documentElement;
            if (mount) {
                mount.appendChild(video);
            }

            this.videoElement = video;

            const canvas = document.createElement("canvas");
            canvas.style.display = "none";
            this.canvas = canvas;
            this.canvasCtx = canvas.getContext("2d");
        } catch (e) {
            console.error("[FakeStreaming] Init error:", e);
        }
    }

    public subscribe(listener: StateListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach(l => l());
    }

    public getConfig(): FakeStreamConfig {
        return { ...this.config };
    }

    public updateConfig(newConfig: Partial<FakeStreamConfig>) {
        this.config = { ...this.config, ...newConfig };

        const video = this.getVideoElement();
        if (video) {
            if (newConfig.videoUrl !== undefined && newConfig.videoUrl !== video.src) {
                video.src = newConfig.videoUrl;
                video.load();
                if (this.config.active) {
                    video.play().catch(() => { });
                }
            }
            if (newConfig.loop !== undefined) {
                video.loop = newConfig.loop;
            }
            if (newConfig.playbackRate !== undefined) {
                video.playbackRate = newConfig.playbackRate;
            }
            if (newConfig.volume !== undefined) {
                video.volume = newConfig.volume;
            }
        }

        this.notify();
    }

    public loadVideoBlob(file: File): Promise<string> {
        return new Promise((resolve) => {
            const url = URL.createObjectURL(file);
            this.updateConfig({
                videoUrl: url,
                videoName: file.name
            });
            resolve(url);
        });
    }

    public play() {
        const video = this.getVideoElement();
        if (video && video.paused) {
            video.play().catch(() => { });
        }
    }

    public pause() {
        const video = this.getVideoElement();
        if (video && !video.paused) {
            video.pause();
        }
    }

    public seek(timeSeconds: number) {
        const video = this.getVideoElement();
        if (video) {
            video.currentTime = timeSeconds;
        }
    }

    public startPatch() {
        if (this.isPatched || !navigator.mediaDevices) return;

        this.originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const self = this;

        navigator.mediaDevices.getUserMedia = async function (constraints) {
            if (!self.config.active || !self.config.videoUrl) {
                return self.originalGetUserMedia!.call(navigator.mediaDevices, constraints);
            }

            const hasVideo = !!constraints?.video;
            if (!hasVideo) {
                return self.originalGetUserMedia!.call(navigator.mediaDevices, constraints);
            }

            const isScreen = self.isScreenConstraint(constraints);
            const shouldIntercept =
                self.config.target === "both" ||
                (self.config.target === "screenshare" && isScreen) ||
                (self.config.target === "camera" && !isScreen);

            if (!shouldIntercept) {
                return self.originalGetUserMedia!.call(navigator.mediaDevices, constraints);
            }

            try {
                return await self.generateFakeStream(constraints);
            } catch (err) {
                console.error("[FakeStreaming] Failed to generate fake stream, falling back:", err);
                return self.originalGetUserMedia!.call(navigator.mediaDevices, constraints);
            }
        };

        this.isPatched = true;
    }

    public stopPatch() {
        if (this.isPatched && this.originalGetUserMedia && navigator.mediaDevices) {
            navigator.mediaDevices.getUserMedia = this.originalGetUserMedia;
            this.isPatched = false;
        }

        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }

        if (this.videoElement) {
            try { this.videoElement.pause(); } catch { }
        }
    }

    private isScreenConstraint(constraints: MediaStreamConstraints | undefined): boolean {
        if (!constraints?.video) return false;
        if (typeof constraints.video === "object") {
            const v: any = constraints.video;
            if (v.mandatory?.chromeMediaSource === "desktop" || v.chromeMediaSource === "desktop") {
                return true;
            }
        }
        return false;
    }

    private async generateFakeStream(originalConstraints: MediaStreamConstraints | undefined): Promise<MediaStream> {
        if (!this.videoElement) {
            throw new Error("Video element not ready");
        }

        // Ensure video is playing
        if (this.videoElement.paused) {
            try {
                await this.videoElement.play();
            } catch { }
        }

        let mediaStream: MediaStream | null = null;

        // Method 1: HTMLVideoElement.captureStream()
        if ((this.videoElement as any).captureStream) {
            try {
                mediaStream = (this.videoElement as any).captureStream(60);
            } catch { }
        } else if ((this.videoElement as any).mozCaptureStream) {
            try {
                mediaStream = (this.videoElement as any).mozCaptureStream(60);
            } catch { }
        }

        // Method 2: Canvas render loop fallback
        if (!mediaStream || mediaStream.getVideoTracks().length === 0) {
            mediaStream = this.createCanvasStream();
        }

        const finalStream = new MediaStream();

        // 1. Add Fake Video Track
        const videoTrack = mediaStream.getVideoTracks()[0];
        if (videoTrack) {
            finalStream.addTrack(videoTrack);
        }

        // 2. Audio Track Handling
        const wantsAudio = !!originalConstraints?.audio;
        if (wantsAudio) {
            if (this.config.includeAudio && mediaStream.getAudioTracks().length > 0) {
                // Use video's audio
                finalStream.addTrack(mediaStream.getAudioTracks()[0]);
            } else if (this.originalGetUserMedia) {
                // Use real microphone audio
                try {
                    const realMic = await this.originalGetUserMedia({ audio: originalConstraints.audio, video: false });
                    const micTrack = realMic.getAudioTracks()[0];
                    if (micTrack) finalStream.addTrack(micTrack);
                } catch { }
            }
        }

        return finalStream;
    }

    private createCanvasStream(): MediaStream {
        if (!this.canvas || !this.canvasCtx || !this.videoElement) {
            return new MediaStream();
        }

        const width = this.videoElement.videoWidth || 1280;
        const height = this.videoElement.videoHeight || 720;
        this.canvas.width = width;
        this.canvas.height = height;

        const draw = () => {
            if (!this.videoElement || !this.canvasCtx || !this.canvas) return;
            if (this.videoElement.readyState >= 2) {
                this.canvasCtx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
            }
            this.animFrameId = requestAnimationFrame(draw);
        };

        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
        draw();

        return this.canvas.captureStream(60);
    }
}

export const fakeStreamEngine = new FakeStreamEngine();
