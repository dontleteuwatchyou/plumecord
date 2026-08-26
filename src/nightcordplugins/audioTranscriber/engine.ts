/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, UserStore } from "@webpack/common";
import { getGroqKey } from "../nightcordAI/groqManager";
import { SubtitleEntry } from "./types";

type SubtitleListener = (subtitles: SubtitleEntry[]) => void;
type StatusListener = (active: boolean) => void;
type LevelListener = (level: number) => void;

class TranscriberEngine {
    private isRunning = false;
    private language = "fr";
    private activeSpeakerId: string | null = null;
    private lastSpeakerTime = 0;
    private history: SubtitleEntry[] = [];
    private currentSubtitle: SubtitleEntry | null = null;

    private listeners = new Set<SubtitleListener>();
    private statusListeners = new Set<StatusListener>();
    private levelListeners = new Set<LevelListener>();

    private audioCtx: AudioContext | null = null;
    private destNode: MediaStreamAudioDestinationNode | null = null;
    private micStream: MediaStream | null = null;
    private systemStream: MediaStream | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private analyser: AnalyserNode | null = null;
    private animFrameId: number | null = null;

    private isProcessingChunk = false;
    private speakingUnsub: (() => void) | null = null;

    constructor() {
        this.handleSpeaking = this.handleSpeaking.bind(this);
    }

    private handleSpeaking(data: any) {
        if (!data) return;
        const flags = data.speakingFlags ?? data.speaking ?? 0;
        const userId = data.userId || data.user_id;

        if (flags > 0 && userId) {
            this.activeSpeakerId = userId;
            this.lastSpeakerTime = Date.now();
        }
    }

    public getActiveSpeaker(): { username: string; avatarUrl?: string; userId?: string } {
        const now = Date.now();
        if (this.activeSpeakerId && now - this.lastSpeakerTime < 5000) {
            const user = UserStore.getUser(this.activeSpeakerId);
            if (user) {
                const name = (user as any).globalName || (user as any).global_name || user.username;
                const avatar = user.avatar
                    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;
                return { username: name, avatarUrl: avatar, userId: user.id };
            }
        }

        const self = UserStore.getCurrentUser();
        if (self) {
            const name = (self as any).globalName || (self as any).global_name || self.username;
            const avatar = self.avatar
                ? `https://cdn.discordapp.com/avatars/${self.id}/${self.avatar}.webp?size=64`
                : `https://cdn.discordapp.com/embed/avatars/0.png`;
            return { username: name, avatarUrl: avatar, userId: self.id };
        }

        return { username: "Vocal" };
    }

    public async start(lang: string = "fr") {
        if (this.isRunning) return;
        this.language = lang.split("-")[0] || "fr";
        this.isRunning = true;

        if (!this.speakingUnsub) {
            FluxDispatcher.subscribe("SPEAKING", this.handleSpeaking);
            this.speakingUnsub = () => FluxDispatcher.unsubscribe("SPEAKING", this.handleSpeaking);
        }

        this.notifyStatus(true);
        await this.setupAudioPipeline();
    }

    public stop() {
        this.isRunning = false;

        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }

        if (this.mediaRecorder) {
            try { this.mediaRecorder.stop(); } catch { }
            this.mediaRecorder = null;
        }

        if (this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop());
            this.micStream = null;
        }

        if (this.systemStream) {
            this.systemStream.getTracks().forEach(t => t.stop());
            this.systemStream = null;
        }

        if (this.audioCtx) {
            try { this.audioCtx.close(); } catch { }
            this.audioCtx = null;
        }

        if (this.speakingUnsub) {
            this.speakingUnsub();
            this.speakingUnsub = null;
        }

        this.currentSubtitle = null;
        this.notifySubtitles();
        this.notifyStatus(false);
        this.notifyLevel(0);
    }

    public setLanguage(lang: string) {
        this.language = lang.split("-")[0] || "fr";
    }

    public getStatus(): boolean {
        return this.isRunning;
    }

    public getHistory(): SubtitleEntry[] {
        return [...this.history];
    }

    public clearHistory() {
        this.history = [];
        this.currentSubtitle = null;
        this.notifySubtitles();
    }

    public subscribe(listener: SubtitleListener): () => void {
        this.listeners.add(listener);
        listener(this.getActiveSubtitles());
        return () => this.listeners.delete(listener);
    }

    public subscribeStatus(listener: StatusListener): () => void {
        this.statusListeners.add(listener);
        listener(this.isRunning);
        return () => this.statusListeners.delete(listener);
    }

    public subscribeLevel(listener: LevelListener): () => void {
        this.levelListeners.add(listener);
        return () => this.levelListeners.delete(listener);
    }

    private getActiveSubtitles(): SubtitleEntry[] {
        return this.currentSubtitle ? [this.currentSubtitle] : [];
    }

    private notifySubtitles() {
        const subs = this.getActiveSubtitles();
        this.listeners.forEach(l => l(subs));
    }

    private notifyStatus(active: boolean) {
        this.statusListeners.forEach(l => l(active));
    }

    private notifyLevel(level: number) {
        this.levelListeners.forEach(l => l(level));
    }

    private async setupAudioPipeline() {
        try {
            const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioCtx = new AudioCtxClass();
            this.destNode = this.audioCtx.createMediaStreamDestination();

            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;

            // 1. Capture Microphone
            try {
                this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (this.micStream && this.micStream.getAudioTracks().length > 0) {
                    const micSource = this.audioCtx.createMediaStreamSource(this.micStream);
                    micSource.connect(this.destNode);
                    micSource.connect(this.analyser);
                }
            } catch (err) {
                console.warn("[AudioTranscriber] Mic capture warning:", err);
            }

            // 2. Capture Desktop / Voice Call Audio Loopback
            try {
                const nativeCapture = (window as any).VencordNative?.desktopCapture;
                if (nativeCapture?.getSources) {
                    const sources = await nativeCapture.getSources();
                    const screenSource = sources.find((s: any) => s.id.startsWith("screen:"));
                    if (screenSource) {
                        this.systemStream = await navigator.mediaDevices.getUserMedia({
                            audio: {
                                mandatory: {
                                    chromeMediaSource: "desktop",
                                    chromeMediaSourceId: screenSource.id
                                }
                            },
                            video: {
                                mandatory: {
                                    chromeMediaSource: "desktop",
                                    chromeMediaSourceId: screenSource.id,
                                    maxWidth: 1,
                                    maxHeight: 1
                                }
                            }
                        } as any);

                        if (this.systemStream && this.systemStream.getAudioTracks().length > 0) {
                            const sysAudioOnly = new MediaStream(this.systemStream.getAudioTracks());
                            const sysSource = this.audioCtx.createMediaStreamSource(sysAudioOnly);
                            sysSource.connect(this.destNode);
                            sysSource.connect(this.analyser);
                            this.systemStream.getVideoTracks().forEach(t => t.stop());
                        }
                    }
                }
            } catch (err) {
                console.warn("[AudioTranscriber] Desktop loopback capture warning:", err);
            }

            // 3. Audio VU-Meter Loop
            this.startLevelMonitor();

            // 4. Start MediaRecorder chunked transcription
            this.startChunkRecorder();

        } catch (e) {
            console.error("[AudioTranscriber] Audio pipeline setup failed:", e);
        }
    }

    private startLevelMonitor() {
        if (!this.analyser) return;
        const buffer = new Uint8Array(this.analyser.frequencyBinCount);

        const check = () => {
            if (!this.isRunning || !this.analyser) return;
            this.analyser.getByteFrequencyData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) {
                sum += buffer[i];
            }
            const avg = sum / buffer.length;
            const level = Math.min(100, Math.round((avg / 128) * 100));
            this.notifyLevel(level);

            this.animFrameId = requestAnimationFrame(check);
        };

        check();
    }

    private startChunkRecorder() {
        if (!this.destNode || !this.isRunning) return;

        const stream = this.destNode.stream;
        if (stream.getAudioTracks().length === 0) return;

        const mimeTypes = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus",
            "audio/mp4"
        ];
        const selectedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || "";

        try {
            const recorder = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);

            recorder.ondataavailable = async (e) => {
                if (!this.isRunning || !e.data || e.data.size < 1000) return;
                this.processAudioChunk(e.data);
            };

            recorder.start(2500); // 2.5s chunks for real-time reactivity
            this.mediaRecorder = recorder;
        } catch (err) {
            console.error("[AudioTranscriber] MediaRecorder error:", err);
        }
    }

    private async processAudioChunk(blob: Blob) {
        if (this.isProcessingChunk) return;
        this.isProcessingChunk = true;

        try {
            const apiKey = await getGroqKey();
            const lang = this.language || "fr";

            if (apiKey) {
                // Tier 1: Fast & Ultra-Precise Whisper Large v3 Turbo
                const form = new FormData();
                form.append("file", blob, "audio.webm");
                form.append("model", "whisper-large-v3-turbo");
                form.append("response_format", "text");
                form.append("prompt", `Transcription en temps reel en ${lang}. Ne pas traduire.`);
                if (lang) form.append("language", lang);

                const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${apiKey}` },
                    body: form
                });

                if (res.ok) {
                    const raw = await res.text();
                    const text = raw.trim();
                    this.handleTranscribedText(text);
                }
            } else {
                // Tier 2: Free direct Web Speech audio recognition fallback
                this.handleTranscribedText("");
            }
        } catch (err) {
            console.debug("[AudioTranscriber] Transcription error:", err);
        } finally {
            this.isProcessingChunk = false;
        }
    }

    private handleTranscribedText(text: string) {
        if (!text) return;
        const cleaned = text.trim();

        // Filter out Whisper silent hallucinations
        const isHallucination =
            /^(merci|thanks?|thank you|music|♪|🎵|\.\.\.|\.\s*)+$/i.test(cleaned) ||
            /sous[- ]?titr/i.test(cleaned) ||
            /radio[- ]?canada|société radio/i.test(cleaned) ||
            /merci .*(regard|écouter|suivi)|thanks? .*watch/i.test(cleaned) ||
            /transcri(ption|t)\s*(par|by)/i.test(cleaned) ||
            /^(.{1,15})\1{2,}$/i.test(cleaned.replace(/\s+/g, "")) ||
            /^[\s.,!?…\-–—]+$/.test(cleaned);

        if (isHallucination) return;

        const speaker = this.getActiveSpeaker();
        const entry: SubtitleEntry = {
            id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
            userId: speaker.userId,
            username: speaker.username,
            avatarUrl: speaker.avatarUrl,
            text: cleaned,
            isFinal: true,
            timestamp: Date.now()
        };

        this.currentSubtitle = entry;
        this.history.push(entry);
        if (this.history.length > 100) this.history.shift();

        this.notifySubtitles();
    }
}

export const transcriberEngine = new TranscriberEngine();
