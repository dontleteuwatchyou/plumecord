/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Toasts } from "@webpack/common";
import { t } from "../autoTranslateNightcord";
import { fixMediaFileDuration, fixMp4Duration, fixWebmBufferDuration } from "./mediaFixer";

export interface RecordingOptions {
    mode: "voice" | "video";
    videoQuality?: string;
    videoFormat?: string;
    audioFormat?: string;
    maxStorageGB: number;
    shadowplayMinutes: number;
    autoSave: boolean;
    savePath: string;
    showSaveToast?: boolean;
}

let activeOpts: RecordingOptions | null = null;

let isRecording = false;
let isStopping = false;  // guard against concurrent stopRecording calls
let mediaRecorder: MediaRecorder | null = null;
let recordCtx: AudioContext | null = null;
let recordDest: MediaStreamAudioDestinationNode | null = null;
let micStream: MediaStream | null = null;
let systemStream: MediaStream | null = null;

let currentFilename: string = "";
let isStreamMode = false;
let recordedChunks: Blob[] = [];
let pendingChunkPromises: Promise<any>[] = [];
const CHUNK_TIME_MS = 5000;
let startTimeMs = 0;
let memoryCheckInterval: any;

export function getRecordingDurationMs(): number {
    if (!isRecording) return 0;
    return Date.now() - startTimeMs;
}

export function isCurrentlyRecording(): boolean {
    return isRecording;
}

function getMediaRecordingConfig(opts: RecordingOptions): { mimeType: string; ext: string } {
    if (opts.mode === "video") {
        if (opts.videoFormat === "mkv") {
            const mimes = [
                "video/x-matroska;codecs=avc1,opus",
                "video/x-matroska;codecs=avc1,aac",
                "video/x-matroska",
                "video/webm;codecs=vp8,opus",
                "video/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: "mkv" };
            }
            return { mimeType: "video/webm", ext: "mkv" };
        } else if (opts.videoFormat === "webm") {
            const mimes = [
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm;codecs=h264,opus",
                "video/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: "webm" };
            }
            return { mimeType: "video/webm", ext: "webm" };
        } else {
            // Default: MP4 video
            const mimes = [
                "video/mp4;codecs=avc1,mp4a.40.2",
                "video/mp4;codecs=avc1,opus",
                "video/mp4;codecs=h264,aac",
                "video/mp4;codecs=avc1",
                "video/mp4;codecs=h264",
                "video/mp4",
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) {
                    return { mimeType: m, ext: "mp4" };
                }
            }
            return { mimeType: "video/webm", ext: "mp4" };
        }
    } else {
        // Voice only: MUST use audio MIME types so MediaRecorder doesn't reject audio-only streams
        if (opts.audioFormat === "ogg") {
            const mimes = [
                "audio/ogg;codecs=opus",
                "audio/ogg",
                "audio/webm;codecs=opus",
                "audio/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: "ogg" };
            }
            return { mimeType: "audio/webm", ext: "ogg" };
        } else if (opts.audioFormat === "webm") {
            const mimes = [
                "audio/webm;codecs=opus",
                "audio/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: "webm" };
            }
            return { mimeType: "audio/webm", ext: "webm" };
        } else {
            // Default: MP4 audio / AAC or WebM Opus
            const mimes = [
                "audio/mp4;codecs=mp4a.40.2",
                "audio/mp4;codecs=aac",
                "audio/mp4;codecs=opus",
                "audio/mp4",
                "audio/webm;codecs=opus",
                "audio/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) {
                    return { mimeType: m, ext: "mp4" };
                }
            }
            return { mimeType: "audio/webm", ext: "mp4" };
        }
    }
}

export async function startRecording(opts: RecordingOptions): Promise<boolean> {
    if (isRecording) return false;
    activeOpts = opts;
    isStopping = false;

    try {
        recordedChunks = [];
        pendingChunkPromises = [];
        startTimeMs = Date.now();

        const { mimeType, ext } = getMediaRecordingConfig(opts);
        const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        currentFilename = `AutoCall_${dateStr}.${ext}`;

        const native = (window as any).VencordNative?.pluginHelpers?.AutoCallRecorder;
        if (native?.initStreamRecording && native?.appendRecordingChunk && native?.finalizeStreamRecording) {
            try {
                isStreamMode = await native.initStreamRecording(currentFilename);
            } catch {
                isStreamMode = false;
            }
        } else {
            isStreamMode = false;
        }

        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        recordCtx = new AudioCtxClass();
        recordDest = recordCtx.createMediaStreamDestination();

        let capturedMic = false;
        let capturedSystem = false;

        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (micStream && micStream.getAudioTracks().length > 0) {
                const micSource = recordCtx.createMediaStreamSource(micStream);
                micSource.connect(recordDest);
                capturedMic = true;
            }
        } catch (e) {
            console.warn("[AutoCallRecorder] Local mic capture failed:", e);
        }

        try {
            let desktopSourceId: string | null = null;
            const nativeCapture = (window as any).VencordNative?.desktopCapture;
            if (nativeCapture?.getSources) {
                const sources = await nativeCapture.getSources();
                const screenSource = sources.find((s: any) => s.id.startsWith("screen:"));
                if (screenSource) desktopSourceId = screenSource.id;
            }

            if (desktopSourceId) {
                const constraints: any = {
                    audio: {
                        mandatory: {
                            chromeMediaSource: "desktop",
                            chromeMediaSourceId: desktopSourceId
                        }
                    }
                };

                if (opts.mode === "video") {
                    let minWidth = 1280;
                    let minHeight = 720;
                    let maxFrameRate = 30;

                    if (opts.videoQuality === "1080p60") {
                        minWidth = 1920;
                        minHeight = 1080;
                        maxFrameRate = 60;
                    } else if (opts.videoQuality === "480p25") {
                        minWidth = 854;
                        minHeight = 480;
                        maxFrameRate = 25;
                    }

                    constraints.video = {
                        mandatory: {
                            chromeMediaSource: "desktop",
                            chromeMediaSourceId: desktopSourceId,
                            minWidth,
                            minHeight,
                            maxFrameRate
                        }
                    };
                } else {
                    constraints.video = {
                        mandatory: {
                            chromeMediaSource: "desktop",
                            chromeMediaSourceId: desktopSourceId,
                            maxWidth: 1, maxHeight: 1
                        }
                    };
                }

                systemStream = await navigator.mediaDevices.getUserMedia(constraints);

                if (systemStream && systemStream.getAudioTracks().length > 0) {
                    const sysAudioStream = new MediaStream(systemStream.getAudioTracks());
                    const systemSource = recordCtx.createMediaStreamSource(sysAudioStream);
                    systemSource.connect(recordDest);
                    capturedSystem = true;

                    // Immediately stop video capture pipeline in voice-only mode to prevent GPU/CPU overhead
                    if (opts.mode === "voice") {
                        systemStream.getVideoTracks().forEach(t => t.stop());
                    }
                }
            }
        } catch (e) {
            console.warn("[AutoCallRecorder] Desktop loopback capture failed:", e);
        }

        if (!capturedMic && !capturedSystem) {
            throw new Error("No audio source captured.");
        }

        let finalStream = recordDest.stream;
        if (opts.mode === "video" && systemStream) {
            finalStream = new MediaStream([
                ...systemStream.getVideoTracks(),
                ...recordDest.stream.getAudioTracks()
            ]);
        }

        let videoBitsPerSecond: number | undefined;
        let recorderOptions: any = {};
        if (mimeType && MediaRecorder.isTypeSupported(mimeType)) {
            recorderOptions.mimeType = mimeType;
        }
        if (videoBitsPerSecond) {
            recorderOptions.videoBitsPerSecond = videoBitsPerSecond;
        }

        try {
            mediaRecorder = new MediaRecorder(finalStream, recorderOptions);
        } catch (recorderErr) {
            console.warn("[AutoCallRecorder] MediaRecorder init with options failed, falling back to default:", recorderErr);
            mediaRecorder = new MediaRecorder(finalStream);
        }

        mediaRecorder.ondataavailable = e => {
            if (!e.data || e.data.size === 0) return;

            // Always store in memory array as backup
            recordedChunks.push(e.data);

            if (isStreamMode && native?.appendRecordingChunk) {
                const p = (async () => {
                    try {
                        const buf = await e.data.arrayBuffer();
                        await native.appendRecordingChunk(new Uint8Array(buf));
                    } catch (err) {
                        console.error("[AutoCallRecorder] Stream chunk append failed:", err);
                    }
                })();
                pendingChunkPromises.push(p);
            }
        };

        mediaRecorder.start(1000);
        isRecording = true;

        memoryCheckInterval = setInterval(() => {
            if (!isRecording) return;

            if (opts.maxStorageGB > 0) {
                const maxBytes = opts.maxStorageGB * 1024 * 1024 * 1024;
                let currentBytes = recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0);
                while (currentBytes > maxBytes && recordedChunks.length > 1) {
                    const removed = recordedChunks.shift();
                    currentBytes -= (removed?.size || 0);
                }
            }

            if (opts.shadowplayMinutes > 0) {
                const maxChunks = (opts.shadowplayMinutes * 60 * 1000) / CHUNK_TIME_MS;
                while (recordedChunks.length > maxChunks) {
                    recordedChunks.shift();
                }
            }
        }, CHUNK_TIME_MS);

        return true;
    } catch (e) {
        console.error("[AutoCallRecorder] Failed to start recording:", e);
        cleanup();
        return false;
    }
}

function notifyRecordingSaved(destPath?: string, filename?: string) {
    if (activeOpts?.showSaveToast === false) return;
    try {
        showNotification({
            id: "autocallrecorder-saved",
            title: t("Call Recording Saved"),
            body: destPath ? `${t("Saved to:")} ${destPath}` : `${t("Saved:")} ${filename}`,
            icon: "nightcord",
            type: "success",
            duration: 6000
        });
    } catch { }
    try {
        Toasts.show(Toasts.create(t("Call Recording Saved"), Toasts.Type.SUCCESS));
    } catch { }
}

export function stopRecording(): Promise<void> {
    return new Promise(async resolve => {
        // Guard against concurrent calls
        if (isStopping) { resolve(); return; }

        const opts = activeOpts;
        const mr = mediaRecorder;
        if (!isRecording || !mr || !opts) {
            cleanup();
            resolve();
            return;
        }

        isStopping = true;
        const durationSecs = (Date.now() - startTimeMs) / 1000;
        const shouldSave = durationSecs >= 0.8;
        const mimeType = mr.mimeType || "audio/webm";
        const durationMs = Math.max(0, Math.round(Date.now() - startTimeMs));
        const filename = currentFilename;
        const isStream = isStreamMode;

        const performSave = async () => {
            try {
                if (pendingChunkPromises.length > 0) {
                    await Promise.allSettled(pendingChunkPromises);
                    pendingChunkPromises = [];
                }

                if (shouldSave) {
                    const native = (window as any).VencordNative?.pluginHelpers?.AutoCallRecorder;
                    let saveResult: any = false;

                    if (isStream && native?.finalizeStreamRecording) {
                        try {
                            saveResult = await native.finalizeStreamRecording(opts.savePath, filename, durationMs);
                        } catch (e) {
                            console.error("[AutoCallRecorder] Finalize stream failed:", e);
                        }
                    }

                    const savedSuccess = typeof saveResult === "object" ? saveResult?.success : !!saveResult;
                    const destPath = typeof saveResult === "object" ? saveResult?.destPath : undefined;

                    if (!savedSuccess && recordedChunks.length > 0) {
                        const blob = new Blob(recordedChunks, { type: mimeType });
                        await saveBlobFallback(blob, opts, filename, durationMs);
                    } else if (savedSuccess) {
                        notifyRecordingSaved(destPath, filename);
                    }
                }
            } catch (err) {
                console.error("[AutoCallRecorder] Error during performSave:", err);
            } finally {
                cleanup();
                resolve();
            }
        };

        if (mr.state !== "inactive") {
            mr.onstop = () => {
                performSave();
            };
            try {
                mr.stop();
            } catch (e) {
                console.warn("[AutoCallRecorder] mr.stop() error:", e);
                performSave();
            }
        } else {
            performSave();
        }
    });
}

function cleanup() {
    isRecording = false;
    isStopping = false;
    isStreamMode = false;
    clearInterval(memoryCheckInterval);
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (systemStream) { systemStream.getTracks().forEach(t => t.stop()); systemStream = null; }
    if (recordCtx) { recordCtx.close(); recordCtx = null; }
    recordDest = null;
    mediaRecorder = null;
    recordedChunks = [];
    pendingChunkPromises = [];
    activeOpts = null;
}

async function saveBlobFallback(blob: Blob, opts: RecordingOptions, filename: string, durationMs = 0) {
    try {
        let arrayBuffer = await blob.arrayBuffer();
        let uint8Array = new Uint8Array(arrayBuffer);

        if (durationMs > 0) {
            if (/\.(mp4|m4a)$/i.test(filename)) {
                try {
                    uint8Array = fixMp4Duration(uint8Array, durationMs);
                } catch { }
            } else if (/\.(webm|mkv|ogg)$/i.test(filename)) {
                try {
                    uint8Array = await fixWebmBufferDuration(uint8Array, durationMs);
                } catch { }
            }
        }

        const native = (window as any).VencordNative?.pluginHelpers?.AutoCallRecorder;
        if (native?.saveRecording) {
            try {
                if (!opts.autoSave && native?.promptSaveRecording) {
                    const res = await native.promptSaveRecording(uint8Array, filename);
                    const success = typeof res === "object" ? res?.success : !!res;
                    const destPath = typeof res === "object" ? res?.destPath : undefined;
                    if (success) { notifyRecordingSaved(destPath, filename); return; }
                } else {
                    const res = await native.saveRecording(uint8Array, opts.savePath, filename);
                    const success = typeof res === "object" ? res?.success : !!res;
                    const destPath = typeof res === "object" ? res?.destPath : undefined;
                    if (success) { notifyRecordingSaved(destPath, filename); return; }
                }
            } catch (e) {
                console.error("[AutoCallRecorder] Native fallback save failed:", e);
            }
        }

        // Ultimate browser download fallback
        const finalBlob = new Blob([uint8Array], { type: blob.type });
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);

        notifyRecordingSaved(undefined, filename);
    } catch (err) {
        console.error("[AutoCallRecorder] saveBlobFallback failed completely:", err);
    }
}
