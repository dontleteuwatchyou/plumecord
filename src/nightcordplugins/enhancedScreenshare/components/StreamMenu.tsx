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
    selectedAppPids: number[];
    selectedDeviceId: string | null;
    isolateDiscordVoice: boolean;
    appVolumes: Record<number, number>;
}

export const streamAudioState: StreamAudioSettingsState = {
    selectedAppPids: [],
    selectedDeviceId: "default",
    isolateDiscordVoice: true,
    appVolumes: {}
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
            if (typeof engine.setSoundshareSources === "function") {
                engine.setSoundshareSources(effectivePids, true);
            } else if (typeof engine.setSoundshareSource === "function") {
                for (const pid of effectivePids) {
                    engine.setSoundshareSource(pid, true);
                }
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
        console.error("[EnhancedScreenshare] Failed to apply stream audio:", err);
    }
}

function AppVolumeSlider({ pid, name }: { pid: number; name: string; }) {
    const currentVolume = streamAudioState.appVolumes[pid] ?? 100;
    const [val, setVal] = React.useState(currentVolume);

    return (
        <Menu.MenuControlItem
            id={`enhanced-screenshare-vol-ctrl-${pid}`}
            label={`${name} (${val}%)`}
            control={(props: any, ref: any) => (
                <Menu.MenuSliderControl
                    {...props}
                    ref={ref}
                    value={val}
                    minValue={0}
                    maxValue={200}
                    renderValue={() => `${val}%`}
                    onChange={(newVal: number) => {
                        const rounded = Math.round(newVal);
                        setVal(rounded);
                        streamAudioState.appVolumes[pid] = rounded;
                    }}
                />
            )}
        />
    );
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
            id="enhanced-screenshare-app-selector"
            label="Stream Audio Application"
            icon={ScreenshareIcon}
        >
            <Menu.MenuCheckboxItem
                id="enhanced-screenshare-app-system"
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
                    <Menu.MenuItem
                        key={app.pid}
                        id={`enhanced-screenshare-app-menu-${app.pid}`}
                        label={app.name}
                    >
                        <Menu.MenuCheckboxItem
                            id={`enhanced-screenshare-app-chk-${app.pid}`}
                            label="Include in Stream"
                            checked={streamAudioState.selectedAppPids.includes(app.pid)}
                            action={() => toggleAppPid(app.pid)}
                        />
                        <Menu.MenuSeparator />
                        <AppVolumeSlider pid={app.pid} name={app.name} />
                    </Menu.MenuItem>
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

    const volumeMixerItems = (
        <Menu.MenuItem
            id="enhanced-screenshare-volume-mixer"
            label="Application Volume Mixer"
        >
            {appsList.length > 0 ? (
                appsList.map(app => (
                    <AppVolumeSlider key={app.pid} pid={app.pid} name={app.name} />
                ))
            ) : (
                <Menu.MenuItem
                    id="enhanced-screenshare-vol-empty"
                    label="No running applications detected"
                    disabled={true}
                />
            )}
        </Menu.MenuItem>
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
            {volumeMixerItems}
            {deviceMenuItems}
            {voiceIsolateItem}
            {previewGalleryItem}
        </Menu.MenuGroup>
    );
};
