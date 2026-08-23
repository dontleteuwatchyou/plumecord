/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeadphoneIcon, SpeakerIcon, SystemAudioIcon } from "@components/Icons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { MediaEngineStore, Menu, React, RunningGameStore } from "@webpack/common";

export interface StreamAudioSettingsState {
    selectedAppPid: number | string | null;
    selectedDeviceId: string | null;
    isolateDiscordVoice: boolean;
}

export const streamAudioState: StreamAudioSettingsState = {
    selectedAppPid: "system",
    selectedDeviceId: "default",
    isolateDiscordVoice: true
};

export function applyStreamAudio(pid?: number | string | null, deviceId?: string | null) {
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
            engine.setSoundshareSource(0, true);
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
        console.error("[StreamAudioSelector] Failed to apply stream audio:", err);
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

    const appMenuItems = (
        <Menu.MenuItem
            id="stream-audio-app-selector"
            label="Stream Audio Application"
            icon={SystemAudioIcon}
        >
            <Menu.MenuRadioItem
                id="stream-audio-app-system"
                group="stream-audio-app-group"
                label="Entire System (Default)"
                checked={!streamAudioState.selectedAppPid || streamAudioState.selectedAppPid === "system"}
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
                        id={`stream-audio-app-${app.pid}`}
                        group="stream-audio-app-group"
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
                    id="stream-audio-app-empty"
                    label="No running applications detected"
                    disabled={true}
                />
            )}
        </Menu.MenuItem>
    );

    const deviceMenuItems = (
        <Menu.MenuItem
            id="stream-audio-device-selector"
            label="Stream Output Device"
            icon={SpeakerIcon}
        >
            <Menu.MenuRadioItem
                id="stream-audio-device-default"
                group="stream-audio-device-group"
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
                        id={`stream-audio-dev-${dev.id}`}
                        group="stream-audio-device-group"
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
                    id="stream-audio-device-empty"
                    label="No audio output devices found"
                    disabled={true}
                />
            )}
        </Menu.MenuItem>
    );

    const voiceIsolateItem = (
        <Menu.MenuCheckboxItem
            id="stream-audio-isolate-voice"
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

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuGroup label="Stream Audio Settings">
            {appMenuItems}
            {deviceMenuItems}
            {voiceIsolateItem}
        </Menu.MenuGroup>
    );
};
