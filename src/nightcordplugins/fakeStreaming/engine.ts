/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, MediaEngineStore } from "@webpack/common";
import { FakeStreamConfig, StreamTarget } from "./types";

type StateListener = () => void;

class FakeStreamEngine {
    private videoElement: HTMLVideoElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private canvasCtx: CanvasRenderingContext2D | null = null;
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;
    private originalPrototypeGetUserMedia: any = null;

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
        // Lazy init
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
            // Place off-screen instead of display:none so Chromium actively decodes frames
            video.style.position = "fixed";
            video.style.left = "-9999px";
            video.style.top = "-9999px";
            video.style.width = "640px";
            video.style.height = "360px";
            video.style.opacity = "0.01";
            video.style.pointerEvents = "none";
            video.style.zIndex = "-9999";
            video.crossOrigin = "anonymous";
            video.playsInline = true;
            video.muted = true; // muted guarantees continuous autoplay
            video.loop = this.config.loop;
            video.playbackRate = this.config.playbackRate;
            video.volume = this.config.volume;

            const mount = document.body || document.documentElement;
            if (mount) {
                mount.appendChild(video);
            }

            this.videoElement = video;

            const canvas = document.createElement("canvas");
            canvas.style.position = "fixed";
            canvas.style.left = "-9999px";
            canvas.style.top = "-9999px";
            canvas.style.opacity = "0.01";
            canvas.style.pointerEvents = "none";
            canvas.width = 1280;
            canvas.height = 720;
            if (mount) {
                mount.appendChild(canvas);
            }
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
                video.play().catch(() => { });
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

        if (this.config.active) {
            this.startCanvasLoop();
        } else {
            this.stopCanvasLoop();
        }

        this.notify();
    }

    public async loadVideoBlob(file: File): Promise<string> {
        const url = URL.createObjectURL(file);
        this.updateConfig({
            videoUrl: url,
            videoName: file.name
        });
        const video = this.getVideoElement();
        if (video) {
            video.src = url;
            video.load();
            video.play().catch(() => { });
        }
        return url;
    }

    public play() {
        const video = this.getVideoElement();
        if (video) {
            video.play().catch(() => { });
            this.startCanvasLoop();
        }
    }

    public pause() {
        const video = this.getVideoElement();
        if (video) {
            video.pause();
            this.stopCanvasLoop();
        }
    }

    public seek(timeSeconds: number) {
        const video = this.getVideoElement();
        if (video) {
            video.currentTime = timeSeconds;
        }
    }

    public toggleDiscordWebcam(enable?: boolean) {
        try {
            const isCurrentlyEnabled = typeof (MediaEngineStore as any)?.isVideoEnabled === "function"
                ? (MediaEngineStore as any).isVideoEnabled()
                : false;
            const targetState = enable !== undefined ? enable : !isCurrentlyEnabled;

            FluxDispatcher.dispatch({
                type: "MEDIA_ENGINE_SET_VIDEO_ENABLED",
                enabled: targetState
            });
        } catch (e) {
            console.warn("[FakeStreaming] Failed to toggle Discord webcam:", e);
        }
    }

    public startPatch() {
        if (this.isPatched || !navigator.mediaDevices) return;

        this.originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const MediaDevicesProto = Object.getPrototypeOf(navigator.mediaDevices);
        if (MediaDevicesProto && MediaDevicesProto.getUserMedia) {
            this.originalPrototypeGetUserMedia = MediaDevicesProto.getUserMedia;
        }

        const self = this;

        const patchedGetUserMedia = async function (constraints: MediaStreamConstraints | undefined) {
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

        navigator.mediaDevices.getUserMedia = patchedGetUserMedia;
        if (MediaDevicesProto) {
            MediaDevicesProto.getUserMedia = patchedGetUserMedia;
        }

        this.isPatched = true;
    }

    public stopPatch() {
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

        this.stopCanvasLoop();

        if (this.videoElement) {
            try { this.videoElement.pause(); } catch { }
        }
    }

    private startCanvasLoop() {
        if (this.renderInterval) return;
        this.renderInterval = setInterval(() => {
            const video = this.getVideoElement();
            if (video && this.canvasCtx && this.canvas) {
                if (video.paused) {
                    video.play().catch(() => { });
                }
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
                        this.canvas.width = video.videoWidth;
                        this.canvas.height = video.videoHeight;
                    }
                }
                try {
                    this.canvasCtx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
                } catch { }
            }
        }, 1000 / 30); // 30 fps
    }

    private stopCanvasLoop() {
        if (this.renderInterval) {
            clearInterval(this.renderInterval);
            this.renderInterval = null;
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
        const video = this.getVideoElement();
        if (!video) {
            throw new Error("Video element not ready");
        }

        try {
            await video.play();
        } catch { }

        this.startCanvasLoop();

        let fakeStream: MediaStream | null = null;

        // Try Canvas captureStream (30 FPS)
        if (this.canvas && (this.canvas as any).captureStream) {
            fakeStream = (this.canvas as any).captureStream(30);
        } else if ((video as any).captureStream) {
            fakeStream = (video as any).captureStream(30);
        }

        if (!fakeStream || fakeStream.getVideoTracks().length === 0) {
            throw new Error("Failed to capture video stream from canvas/element");
        }

        const finalStream = new MediaStream();

        // 1. Add Fake Video Track
        const videoTrack = fakeStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = true;
            finalStream.addTrack(videoTrack);
        }

        // 2. Audio Handling
        const wantsAudio = !!originalConstraints?.audio;
        if (wantsAudio) {
            let addedAudio = false;

            if (this.config.includeAudio && (video as any).captureStream) {
                try {
                    const vidStream = (video as any).captureStream();
                    const audioTrack = vidStream.getAudioTracks()[0];
                    if (audioTrack) {
                        audioTrack.enabled = true;
                        finalStream.addTrack(audioTrack);
                        addedAudio = true;
                    }
                } catch { }
            }

            if (!addedAudio && this.originalGetUserMedia) {
                try {
                    const realAudio = await this.originalGetUserMedia({ audio: originalConstraints.audio, video: false });
                    const micTrack = realAudio.getAudioTracks()[0];
                    if (micTrack) {
                        finalStream.addTrack(micTrack);
                    }
                } catch { }
            }
        }

        return finalStream;
    }
}

export const fakeStreamEngine = new FakeStreamEngine();
