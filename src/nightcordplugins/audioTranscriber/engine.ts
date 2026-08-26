/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, UserStore, ChannelStore, SelectedChannelStore } from "@webpack/common";
import { SubtitleEntry } from "./types";

type SubtitleListener = (subtitles: SubtitleEntry[]) => void;
type StatusListener = (active: boolean) => void;

class TranscriberEngine {
    private recognition: any = null;
    private isRunning = false;
    private language = "fr-FR";
    private activeSpeakerId: string | null = null;
    private lastSpeakerTime = 0;
    private history: SubtitleEntry[] = [];
    private currentSubtitle: SubtitleEntry | null = null;
    private listeners = new Set<SubtitleListener>();
    private statusListeners = new Set<StatusListener>();
    private restartTimer: ReturnType<typeof setTimeout> | null = null;
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
        // If an active speaker was detected in the last 4 seconds, use it
        if (this.activeSpeakerId && now - this.lastSpeakerTime < 4000) {
            const user = UserStore.getUser(this.activeSpeakerId);
            if (user) {
                const name = (user as any).globalName || (user as any).global_name || user.username;
                const avatar = user.avatar
                    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;
                return { username: name, avatarUrl: avatar, userId: user.id };
            }
        }

        // Fallback to current user
        const self = UserStore.getCurrentUser();
        if (self) {
            const name = (self as any).globalName || (self as any).global_name || self.username;
            const avatar = self.avatar
                ? `https://cdn.discordapp.com/avatars/${self.id}/${self.avatar}.webp?size=64`
                : `https://cdn.discordapp.com/embed/avatars/0.png`;
            return { username: name, avatarUrl: avatar, userId: self.id };
        }

        return { username: "Speaker" };
    }

    public start(lang: string = "fr-FR") {
        this.language = lang;
        this.isRunning = true;
        this.initRecognition();

        if (!this.speakingUnsub) {
            FluxDispatcher.subscribe("SPEAKING", this.handleSpeaking);
            this.speakingUnsub = () => FluxDispatcher.unsubscribe("SPEAKING", this.handleSpeaking);
        }

        this.notifyStatus(true);
    }

    public stop() {
        this.isRunning = false;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        if (this.recognition) {
            try {
                this.recognition.abort();
            } catch { }
            this.recognition = null;
        }

        if (this.speakingUnsub) {
            this.speakingUnsub();
            this.speakingUnsub = null;
        }

        this.currentSubtitle = null;
        this.notifySubtitles();
        this.notifyStatus(false);
    }

    public setLanguage(lang: string) {
        this.language = lang;
        if (this.isRunning && this.recognition) {
            try {
                this.recognition.lang = lang;
            } catch { }
        }
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

    private getActiveSubtitles(): SubtitleEntry[] {
        const list: SubtitleEntry[] = [];
        if (this.currentSubtitle) {
            list.push(this.currentSubtitle);
        }
        return list;
    }

    private notifySubtitles() {
        const subs = this.getActiveSubtitles();
        this.listeners.forEach(l => l(subs));
    }

    private notifyStatus(active: boolean) {
        this.statusListeners.forEach(l => l(active));
    }

    private initRecognition() {
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRec) {
            console.warn("[AudioTranscriber] Web SpeechRecognition API is not supported in this environment.");
            return;
        }

        try {
            if (this.recognition) {
                try { this.recognition.abort(); } catch { }
            }

            const rec = new SpeechRec();
            rec.continuous = true;
            rec.interimResults = true;
            rec.maxAlternatives = 1;
            rec.lang = this.language || "fr-FR";

            rec.onresult = (event: any) => {
                if (!this.isRunning) return;

                let finalTranscript = "";
                let interimTranscript = "";

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const res = event.results[i];
                    const text = res[0]?.transcript || "";
                    if (res.isFinal) {
                        finalTranscript += text;
                    } else {
                        interimTranscript += text;
                    }
                }

                const displayText = (finalTranscript || interimTranscript).trim();
                if (!displayText) return;

                const speaker = this.getActiveSpeaker();
                const entry: SubtitleEntry = {
                    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
                    userId: speaker.userId,
                    username: speaker.username,
                    avatarUrl: speaker.avatarUrl,
                    text: displayText,
                    isFinal: !!finalTranscript,
                    timestamp: Date.now()
                };

                this.currentSubtitle = entry;
                if (finalTranscript) {
                    this.history.push(entry);
                    if (this.history.length > 100) this.history.shift();
                }

                this.notifySubtitles();
            };

            rec.onerror = (e: any) => {
                // Ignore silent network/no-speech errors and auto-recover
                if (e.error !== "no-speech") {
                    console.debug("[AudioTranscriber] Recognition event:", e.error);
                }
            };

            rec.onend = () => {
                if (this.isRunning) {
                    this.restartTimer = setTimeout(() => {
                        if (this.isRunning) this.initRecognition();
                    }, 250);
                }
            };

            rec.start();
            this.recognition = rec;
        } catch (err) {
            console.error("[AudioTranscriber] Failed to start recognition:", err);
        }
    }
}

export const transcriberEngine = new TranscriberEngine();
