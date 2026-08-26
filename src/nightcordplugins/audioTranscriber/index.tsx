/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Button, createRoot, FormSwitch, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal, React, SelectedChannelStore, Slider, Text, TextInput, UserStore, VoiceStateStore, showToast, Toasts } from "@webpack/common";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { getGroqKey, setGroqKey } from "../nightcordAI/groqManager";
import { transcriberEngine } from "./engine";
import { SubtitleOverlay, SubtitleHistoryModal } from "./SubtitleOverlay";
import { TranscriberSettings } from "./types";
import { t } from "../autoTranslateNightcord";

const settings = definePluginSettings({
    language: {
        type: OptionType.SELECT,
        description: "Transcription language for speech recognition.",
        options: [
            { label: "French (Français)", value: "fr", default: true },
            { label: "English (Anglais)", value: "en" },
            { label: "Spanish (Español)", value: "es" },
            { label: "German (Deutsch)", value: "de" },
            { label: "Italian (Italiano)", value: "it" },
            { label: "Russian (Русский)", value: "ru" },
            { label: "Arabic (العربية)", value: "ar" },
            { label: "Chinese (中文)", value: "zh" },
            { label: "Japanese (日本語)", value: "ja" }
        ],
        restartNeeded: false
    },
    fontSize: {
        type: OptionType.SLIDER,
        description: "Subtitle font size in pixels.",
        markers: [12, 14, 16, 18, 20, 24, 28],
        default: 16,
        restartNeeded: false
    },
    bgOpacity: {
        type: OptionType.SLIDER,
        description: "Subtitle background opacity percentage.",
        markers: [30, 50, 70, 85, 100],
        default: 85,
        restartNeeded: false
    },
    fadeDelay: {
        type: OptionType.SLIDER,
        description: "Seconds before subtitles automatically fade away after silence.",
        markers: [2, 3, 5, 8, 10, 15],
        default: 5,
        restartNeeded: false
    },
    showAvatar: {
        type: OptionType.BOOLEAN,
        description: "Display speaker's avatar next to the subtitle.",
        default: true,
        restartNeeded: false
    },
    showUsername: {
        type: OptionType.BOOLEAN,
        description: "Display speaker's username above the subtitle.",
        default: true,
        restartNeeded: false
    },
    position: {
        type: OptionType.SELECT,
        description: "Position of the floating subtitle bar on screen.",
        options: [
            { label: "Bottom Center", value: "bottom", default: true },
            { label: "Top Center", value: "top" }
        ],
        restartNeeded: false
    },
    alwaysOn: {
        type: OptionType.BOOLEAN,
        description: "Keep transcriber listening continuously even when outside of voice channels.",
        default: false,
        restartNeeded: false
    }
});

let overlayContainer: HTMLElement | null = null;
let overlayRoot: any = null;

function renderOverlay() {
    if (!overlayContainer) {
        overlayContainer = document.createElement("div");
        overlayContainer.id = "nc-audio-transcriber-overlay";
        document.body.appendChild(overlayContainer);
    }

    const currentSettings: TranscriberSettings = {
        language: settings.store.language || "fr",
        fontSize: settings.store.fontSize || 16,
        bgOpacity: settings.store.bgOpacity || 85,
        fadeDelay: settings.store.fadeDelay || 5,
        showAvatar: settings.store.showAvatar !== false,
        showUsername: settings.store.showUsername !== false,
        position: settings.store.position || "bottom",
        alwaysOn: !!settings.store.alwaysOn
    };

    if (!overlayRoot) {
        overlayRoot = createRoot(overlayContainer);
    }

    overlayRoot.render(
        <SubtitleOverlay settings={currentSettings} />
    );
}

function removeOverlay() {
    if (overlayRoot) {
        try { overlayRoot.unmount(); } catch { }
        overlayRoot = null;
    }
    if (overlayContainer) {
        try { overlayContainer.remove(); } catch { }
        overlayContainer = null;
    }
}

function AudioTranscriberSettingsComponent() {
    const [isRunning, setIsRunning] = React.useState(() => transcriberEngine.getStatus());
    const [audioLevel, setAudioLevel] = React.useState(0);
    const [apiKey, setApiKeyState] = React.useState("");
    const [keySaved, setKeySaved] = React.useState(false);

    React.useEffect(() => {
        getGroqKey().then(k => setApiKeyState(k || ""));
        const unsubStatus = transcriberEngine.subscribeStatus(active => setIsRunning(active));
        const unsubLevel = transcriberEngine.subscribeLevel(lvl => setAudioLevel(lvl));
        return () => {
            unsubStatus();
            unsubLevel();
        };
    }, []);

    const toggleEngine = () => {
        if (isRunning) {
            transcriberEngine.stop();
            showToast("Audio Transcriber paused", Toasts.Type.INFO);
        } else {
            transcriberEngine.start(settings.store.language || "fr");
            showToast("Audio Transcriber listening", Toasts.Type.SUCCESS);
        }
    };

    const handleSaveKey = async () => {
        await setGroqKey(apiKey);
        setKeySaved(true);
        showToast("API Key saved", Toasts.Type.SUCCESS);
        setTimeout(() => setKeySaved(false), 2000);
    };

    return (
        <div style={{ width: "100%", marginTop: "10px" }}>
            {/* Status & Controls Card */}
            <Card variant="primary" outline style={{ padding: "16px", background: "var(--background-secondary, #2b2d31)", borderRadius: "8px", marginBottom: "14px" }}>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%", marginBottom: "12px" }}>
                    <div>
                        <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "14px", display: "block" }}>
                            {t("Live Speech Recognition Engine")}
                        </span>
                        <span style={{ color: isRunning ? "var(--status-positive, #43b581)" : "var(--text-muted, #949ba4)", fontSize: "12px" }}>
                            {isRunning ? `● ${t("Active & Listening")} (${settings.store.language || "fr"})` : `○ ${t("Idle / Waiting for voice call")}`}
                        </span>
                    </div>
                    <Flex alignItems={FlexAlign.CENTER} gap="8px">
                        <Button
                            variant="secondary"
                            onClick={() => {
                                openModal(props => <SubtitleHistoryModal onClose={props.onClose} transitionState={props.transitionState} />);
                            }}
                        >
                            {t("View Transcript History")}
                        </Button>
                        <Button
                            variant={isRunning ? "dangerPrimary" : "primary"}
                            onClick={toggleEngine}
                        >
                            {isRunning ? t("Stop Listening") : t("Start Listening")}
                        </Button>
                    </Flex>
                </Flex>

                {/* Live VU Meter Bar */}
                <div style={{ marginTop: "8px" }}>
                    <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ marginBottom: "4px" }}>
                        <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "11px", textTransform: "uppercase", fontWeight: 600 }}>
                            {t("Audio Signal Level")}
                        </span>
                        <span style={{ color: audioLevel > 10 ? "var(--status-positive, #43b581)" : "var(--text-muted, #949ba4)", fontSize: "11px", fontWeight: 600 }}>
                            {audioLevel}%
                        </span>
                    </Flex>
                    <div style={{ width: "100%", height: "6px", backgroundColor: "rgba(0,0,0,0.3)", borderRadius: "3px", overflow: "hidden" }}>
                        <div
                            style={{
                                width: `${audioLevel}%`,
                                height: "100%",
                                backgroundColor: audioLevel > 50 ? "#43b581" : "#5865F2",
                                transition: "width 0.08s ease"
                            }}
                        />
                    </div>
                </div>
            </Card>

            {/* Groq API Key Card */}
            <Card variant="primary" outline style={{ padding: "16px", background: "var(--background-secondary, #2b2d31)", borderRadius: "8px" }}>
                <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "13px", display: "block", marginBottom: "4px" }}>
                    {t("Groq Whisper Turbo Engine (Recommended for 100% Accuracy)")}
                </span>
                <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px", display: "block", marginBottom: "10px", lineHeight: "1.4" }}>
                    {t("Get a free API key with ultra-fast Whisper Large Turbo at ")}
                    <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: "var(--text-link)" }}>
                        console.groq.com/keys
                    </a>
                </span>
                <Flex alignItems={FlexAlign.CENTER} gap="8px">
                    <TextInput
                        value={apiKey}
                        onChange={(v: string) => setApiKeyState(v)}
                        placeholder="gsk_..."
                        type="password"
                        style={{ flex: 1 }}
                    />
                    <Button
                        variant={keySaved ? "positive" : "primary"}
                        onClick={handleSaveKey}
                    >
                        {keySaved ? t("Saved") : t("Save Key")}
                    </Button>
                </Flex>
            </Card>
        </div>
    );
}

export default definePlugin({
    name: "AudioTranscriber",
    description: "Listens to users speaking in your voice channel and displays real-time live subtitles on your screen.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: AudioTranscriberSettingsComponent,

    flux: {
        RTC_CONNECTION_STATE({ state }: { state: string; }) {
            if (state === "RTC_CONNECTED") {
                transcriberEngine.start(settings.store.language || "fr");
            } else if (state === "DISCONNECTED" && !settings.store.alwaysOn) {
                transcriberEngine.stop();
            }
        },
        VOICE_STATE_UPDATES() {
            const currentVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
            if (currentVoiceChannelId && !transcriberEngine.getStatus()) {
                transcriberEngine.start(settings.store.language || "fr");
            } else if (!currentVoiceChannelId && !settings.store.alwaysOn && transcriberEngine.getStatus()) {
                transcriberEngine.stop();
            }
        }
    },

    start() {
        renderOverlay();

        if (settings.store.alwaysOn || SelectedChannelStore.getVoiceChannelId()) {
            transcriberEngine.start(settings.store.language || "fr");
        }
    },

    stop() {
        transcriberEngine.stop();
        removeOverlay();
    }
});
