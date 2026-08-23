/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, MediaEngineStore } from "@webpack/common";

import { applyStreamAudio, streamAudioContextMenuPatch, streamAudioState } from "./components/StreamAudioMenu";

export const settings = definePluginSettings({
    isolateDiscordVoice: {
        description: "Automatically isolate Discord voice chat to prevent echo during screenshare",
        type: OptionType.BOOLEAN,
        default: true,
        onChange(v) {
            streamAudioState.isolateDiscordVoice = v;
        }
    },
    defaultDevice: {
        description: "Preferred stream audio output device (Default, or specific device ID)",
        type: OptionType.STRING,
        default: "default",
        onChange(v) {
            streamAudioState.selectedDeviceId = v;
        }
    }
});

function onStreamStart() {
    setTimeout(() => {
        applyStreamAudio();
    }, 500);
}

export default definePlugin({
    name: "StreamAudioSelector",
    description: "Allows selecting which application audio and output device is broadcast in screenshare, eliminating echo from Discord calls.",
    authors: [{ name: "Nightcord", id: 0n }],
    tags: ["Voice", "Media", "Utility"],
    settings,

    contextMenus: {
        "stream-options": streamAudioContextMenuPatch,
        "stream-context": streamAudioContextMenuPatch
    },

    patches: [
        {
            find: "setVideoBroadcast(this.shouldConnectionBroadcastVideo",
            replacement: {
                match: /setGoLiveSource\(.,.\)\{/,
                replace: "$&$self.onStreamStarted();"
            }
        }
    ],

    onStreamStarted() {
        onStreamStart();
    },

    start() {
        streamAudioState.isolateDiscordVoice = settings.store.isolateDiscordVoice;
        streamAudioState.selectedDeviceId = settings.store.defaultDevice;

        FluxDispatcher.subscribe("MEDIA_ENGINE_SET_GO_LIVE_SOURCE", onStreamStart);
        FluxDispatcher.subscribe("STREAM_START", onStreamStart);
    },

    stop() {
        FluxDispatcher.unsubscribe("MEDIA_ENGINE_SET_GO_LIVE_SOURCE", onStreamStart);
        FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
    }
});
