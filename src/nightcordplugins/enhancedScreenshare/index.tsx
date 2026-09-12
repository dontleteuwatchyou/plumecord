/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { FluxDispatcher, MediaEngineStore, Menu, React, RunningGameStore } from "@webpack/common";

import { t } from "../autoTranslateNightcord";

export interface StreamAudioState {
    selectedAppPids: number[];
}

export const streamAudioState: StreamAudioState = {
    selectedAppPids: []
};

function StreamAudioIcon(props: any) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}>
            <path
                d="M4 4H20C21.1 4 22 4.9 22 6V16C22 17.1 21.1 18 20 18H14L15 20H17V22H7V20H9L10 18H4C2.9 18 2 17.1 2 16V6C2 4.9 2.9 4 4 4ZM4 6V16H20V6H4Z"
                fill="currentColor"
            />
        </svg>
    );
}

export function formatCleanAppName(rawName: string): string {
    if (!rawName) return "Application";

    // Strip path if raw path like C:\Windows\System32\cmd.exe
    let clean = rawName.split(/[\\/]/).pop() ?? rawName;

    // Detect common browsers and applications
    const lower = clean.toLowerCase();
    if (lower === "cmd.exe" || lower === "cmd") return "Command Prompt";
    if (lower === "powershell.exe" || lower === "powershell") return "PowerShell";
    if (lower === "spotify.exe" || lower === "spotify") return "Spotify";
    if (lower.includes("chrome") || lower.includes("google chrome")) return "Google Chrome";
    if (lower.includes("brave")) return "Brave Browser";
    if (lower.includes("msedge") || lower.includes("edge")) return "Microsoft Edge";
    if (lower.includes("firefox")) return "Mozilla Firefox";
    if (lower.includes("discord") || lower.includes("nightcord")) return "Discord";
    if (lower.includes("vlc")) return "VLC Media Player";
    if (lower.includes("roblox")) return "Roblox";
    if (lower.includes("steam")) return "Steam";
    if (lower.includes("youtube")) return "YouTube";

    // Clean browser window titles like "Song - YouTube - Google Chrome"
    if (clean.includes(" - Google Chrome")) return "Google Chrome";
    if (clean.includes(" - Brave")) return "Brave Browser";
    if (clean.includes(" - Microsoft Edge") || clean.includes(" - Edge")) return "Microsoft Edge";
    if (clean.includes(" - Mozilla Firefox")) return "Mozilla Firefox";
    if (clean.includes(" - Discord")) return "Discord";

    // Remove window subtitles after dashes if long
    if (clean.includes(" — ")) {
        clean = clean.split(" — ")[0];
    } else if (clean.includes(" - ")) {
        clean = clean.split(" - ")[0];
    }

    if (clean.toLowerCase().endsWith(".exe")) {
        clean = clean.slice(0, -4);
    }

    clean = clean.trim();
    if (clean.length > 30) {
        clean = clean.slice(0, 27) + "...";
    }

    return clean;
}

export function applyStreamAudio(pids?: number[]) {
    try {
        const engine = (MediaEngineStore as any)?.getMediaEngine?.();
        if (!engine) return;

        const effectivePids = pids !== undefined ? pids : streamAudioState.selectedAppPids;

        if (effectivePids.length > 0) {
            if (typeof engine.setSoundshareSources === "function") {
                engine.setSoundshareSources(effectivePids, true);
            } else if (typeof engine.setSoundshareSource === "function") {
                for (const pid of effectivePids) {
                    engine.setSoundshareSource(pid, true);
                }
            }

            if (engine.connections) {
                for (const conn of engine.connections) {
                    if (typeof conn.setSoundshareSource === "function") {
                        for (const pid of effectivePids) {
                            try {
                                conn.setSoundshareSource(pid, true);
                            } catch { }
                        }
                    }
                }
            }
        } else {
            if (typeof engine.setSoundshareSources === "function") {
                try {
                    engine.setSoundshareSources([], false);
                } catch { }
            }
            if (typeof engine.setSoundshareSource === "function") {
                try {
                    engine.setSoundshareSource(0, false);
                } catch {
                    try {
                        engine.setSoundshareSource(null, false);
                    } catch { }
                }
            }
            if (engine.connections) {
                for (const conn of engine.connections) {
                    if (typeof conn.setSoundshareSource === "function") {
                        try {
                            conn.setSoundshareSource(0, false);
                        } catch { }
                    }
                }
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
    const gamesSeen = ((RunningGameStore as any)?.getGamesSeen?.(true) ?? []).filter((g: any) => g?.pid);

    const appsMap = new Map<number, { name: string; pid: number }>();
    for (const g of [...runningGames, ...visibleGames, ...candidateGames, ...gamesSeen]) {
        if (g && typeof g.pid === "number" && g.pid > 0 && g.name) {
            const cleanName = formatCleanAppName(g.name);
            appsMap.set(g.pid, { name: cleanName, pid: g.pid });
        }
    }

    const appsList = Array.from(appsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    // Distinguish duplicate names with PID
    const countByName = new Map<string, number>();
    for (const app of appsList) {
        countByName.set(app.name, (countByName.get(app.name) ?? 0) + 1);
    }

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
            label={t("Stream Audio Application")}
            icon={StreamAudioIcon}
        >
            <Menu.MenuCheckboxItem
                id="enhanced-screenshare-app-system"
                label={t("Entire System (Default - All Sounds)")}
                checked={isEntireSystem}
                action={() => {
                    streamAudioState.selectedAppPids = [];
                    applyStreamAudio([]);
                }}
            />
            <Menu.MenuSeparator />
            {appsList.length > 0 ? (
                appsList.map(app => {
                    const hasDuplicates = (countByName.get(app.name) ?? 0) > 1;
                    const displayLabel = hasDuplicates ? `${app.name} (${app.pid})` : app.name;
                    return (
                        <Menu.MenuCheckboxItem
                            key={app.pid}
                            id={`enhanced-screenshare-app-chk-${app.pid}`}
                            label={displayLabel}
                            checked={streamAudioState.selectedAppPids.includes(app.pid)}
                            action={() => toggleAppPid(app.pid)}
                        />
                    );
                })
            ) : (
                <Menu.MenuItem
                    id="enhanced-screenshare-app-empty"
                    label={t("No running applications detected")}
                    disabled={true}
                />
            )}
        </Menu.MenuItem>
    );

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuGroup label={t("Enhanced Screenshare")}>
            {appMenuItems}
        </Menu.MenuGroup>
    );
};

let _streamStartTimer: ReturnType<typeof setTimeout> | undefined;

function onStreamStart() {
    if (_streamStartTimer !== undefined) clearTimeout(_streamStartTimer);
    _streamStartTimer = setTimeout(() => {
        _streamStartTimer = undefined;
        if (streamAudioState.selectedAppPids.length > 0) {
            applyStreamAudio();
        }
    }, 600);
}

export default definePlugin({
    name: "EnhancedScreenshare",
    description: "Allows choosing which application audio to share on screenshare (specific app or entire system).",
    authors: [{ name: "Nightcord", id: 0n }],
    tags: ["Voice", "Media", "Utility"],
    enabledByDefault: false,

    contextMenus: {
        "stream-options": streamAudioContextMenuPatch,
        "stream-context": streamAudioContextMenuPatch,
        "manage-streams": streamAudioContextMenuPatch,
        "stream-settings": streamAudioContextMenuPatch
    },

    start() {
        FluxDispatcher.subscribe("MEDIA_ENGINE_SET_GO_LIVE_SOURCE", onStreamStart);
        FluxDispatcher.subscribe("STREAM_START", onStreamStart);
    },

    stop() {
        if (_streamStartTimer !== undefined) {
            clearTimeout(_streamStartTimer);
            _streamStartTimer = undefined;
        }
        FluxDispatcher.unsubscribe("MEDIA_ENGINE_SET_GO_LIVE_SOURCE", onStreamStart);
        FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
        streamAudioState.selectedAppPids = [];
        applyStreamAudio([]);
    }
});
