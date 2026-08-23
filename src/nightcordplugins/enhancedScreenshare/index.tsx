/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, MediaEngineStore } from "@webpack/common";

import { openPreviewGalleryModal, previewSettingsState } from "./components/PreviewGalleryModal";
import { applyStreamAudio, streamAudioContextMenuPatch, streamAudioState } from "./components/StreamMenu";
import { getCustomStreamThumbnail, loadProfiles } from "./previewStore";

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
    },
    replacePreview: {
        description: "Use custom stream preview image, animated GIF, or video",
        type: OptionType.BOOLEAN,
        default: true,
        onChange(v) {
            previewSettingsState.replaceEnabled = v;
        }
    },
    slideshow: {
        description: "Automatically cycle through preview images in slideshow mode",
        type: OptionType.BOOLEAN,
        default: false,
        onChange(v) {
            previewSettingsState.slideshowEnabled = v;
        }
    },
    slideshowRandom: {
        description: "Randomize order in slideshow mode",
        type: OptionType.BOOLEAN,
        default: false,
        onChange(v) {
            previewSettingsState.slideshowRandom = v;
        }
    }
});

function onStreamStart() {
    setTimeout(() => {
        applyStreamAudio();
    }, 500);
}

export default definePlugin({
    name: "EnhancedScreenshare",
    description: "Advanced screenshare audio routing (multi-app isolation & output device selector) and custom stream preview gallery (images, GIFs, and videos).",
    authors: [{ name: "Nightcord", id: 0n }],
    tags: ["Voice", "Media", "Utility"],
    settings,

    contextMenus: {
        "stream-options": streamAudioContextMenuPatch,
        "stream-context": streamAudioContextMenuPatch,
        "manage-streams": streamAudioContextMenuPatch,
        "stream-settings": streamAudioContextMenuPatch
    },

    toolboxActions: {
        "Custom Stream Preview": openPreviewGalleryModal
    },

    patches: [
        {
            find: "\"ApplicationStreamPreviewUploadManager\"",
            all: true,
            replacement: [
                {
                    match: /body:\{thumbnail:(\i)\}/,
                    replace: "body:{thumbnail:$self.getCustomThumbnail($1)}"
                },
                {
                    match: /\{thumbnail:(\i)\}/,
                    replace: "{thumbnail:$self.getCustomThumbnail($1)}"
                }
            ]
        }
    ],

    getCustomThumbnail(originalThumbnail: string) {
        return getCustomStreamThumbnail(
            originalThumbnail,
            previewSettingsState.replaceEnabled,
            previewSettingsState.slideshowEnabled,
            previewSettingsState.slideshowRandom
        );
    },

    async start() {
        streamAudioState.isolateDiscordVoice = settings.store.isolateDiscordVoice;
        streamAudioState.selectedDeviceId = settings.store.defaultDevice;
        previewSettingsState.replaceEnabled = settings.store.replacePreview;
        previewSettingsState.slideshowEnabled = settings.store.slideshow;
        previewSettingsState.slideshowRandom = settings.store.slideshowRandom;

        await loadProfiles();

        FluxDispatcher.subscribe("MEDIA_ENGINE_SET_GO_LIVE_SOURCE", onStreamStart);
        FluxDispatcher.subscribe("STREAM_START", onStreamStart);
    },

    stop() {
        FluxDispatcher.unsubscribe("MEDIA_ENGINE_SET_GO_LIVE_SOURCE", onStreamStart);
        FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
    }
});
