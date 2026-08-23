/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeadphonesIcon, ImageIcon, ScreenshareIcon } from "@components/Icons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { MediaEngineStore, Menu, React, RunningGameStore } from "@webpack/common";

import { openPreviewGalleryModal } from "./PreviewGalleryModal";

export interface StreamAudioSettingsState {
    selectedAppPid: number | "system" | null;
    selectedDeviceId: string | null;
    isolateDiscordVoice: boolean;
    streamVolume: number;
    appVolumes: Record<number, number>;
}

export const streamAudioState: StreamAudioSettingsState = {
    selectedAppPid: "system",
    selectedDeviceId: "default",
    isolateDiscordVoice: true,
    streamVolume: 100,
    appVolumes: {}
};

export function applyStreamAudio(pid?: number | "system" | null, deviceId?: string | null) {
    try {
        const engine = (MediaEngineStore as any)?.getMediaEngine?.();
        if (!engine) return;

        const effectivePid = pid !== undefined ? pid : streamAudioState.selectedAppPid;
        const effectiveDevice = deviceId !== undefined ? deviceId : streamAudioState.selectedDeviceId;

        if (effectivePid && effectivePid !== "system" && typeof effectivePid === "number") {
            if (typeof engine.setSoundshareSource === "function") {
                engine.setSoundshareSource(effectivePid, true);
            }
        } else if (typeof engine.setSoundshareSource === "function") {
            // Null / false disables the single-PID filter, allowing native full desktop audio loopback
            try {
                engine.setSoundshareSource(null, false);
            } catch {
                try {
                    engine.setSoundshareSource(undefined, false);
                } catch {
                    // fallback
                }
            }
        }

        if (effectiveDevice && effectiveDevice !== "default") {
            if (typeof engine.setGoLiveDevices === "function") {
                engine.setGoLiveDevices({
                    audio: {
                        deviceId: effectiveDevice
                    }
                });
            }
        }
    } catch (err) {
        console.error("[EnhancedScreenshare] Failed to apply stream audio:", err);
    }
}

export const streamAudioContextMenuPatch: NavContextMenuPatchCallback = (children) => {
    const runningGames = (RunningGameStore as any)?.getRunningGames?.() ?? [];
    const visibleGames = (RunningGameStore as any)?.getVisibleRunningGames?.() ?? [];
    const candidateGames = (RunningGameStore as any)?.getCandidateGames?.() ?? [];

    const appsMap = new Map<number, { name: string; pid: number; }>();
    for (const g of [...runningGames, ...visibleGames, ...candidateGames]) {
        if (g && g.pid && g.name) {
            appsMap.set(g.pid, { name: g.name, pid: g.pid });
        }
    }
    const appsList = Array.from(appsMap.values());

    const rawDevices = (MediaEngineStore as any)?.getOutputDevices?.() ?? {};
    const devicesList: Array<{ id: string; name: string; }> = Array.isArray(rawDevices)
        ? rawDevices
        : Object.values(rawDevices);

    const isEntireSystem = !streamAudioState.selectedAppPid || streamAudioState.selectedAppPid === "system";

    const appMenuItems = (
        <Menu.MenuItem
            id="enhanced-screenshare-app-selector"
            label="Stream Audio Application"
            icon={ScreenshareIcon}
        >
            <Menu.MenuRadioItem
                id="enhanced-screenshare-app-system"
                group="enhanced-screenshare-app-group"
                label="Entire System (Default - All Sounds)"
                checked={isEntireSystem}
                action={() => {
                    streamAudioState.selectedAppPid = "system";
                    applyStreamAudio("system");
                }}
            />
            <Menu.MenuSeparator />
            {appsList.length > 0 ? (
                appsList.map(app => (
                    <Menu.MenuRadioItem
                        key={app.pid}
                        id={`enhanced-screenshare-app-${app.pid}`}
                        group="enhanced-screenshare-app-group"
                        label={app.name}
                        checked={streamAudioState.selectedAppPid === app.pid}
                        action={() => {
                            streamAudioState.selectedAppPid = app.pid;
                            applyStreamAudio(app.pid);
                        }}
                    />
                ))
            ) : (
                <Menu.MenuItem
                    id="enhanced-screenshare-app-empty"
                    label="No running applications detected"
                    disabled={true}
                />
            )}
        </Menu.MenuItem>
    );

    const streamVolumeControlItem = (
        <Menu.MenuControlItem
            id="enhanced-screenshare-main-volume"
            label={`Stream Audio Volume (${streamAudioState.streamVolume}%)`}
            control={(props: any, ref: any) => (
                <Menu.MenuSliderControl
                    {...props}
                    ref={ref}
                    value={streamAudioState.streamVolume}
                    minValue={0}
                    maxValue={200}
                    renderValue={() => `${streamAudioState.streamVolume}%`}
                    onChange={(newVal: number) => {
                        const rounded = Math.round(newVal);
                        streamAudioState.streamVolume = rounded;
                        try {
                            const engine = (MediaEngineStore as any)?.getMediaEngine?.();
                            if (engine?.setLocalVolume) {
                                engine.setLocalVolume(rounded);
                            }
                        } catch {
                            // ignore
                        }
                    }}
                />
            )}
        />
    );

    const deviceMenuItems = (
        <Menu.MenuItem
            id="enhanced-screenshare-device-selector"
            label="Stream Output Device"
            icon={HeadphonesIcon}
        >
            <Menu.MenuRadioItem
                id="enhanced-screenshare-device-default"
                group="enhanced-screenshare-device-group"
                label="Default Output Device"
                checked={!streamAudioState.selectedDeviceId || streamAudioState.selectedDeviceId === "default"}
                action={() => {
                    streamAudioState.selectedDeviceId = "default";
                    applyStreamAudio(undefined, "default");
                }}
            />
            <Menu.MenuSeparator />
            {devicesList.length > 0 ? (
                devicesList.map(dev => (
                    <Menu.MenuRadioItem
                        key={dev.id}
                        id={`enhanced-screenshare-dev-${dev.id}`}
                        group="enhanced-screenshare-device-group"
                        label={dev.name}
                        checked={streamAudioState.selectedDeviceId === dev.id}
                        action={() => {
                            streamAudioState.selectedDeviceId = dev.id;
                            applyStreamAudio(undefined, dev.id);
                        }}
                    />
                ))
            ) : (
                <Menu.MenuItem
                    id="enhanced-screenshare-device-empty"
                    label="No audio output devices found"
                    disabled={true}
                />
            )}
        </Menu.MenuItem>
    );

    const voiceIsolateItem = (
        <Menu.MenuCheckboxItem
            id="enhanced-screenshare-isolate-voice"
            label="Isolate Discord Voice (Prevent Echo)"
            checked={streamAudioState.isolateDiscordVoice}
            action={() => {
                streamAudioState.isolateDiscordVoice = !streamAudioState.isolateDiscordVoice;
                if (streamAudioState.isolateDiscordVoice && streamAudioState.selectedAppPid === "system" && appsList.length > 0) {
                    streamAudioState.selectedAppPid = appsList[0].pid;
                    applyStreamAudio(appsList[0].pid);
                } else if (!streamAudioState.isolateDiscordVoice) {
                    streamAudioState.selectedAppPid = "system";
                    applyStreamAudio("system");
                }
            }}
        />
    );

    const previewGalleryItem = (
        <Menu.MenuItem
            id="enhanced-screenshare-custom-preview"
            label="Custom Stream Preview"
            icon={ImageIcon}
            action={openPreviewGalleryModal}
        />
    );

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuGroup label="Enhanced Screenshare">
            {appMenuItems}
            {streamVolumeControlItem}
            {deviceMenuItems}
            {voiceIsolateItem}
            {previewGalleryItem}
        </Menu.MenuGroup>
    );
};
