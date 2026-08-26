/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Button, FormSwitch, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal, React, ReactDOM, SelectedChannelStore, Slider, Text, VoiceStateStore, showToast, Toasts } from "@webpack/common";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { transcriberEngine } from "./engine";
import { SubtitleOverlay, SubtitleHistoryModal } from "./SubtitleOverlay";
import { TranscriberSettings } from "./types";
import { t } from "../autoTranslateNightcord";

const settings = definePluginSettings({
    language: {
        type: OptionType.SELECT,
        description: "Transcription language for speech recognition.",
        options: [
            { label: "French (Français)", value: "fr-FR", default: true },
            { label: "English (US)", value: "en-US" },
            { label: "English (UK)", value: "en-GB" },
            { label: "Spanish (Español)", value: "es-ES" },
            { label: "German (Deutsch)", value: "de-DE" },
            { label: "Italian (Italiano)", value: "it-IT" },
            { label: "Russian (Русский)", value: "ru-RU" },
            { label: "Arabic (العربية)", value: "ar-SA" },
            { label: "Chinese (中文)", value: "zh-CN" },
            { label: "Japanese (日本語)", value: "ja-JP" }
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

function renderOverlay() {
    if (!overlayContainer) {
        overlayContainer = document.createElement("div");
        overlayContainer.id = "nc-audio-transcriber-overlay";
        document.body.appendChild(overlayContainer);
    }

    const currentSettings: TranscriberSettings = {
        language: settings.store.language || "fr-FR",
        fontSize: settings.store.fontSize || 16,
        bgOpacity: settings.store.bgOpacity || 85,
        fadeDelay: settings.store.fadeDelay || 5,
        showAvatar: settings.store.showAvatar !== false,
        showUsername: settings.store.showUsername !== false,
        position: settings.store.position || "bottom",
        alwaysOn: !!settings.store.alwaysOn
    };

    ReactDOM.render(
        <SubtitleOverlay settings={currentSettings} />,
        overlayContainer
    );
}

function removeOverlay() {
    if (overlayContainer) {
        try { ReactDOM.unmountComponentAtNode(overlayContainer); } catch { }
        try { overlayContainer.remove(); } catch { }
        overlayContainer = null;
    }
}

function AudioTranscriberSettingsComponent() {
    const [isRunning, setIsRunning] = React.useState(() => transcriberEngine.getStatus());

    React.useEffect(() => {
        const unsub = transcriberEngine.subscribeStatus(active => setIsRunning(active));
        return () => unsub();
    }, []);

    const toggleEngine = () => {
        if (isRunning) {
            transcriberEngine.stop();
            showToast("Audio Transcriber paused", Toasts.Type.INFO);
        } else {
            transcriberEngine.start(settings.store.language || "fr-FR");
            showToast("Audio Transcriber listening", Toasts.Type.SUCCESS);
        }
    };

    return (
        <div style={{ width: "100%", marginTop: "10px" }}>
            <Card variant="primary" outline style={{ padding: "16px", background: "var(--background-secondary, #2b2d31)", borderRadius: "8px", marginBottom: "12px" }}>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <div>
                        <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "14px", display: "block" }}>
                            {t("Live Speech Recognition Engine")}
                        </span>
                        <span style={{ color: isRunning ? "var(--status-positive, #43b581)" : "var(--text-muted, #949ba4)", fontSize: "12px" }}>
                            {isRunning ? `● ${t("Active & Listening")} (${settings.store.language || "fr-FR"})` : `○ ${t("Idle / Waiting for voice call")}`}
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
                transcriberEngine.start(settings.store.language || "fr-FR");
            } else if (state === "DISCONNECTED" && !settings.store.alwaysOn) {
                transcriberEngine.stop();
            }
        },
        VOICE_STATE_UPDATES() {
            const currentVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
            if (currentVoiceChannelId && !transcriberEngine.getStatus()) {
                transcriberEngine.start(settings.store.language || "fr-FR");
            } else if (!currentVoiceChannelId && !settings.store.alwaysOn && transcriberEngine.getStatus()) {
                transcriberEngine.stop();
            }
        }
    },

    start() {
        renderOverlay();

        if (settings.store.alwaysOn || SelectedChannelStore.getVoiceChannelId()) {
            transcriberEngine.start(settings.store.language || "fr-FR");
        }
    },

    stop() {
        transcriberEngine.stop();
        removeOverlay();
    }
});
