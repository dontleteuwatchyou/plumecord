/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Button, ChannelStore, GuildStore, openModal, React, SelectedChannelStore, TextInput, UserStore, showToast, Toasts } from "@webpack/common";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { SnipeGalleryModal } from "./modal";
import { SnipedAttachment, SnipePluginSettings } from "./types";
import { t } from "../autoTranslateNightcord";

const Native = VencordNative?.pluginHelpers?.SnipeAttachments as PluginNative<typeof import("./native")> | undefined;

const settings = definePluginSettings({
    savePath: {
        type: OptionType.STRING,
        description: "Custom folder path on your PC where sniped attachments will be stored.",
        default: "",
        restartNeeded: false
    },
    autoDownload: {
        type: OptionType.BOOLEAN,
        description: "Automatically download and cache incoming attachments in the background.",
        default: true,
        restartNeeded: false
    },
    maxFileSizeMB: {
        type: OptionType.SLIDER,
        description: "Maximum file size in megabytes (MB) to download automatically.",
        markers: [5, 10, 25, 50, 100, 250],
        default: 50,
        restartNeeded: false
    },
    saveImages: {
        type: OptionType.BOOLEAN,
        description: "Automatically download images (PNG, JPG, WebP, GIF, SVG).",
        default: true,
        restartNeeded: false
    },
    saveVideos: {
        type: OptionType.BOOLEAN,
        description: "Automatically download videos (MP4, WebM, MKV, MOV).",
        default: true,
        restartNeeded: false
    },
    saveAudio: {
        type: OptionType.BOOLEAN,
        description: "Automatically download audio files (MP3, OGG, WAV, FLAC, M4A).",
        default: true,
        restartNeeded: false
    },
    saveDocuments: {
        type: OptionType.BOOLEAN,
        description: "Automatically download documents and archives (PDF, ZIP, TXT, etc.).",
        default: true,
        restartNeeded: false
    },
    notifyOnDeleted: {
        type: OptionType.BOOLEAN,
        description: "Display a notification when an author deletes an attachment that was sniped.",
        default: true,
        restartNeeded: false
    }
});

const snipedStore: SnipedAttachment[] = [];
const processedAttachmentIds = new Set<string>();

async function loadSnipedStore() {
    try {
        const saved = await DataStore.get<SnipedAttachment[]>("SnipeAttachments_history");
        if (Array.isArray(saved)) {
            snipedStore.length = 0;
            snipedStore.push(...saved);
            saved.forEach(s => processedAttachmentIds.add(s.id));
        }
    } catch { }
}

async function saveSnipedStore() {
    try {
        await DataStore.set("SnipeAttachments_history", snipedStore);
    } catch { }
}

function shouldDownloadFile(filename: string, contentType: string | undefined): boolean {
    const isImage = /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(filename) || contentType?.startsWith("image/");
    const isVideo = /\.(mp4|webm|mkv|mov|avi)$/i.test(filename) || contentType?.startsWith("video/");
    const isAudio = /\.(mp3|ogg|wav|flac|m4a|opus)$/i.test(filename) || contentType?.startsWith("audio/");

    if (isImage) return settings.store.saveImages !== false;
    if (isVideo) return settings.store.saveVideos !== false;
    if (isAudio) return settings.store.saveAudio !== false;
    return settings.store.saveDocuments !== false;
}

async function processIncomingMessage(message: any) {
    if (!settings.store.autoDownload) return;
    if (!message || !message.attachments || message.attachments.length === 0) return;

    const channelId = message.channel_id;
    const channel = ChannelStore.getChannel(channelId);
    const channelName = channel?.name || "DirectMessage";
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const guildName = guild?.name || "DMs";

    const author = message.author;
    const authorName = author?.global_name || author?.globalName || author?.username || "UnknownUser";
    const authorId = author?.id || "0";

    const maxBytes = (settings.store.maxFileSizeMB || 50) * 1024 * 1024;
    const customDir = settings.store.savePath || "";

    for (const att of message.attachments) {
        if (!att.id || processedAttachmentIds.has(att.id)) continue;
        if (att.size && att.size > maxBytes) continue;
        if (!shouldDownloadFile(att.filename || "", att.content_type)) continue;

        processedAttachmentIds.add(att.id);

        try {
            const url = att.url || att.proxy_url;
            if (!url) continue;

            const res = await fetch(url);
            if (!res.ok) continue;

            const buffer = await res.arrayBuffer();

            let savedPath = "";
            if (Native?.saveAttachmentFile) {
                savedPath = await Native.saveAttachmentFile({
                    buffer,
                    filename: att.filename || "file",
                    guildName,
                    channelName,
                    authorName,
                    customDir
                });
            }

            const record: SnipedAttachment = {
                id: att.id,
                messageId: message.id,
                channelId,
                channelName,
                guildId: channel?.guild_id,
                guildName,
                authorId,
                authorName,
                filename: att.filename || "file",
                url,
                size: att.size || buffer.byteLength,
                contentType: att.content_type,
                savedPath,
                timestamp: Date.now()
            };

            snipedStore.unshift(record);
            if (snipedStore.length > 500) snipedStore.pop();
            saveSnipedStore();

        } catch (err) {
            console.debug("[SnipeAttachments] Failed to download attachment:", err);
        }
    }
}

function handleMessageDelete(deletedIds: string[]) {
    if (!deletedIds || deletedIds.length === 0) return;
    const deletedSet = new Set(deletedIds);

    let updated = false;
    for (const record of snipedStore) {
        if (deletedSet.has(record.messageId) && !record.isDeleted) {
            record.isDeleted = true;
            updated = true;

            if (settings.store.notifyOnDeleted !== false) {
                showToast(
                    `Attachment sniped from ${record.authorName}: ${record.filename}`,
                    Toasts.Type.INFO
                );
            }
        }
    }

    if (updated) {
        saveSnipedStore();
    }
}

function SnipeAttachmentsSettingsComponent() {
    const [pathValue, setPathValue] = React.useState(settings.store.savePath || "");
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        if (!settings.store.savePath && Native?.getDefaultSaveDirectory) {
            Native.getDefaultSaveDirectory().then(def => {
                if (def && !settings.store.savePath) {
                    settings.store.savePath = def;
                    setPathValue(def);
                }
            });
        }
    }, []);

    const handleSelectFolder = async () => {
        if (!Native?.selectSaveDirectory) return;
        const chosen = await Native.selectSaveDirectory();
        if (chosen) {
            settings.store.savePath = chosen;
            setPathValue(chosen);
            showToast("Save folder updated", Toasts.Type.SUCCESS);
        }
    };

    const handleOpenFolder = () => {
        const target = settings.store.savePath || pathValue;
        if (Native?.openFolder && target) {
            Native.openFolder(target);
        }
    };

    const handleOpenGallery = () => {
        openModal(props => (
            <SnipeGalleryModal
                snipedList={[...snipedStore]}
                savePath={settings.store.savePath || pathValue}
                onDeleteEntry={(id) => {
                    const idx = snipedStore.findIndex(s => s.id === id);
                    if (idx !== -1) {
                        const item = snipedStore[idx];
                        if (item.savedPath && Native?.deleteSavedFile) {
                            Native.deleteSavedFile(item.savedPath);
                        }
                        snipedStore.splice(idx, 1);
                        saveSnipedStore();
                        forceUpdate();
                    }
                }}
                onClearAll={() => {
                    snipedStore.length = 0;
                    saveSnipedStore();
                    forceUpdate();
                }}
                onClose={props.onClose}
                transitionState={props.transitionState}
            />
        ));
    };

    const totalCount = snipedStore.length;
    const deletedCount = snipedStore.filter(s => s.isDeleted).length;

    return (
        <div style={{ width: "100%", marginTop: "10px" }}>
            {/* Gallery Launcher & Stats Card */}
            <Card variant="primary" outline style={{ padding: "16px", background: "var(--background-secondary, #2b2d31)", borderRadius: "8px", marginBottom: "16px" }}>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <div>
                        <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "14px", display: "block" }}>
                            {t("Snipe Attachments Storage")}
                        </span>
                        <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px" }}>
                            {totalCount} {t("cached files")}
                            {deletedCount > 0 && ` • ${deletedCount} ${t("preserved after author deleted message")}`}
                        </span>
                    </div>
                    <Button
                        variant="primary"
                        onClick={handleOpenGallery}
                    >
                        {t("Open Sniped Attachments Gallery")}
                    </Button>
                </Flex>
            </Card>

            {/* Custom Save Folder Picker */}
            <div style={{ marginBottom: "16px" }}>
                <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>
                    {t("Save Folder Directory")}
                </span>
                <Flex alignItems={FlexAlign.CENTER} gap="8px" style={{ width: "100%" }}>
                    <TextInput
                        value={pathValue}
                        onChange={(val: string) => {
                            setPathValue(val);
                            settings.store.savePath = val.trim();
                        }}
                        placeholder="C:\Users\...\Nightcord_SnipeAttachments"
                        style={{ flex: 1 }}
                    />
                    <Button
                        variant="secondary"
                        onClick={handleSelectFolder}
                    >
                        {t("Browse Folder")}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleOpenFolder}
                    >
                        {t("Open Folder")}
                    </Button>
                </Flex>
            </div>
        </div>
    );
}

export default definePlugin({
    name: "SnipeAttachments",
    description: "Automatically downloads and caches incoming photos, videos, and files in the background so you can view them even if deleted.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: SnipeAttachmentsSettingsComponent,

    flux: {
        MESSAGE_CREATE({ message }: any) {
            processIncomingMessage(message);
        },
        MESSAGE_UPDATE({ message }: any) {
            processIncomingMessage(message);
        },
        MESSAGE_DELETE({ id }: any) {
            if (id) handleMessageDelete([id]);
        },
        MESSAGE_DELETE_BULK({ ids }: any) {
            if (Array.isArray(ids)) handleMessageDelete(ids);
        }
    },

    start() {
        loadSnipedStore();
    },

    stop() {
        // Clean memory
        processedAttachmentIds.clear();
    }
});
