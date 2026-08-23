/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeadphonesIcon, ScreenshareIcon } from "@components/Icons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { MediaEngineStore, Menu, React, RunningGameStore } from "@webpack/common";

export interface StreamAudioSettingsState {
    selectedAppPids: number[];
    selectedDeviceId: string | null;
    isolateDiscordVoice: boolean;
}

export const streamAudioState: StreamAudioSettingsState = {
    selectedAppPids: [],
    selectedDeviceId: "default",
    isolateDiscordVoice: true
};

export function applyStreamAudio(pids?: number[] | string | null, deviceId?: string | null) {
    try {
        const engine = (MediaEngineStore as any)?.getMediaEngine?.();
        if (!engine) return;

        const effectivePids = pids !== undefined
            ? (Array.isArray(pids) ? pids : (pids === "system" ? [] : []))
            : streamAudioState.selectedAppPids;
        const effectiveDevice = deviceId !== undefined ? deviceId : streamAudioState.selectedDeviceId;

        if (effectivePids.length > 0) {
            // Check if engine supports multi-source soundshare array
            if (typeof engine.setSoundshareSources === "function") {
                engine.setSoundshareSources(effectivePids, true);
            } else if (typeof engine.setSoundshareSource === "function") {
                // Hook each individual process
                for (const pid of effectivePids) {
                    engine.setSoundshareSource(pid, true);
                }
            }
        } else if (typeof engine.setSoundshareSource === "function") {
            // Default system soundshare
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

    const isEntireSystem = streamAudioState.selectedAppPids.length === 0;

    const toggleAppPid = (pid: number) => {
        const index = streamAudioState.selectedAppPids.indexOf(pid);
        if (index > -1) {
            streamAudioState.selectedAppPids = streamAudioState.selectedAppPids.filter(p => p !== pid);
        } else {
            streamAudioState.selectedAppPids = [...streamAudioState.selectedAppPids, pid];
        }
        applyStreamAudio(streamAudioState.selectedAppPids);
    };

    const appMenuItems = (
        <Menu.MenuItem
            id="stream-audio-app-selector"
            label="Stream Audio Application"
            icon={ScreenshareIcon}
        >
            <Menu.MenuCheckboxItem
                id="stream-audio-app-system"
                label="Entire System (Default)"
                checked={isEntireSystem}
                action={() => {
                    streamAudioState.selectedAppPids = [];
                    applyStreamAudio([]);
                }}
            />
            <Menu.MenuSeparator />
            {appsList.length > 0 ? (
                appsList.map(app => (
                    <Menu.MenuCheckboxItem
                        key={app.pid}
                        id={`stream-audio-app-${app.pid}`}
                        label={app.name}
                        checked={streamAudioState.selectedAppPids.includes(app.pid)}
                        action={() => toggleAppPid(app.pid)}
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
            icon={HeadphonesIcon}
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
                if (streamAudioState.isolateDiscordVoice && streamAudioState.selectedAppPids.length === 0 && appsList.length > 0) {
                    streamAudioState.selectedAppPids = [appsList[0].pid];
                    applyStreamAudio(streamAudioState.selectedAppPids);
                } else if (!streamAudioState.isolateDiscordVoice) {
                    streamAudioState.selectedAppPids = [];
                    applyStreamAudio([]);
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
