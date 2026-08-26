/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, React, Slider, Text, TextInput, showToast, Toasts } from "@webpack/common";
import { FormSwitch } from "@components/FormSwitch";
import { ModalSize } from "@utils/modal";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { fakeStreamEngine } from "./engine";
import { FakeStreamConfig, StreamTarget } from "./types";
import { t } from "../autoTranslateNightcord";

function formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function FakeStreamingModal({ onClose, transitionState }: { onClose: () => void; transitionState: any; }) {
    const [config, setConfig] = React.useState<FakeStreamConfig>(() => fakeStreamEngine.getConfig());
    const [currentTime, setCurrentTime] = React.useState(0);
    const [duration, setDuration] = React.useState(0);
    const [isPlaying, setIsPlaying] = React.useState(false);

    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const previewVideoRef = React.useRef<HTMLVideoElement>(null);

    React.useEffect(() => {
        const unsub = fakeStreamEngine.subscribe(() => {
            setConfig(fakeStreamEngine.getConfig());
        });
        return () => unsub();
    }, []);

    React.useEffect(() => {
        const engineVideo = fakeStreamEngine.getVideoElement();
        if (!engineVideo) return;

        const handleTimeUpdate = () => {
            setCurrentTime(engineVideo.currentTime || 0);
            setDuration(engineVideo.duration || 0);
            setIsPlaying(!engineVideo.paused);
        };

        engineVideo.addEventListener("timeupdate", handleTimeUpdate);
        engineVideo.addEventListener("loadedmetadata", handleTimeUpdate);
        engineVideo.addEventListener("play", handleTimeUpdate);
        engineVideo.addEventListener("pause", handleTimeUpdate);

        return () => {
            engineVideo.removeEventListener("timeupdate", handleTimeUpdate);
            engineVideo.removeEventListener("loadedmetadata", handleTimeUpdate);
            engineVideo.removeEventListener("play", handleTimeUpdate);
            engineVideo.removeEventListener("pause", handleTimeUpdate);
        };
    }, []);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        await fakeStreamEngine.loadVideoBlob(file);
        showToast("Video loaded", Toasts.Type.SUCCESS);
    };

    const handleToggleActive = () => {
        const nextActive = !config.active;
        fakeStreamEngine.updateConfig({ active: nextActive });
        if (nextActive) {
            fakeStreamEngine.play();
            showToast("Fake Streaming activated", Toasts.Type.SUCCESS);
        } else {
            fakeStreamEngine.pause();
            showToast("Fake Streaming stopped", Toasts.Type.INFO);
        }
    };

    const handleTogglePlayPause = () => {
        if (isPlaying) {
            fakeStreamEngine.pause();
        } else {
            fakeStreamEngine.play();
        }
    };

    return (
        <ModalRoot transitionState={transitionState} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false} style={{ padding: "20px 24px 12px 24px" }}>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <div>
                        <h2 style={{ color: "#ffffff", fontSize: "18px", fontWeight: 700, margin: 0 }}>
                            {t("Fake Streaming Control Panel")}
                        </h2>
                        <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "13px" }}>
                            {config.videoName || t("No video selected")}
                        </span>
                    </div>
                    <ModalCloseButton onClick={onClose} />
                </Flex>
            </ModalHeader>

            <ModalContent style={{ padding: "12px 24px 24px 24px" }}>
                {/* Video Live Preview Area */}
                <div style={{
                    width: "100%",
                    height: "220px",
                    backgroundColor: "#000000",
                    borderRadius: "10px",
                    overflow: "hidden",
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "16px",
                    border: "1px solid rgba(255, 255, 255, 0.08)"
                }}>
                    {config.videoUrl ? (
                        <video
                            ref={previewVideoRef}
                            src={config.videoUrl}
                            autoPlay={config.active}
                            loop={config.loop}
                            muted
                            playsInline
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                    ) : (
                        <div style={{ textAlign: "center", color: "var(--text-muted, #949ba4)" }}>
                            <span style={{ fontSize: "14px", display: "block", marginBottom: "4px" }}>
                                {t("No Video Loaded")}
                            </span>
                            <span style={{ fontSize: "12px" }}>
                                {t("Select a local video file (.mp4, .webm, .mkv) or paste a video URL below.")}
                            </span>
                        </div>
                    )}

                    {/* Status Badge */}
                    <div style={{
                        position: "absolute",
                        top: "10px",
                        left: "10px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        backgroundColor: config.active ? "rgba(67, 181, 129, 0.85)" : "rgba(0, 0, 0, 0.75)",
                        backdropFilter: "blur(6px)",
                        color: "#ffffff",
                        fontSize: "11px",
                        fontWeight: 700,
                        letterSpacing: "0.5px"
                    }}>
                        {config.active ? t("LIVE BROADCASTING") : t("STOPPED")}
                    </div>
                </div>

                {/* Video Playback Scrubber & Time */}
                {config.videoUrl && (
                    <div style={{ marginBottom: "16px", background: "var(--background-secondary, #2b2d31)", padding: "10px 14px", borderRadius: "8px" }}>
                        <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ marginBottom: "6px" }}>
                            <Button
                                variant="secondary"
                                size="small"
                                onClick={handleTogglePlayPause}
                            >
                                {isPlaying ? t("Pause") : t("Play")}
                            </Button>
                            <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px", fontFamily: "monospace" }}>
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </span>
                        </Flex>
                        <Slider
                            initialValue={currentTime}
                            onValueChange={(val: number) => fakeStreamEngine.seek(val)}
                            minValue={0}
                            maxValue={duration || 100}
                            stickToMarkers={false}
                        />
                    </div>
                )}

                {/* File Upload and URL Input */}
                <div style={{ marginBottom: "16px" }}>
                    <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>
                        {t("Video Source")}
                    </span>
                    <Flex alignItems={FlexAlign.CENTER} gap="8px" style={{ width: "100%" }}>
                        <TextInput
                            value={config.videoUrl}
                            onChange={(val: string) => fakeStreamEngine.updateConfig({ videoUrl: val.trim(), videoName: "Custom URL" })}
                            placeholder="https://example.com/stream.mp4"
                            style={{ flex: 1 }}
                        />
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/*,.mp4,.webm,.mkv,.mov,.avi"
                            onChange={handleFileUpload}
                            style={{ display: "none" }}
                        />
                        <Button
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                            style={{ whiteSpace: "nowrap" }}
                        >
                            {t("Choose Video File")}
                        </Button>
                    </Flex>
                </div>

                {/* Broadcast Target Selection */}
                <div style={{ marginBottom: "16px" }}>
                    <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "8px" }}>
                        {t("Broadcast Target")}
                    </span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                        <Button
                            variant={config.target === "both" ? "primary" : "secondary"}
                            onClick={() => fakeStreamEngine.updateConfig({ target: "both" })}
                            style={{ fontSize: "12px", padding: "8px" }}
                        >
                            {t("Webcam & Screen")}
                        </Button>
                        <Button
                            variant={config.target === "camera" ? "primary" : "secondary"}
                            onClick={() => fakeStreamEngine.updateConfig({ target: "camera" })}
                            style={{ fontSize: "12px", padding: "8px" }}
                        >
                            {t("Webcam Only")}
                        </Button>
                        <Button
                            variant={config.target === "screenshare" ? "primary" : "secondary"}
                            onClick={() => fakeStreamEngine.updateConfig({ target: "screenshare" })}
                            style={{ fontSize: "12px", padding: "8px" }}
                        >
                            {t("Screen Share Only")}
                        </Button>
                    </div>
                </div>

                {/* Toggles: Audio & Loop */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <FormSwitch
                        value={config.loop}
                        onChange={(val: boolean) => fakeStreamEngine.updateConfig({ loop: val })}
                        title={t("Loop Video Continuously")}
                        description={t("Automatically restarts the video from the beginning when it reaches the end.")}
                    />
                    <FormSwitch
                        value={config.includeAudio}
                        onChange={(val: boolean) => fakeStreamEngine.updateConfig({ includeAudio: val })}
                        title={t("Broadcast Video Audio")}
                        description={t("Replaces your microphone input with the audio track of the pre-recorded video.")}
                    />
                </div>
            </ModalContent>

            <ModalFooter>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <Button
                        variant={config.active ? "dangerPrimary" : "positive"}
                        onClick={handleToggleActive}
                        disabled={!config.videoUrl}
                    >
                        {config.active ? t("Stop Fake Streaming") : t("Start Fake Streaming")}
                    </Button>
                    <Button variant="secondary" onClick={onClose}>
                        {t("Close")}
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>
    );
}
