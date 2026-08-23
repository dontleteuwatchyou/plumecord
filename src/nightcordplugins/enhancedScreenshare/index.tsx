/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByCode, findByProps } from "@webpack";
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

let unhookPreview: (() => void) | null = null;

function hookPreviewUpload() {
    try {
        const uploadModule: any = findByCode("ApplicationStreamPreviewUploadManager") || findByProps("uploadStreamPreview") || findByProps("makeChunkedUploadRequest");
        if (uploadModule) {
            for (const key of Object.keys(uploadModule)) {
                if (typeof uploadModule[key] === "function") {
                    const orig = uploadModule[key];
                    uploadModule[key] = function(...args: any[]) {
                        try {
                            if (args[0] && typeof args[0] === "object" && "thumbnail" in args[0]) {
                                args[0].thumbnail = getCustomStreamThumbnail(
                                    args[0].thumbnail,
                                    previewSettingsState.replaceEnabled,
                                    previewSettingsState.slideshowEnabled,
                                    previewSettingsState.slideshowRandom
                                );
                            } else if (args[1] && typeof args[1] === "object" && "thumbnail" in args[1]) {
                                args[1].thumbnail = getCustomStreamThumbnail(
                                    args[1].thumbnail,
                                    previewSettingsState.replaceEnabled,
                                    previewSettingsState.slideshowEnabled,
                                    previewSettingsState.slideshowRandom
                                );
                            }
                        } catch (e) {
                            console.error("[EnhancedScreenshare] Preview hook error:", e);
                        }
                        return orig.apply(this, args);
                    };
                    unhookPreview = () => {
                        uploadModule[key] = orig;
                    };
                    break;
                }
            }
        }
    } catch (e) {
        console.error("[EnhancedScreenshare] Runtime preview hook setup failed:", e);
    }
}

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

    async start() {
        streamAudioState.isolateDiscordVoice = settings.store.isolateDiscordVoice;
        streamAudioState.selectedDeviceId = settings.store.defaultDevice;
        previewSettingsState.replaceEnabled = settings.store.replacePreview;
        previewSettingsState.slideshowEnabled = settings.store.slideshow;
        previewSettingsState.slideshowRandom = settings.store.slideshowRandom;

        await loadProfiles();
        hookPreviewUpload();

        FluxDispatcher.subscribe("MEDIA_ENGINE_SET_GO_LIVE_SOURCE", onStreamStart);
        FluxDispatcher.subscribe("STREAM_START", onStreamStart);
    },

    stop() {
        if (unhookPreview) {
            unhookPreview();
            unhookPreview = null;
        }

        FluxDispatcher.unsubscribe("MEDIA_ENGINE_SET_GO_LIVE_SOURCE", onStreamStart);
        FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
    }
});
