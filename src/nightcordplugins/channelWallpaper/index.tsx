/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { authorizeUser, getStoredToken } from "@api/OAuth2";
import { getOwnPluginConfig, getPublicPluginConfig, saveOwnPluginConfig } from "@api/PluginSync";
import { definePluginSettings } from "@api/Settings";
import { Card } from "@components/Card";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, ChannelStore, Menu, React, SelectedChannelStore, showToast, Text, Toasts, UserStore } from "@webpack/common";
import { t } from "../autoTranslateNightcord";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CloudWallpaperEntry {
    url: string;
    updatedAt: number;
    authorId?: string;
}

interface CloudWallpaperConfig {
    dmWallpapers?: Record<string, CloudWallpaperEntry | string>; // [friendUserId]: entry or url
    updatedAt?: number;
    private?: boolean;
}

interface DeletionRecord {
    url: string;
    deletedAt: number;
}

// ── In-Memory State & Persistent Storage Keys ──────────────────────────────────

let _cachedOpacity = 0.3;
let _cachedBlur = 0;
let _wpCache: Record<string, string> | null = null;
let _wpRaw = "";
let _activeVideo: HTMLVideoElement | null = null;
let _syncPollInterval: ReturnType<typeof setInterval> | null = null;
let _chatObserver: MutationObserver | null = null;
let _activeChannelId: string | null = null;
let _activeWallpaperUrl: string | null = null;

const LS_CLOUD_DM_WALLPAPERS = "NightcordCW_cloudDMs";
const LS_LOCAL_WALLPAPERS = "NightcordCW_localWallpapers";
const LS_USER_SET_CHANNELS = "NightcordCW_userSet";
const LS_SYNCED_CHANNELS = "NightcordCW_syncedFriends";
const LS_DELETED_CHANNELS = "NightcordCW_deletedChannels";

function loadSet(key: string): Set<string> {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set();
}

function saveSet(key: string, set: Set<string>) {
    try {
        localStorage.setItem(key, JSON.stringify([...set]));
    } catch {}
}

function loadMap<T>(key: string): Record<string, T> {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
    } catch {}
    return {};
}

function saveMap<T>(key: string, map: Record<string, T>) {
    try {
        localStorage.setItem(key, JSON.stringify(map));
    } catch {}
}

function loadOwnCloudDmWallpapers(): Record<string, any> {
    try {
        const raw = localStorage.getItem(LS_CLOUD_DM_WALLPAPERS);
        if (raw) return JSON.parse(raw);
    } catch {}
    return {};
}

function saveOwnCloudDmWallpapers(map: Record<string, any>) {
    try {
        localStorage.setItem(LS_CLOUD_DM_WALLPAPERS, JSON.stringify(map));
    } catch {}
}

let _cachedOwnCloudDmWallpapers: Record<string, any> = loadOwnCloudDmWallpapers();
let _userSetChannels = loadSet(LS_USER_SET_CHANNELS);
let _syncedFromFriends = loadSet(LS_SYNCED_CHANNELS);
let _deletedChannels = loadMap<DeletionRecord>(LS_DELETED_CHANNELS);
const _syncLastFetched: Record<string, number> = {};
const SYNC_THROTTLE_MS = 10_000;

// ── Settings ───────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    wallpapers: {
        type: OptionType.STRING,
        description: "Wallpapers JSON (managed automatically by plugin)",
        default: "{}",
        hidden: true,
        restartNeeded: false,
        onChange() { _invalidateWpCache(); }
    },
    opacity: {
        type: OptionType.SLIDER,
        description: "Wallpaper opacity",
        markers: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        default: 0.3,
        stickToMarkers: false,
        restartNeeded: false,
        onChange(v: number) {
            _cachedOpacity = v;
            const container = document.getElementById(CONTAINER_ID);
            if (container) container.style.opacity = String(v);
        }
    },
    blur: {
        type: OptionType.SLIDER,
        description: "Wallpaper blur (px)",
        markers: [0, 2, 5, 10, 15, 20],
        default: 0,
        stickToMarkers: false,
        restartNeeded: false,
        onChange(v: number) {
            _cachedBlur = v;
            const container = document.getElementById(CONTAINER_ID);
            if (container) container.style.filter = v > 0 ? `blur(${v}px)` : "";
        }
    },
    defaultWallpaper: {
        type: OptionType.STRING,
        description: "Default wallpaper URL (for channels without a custom one)",
        default: "",
        restartNeeded: false,
        onChange() { applyWallpaper(); }
    },
    syncWithFriends: {
        type: OptionType.BOOLEAN,
        description: "Sync DM wallpapers with Nightcord friends via OAuth2 API",
        default: true,
        restartNeeded: false,
    },
});

function getWallpapers(): Record<string, string> {
    const raw = settings.store.wallpapers || "{}";
    if (raw === _wpRaw && _wpCache !== null) return _wpCache;
    try { _wpCache = JSON.parse(raw); } catch { _wpCache = {}; }

    // Dual-layer fallback with localStorage
    const backup = loadMap<string>(LS_LOCAL_WALLPAPERS);
    let dirty = false;
    for (const [k, v] of Object.entries(backup)) {
        if (v && !_wpCache[k]) {
            _wpCache[k] = v;
            dirty = true;
        }
    }
    if (dirty) {
        settings.store.wallpapers = JSON.stringify(_wpCache);
    }

    _wpRaw = raw;
    return _wpCache!;
}

function _invalidateWpCache() {
    _wpCache = null;
    _wpRaw = "";
}

function getWallpaper(channelId: string): string {
    const wp = getWallpapers();
    return wp[channelId] || settings.store.defaultWallpaper || "";
}

function hasWallpaper(channelId: string): boolean {
    const wp = getWallpapers();
    return !!wp[channelId];
}

function saveLocalWallpaperOnly(channelId: string, url: string) {
    const wp = getWallpapers();
    const backup = loadMap<string>(LS_LOCAL_WALLPAPERS);

    if (url) {
        wp[channelId] = url;
        backup[channelId] = url;
    } else {
        delete wp[channelId];
        delete backup[channelId];
    }

    settings.store.wallpapers = JSON.stringify(wp);
    saveMap(LS_LOCAL_WALLPAPERS, backup);
    _invalidateWpCache();

    if (SelectedChannelStore.getChannelId() === channelId) {
        if (url) {
            applyWallpaper(channelId);
        } else {
            removeWallpaperElements();
        }
    }
}

// ── Nightcord API Cloud Synchronization ────────────────────────────────────────

async function syncWallpaperToCloud(recipientUserId: string, wallpaperUrl: string): Promise<boolean> {
    try {
        const token = await authorizeUser();
        if (!token) {
            showToast(t("Connect with Discord OAuth2 to sync with friends"), Toasts.Type.WARNING);
            return false;
        }

        const myUserId = UserStore.getCurrentUser()?.id || "";
        _cachedOwnCloudDmWallpapers[recipientUserId] = {
            url: wallpaperUrl || "",
            updatedAt: Date.now(),
            authorId: myUserId
        };
        saveOwnCloudDmWallpapers(_cachedOwnCloudDmWallpapers);

        const cloudPayload: CloudWallpaperConfig = {
            dmWallpapers: _cachedOwnCloudDmWallpapers,
            updatedAt: Date.now(),
            private: false
        };

        await saveOwnPluginConfig("channelWallpaper", token, cloudPayload as unknown as Record<string, unknown>);
        return true;
    } catch (err) {
        console.error("[ChannelWallpaper] Cloud sync error:", err);
        return false;
    }
}

async function syncWithFriendForChannel(channelId: string, force = false) {
    if (!settings.store.syncWithFriends) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;
    const isDM = Boolean(channel.type === 1 || (channel as any).isDM?.());
    if (!isDM) return;

    const friendUserId = (channel as any).getRecipientId?.() || channel.recipients?.[0] || (channel as any).rawRecipients?.[0]?.id || (channel as any).rawRecipients?.[0];
    if (!friendUserId) return;

    const myUserId = UserStore.getCurrentUser()?.id;
    if (!myUserId || friendUserId === myUserId) return;

    const now = Date.now();
    if (!force && _syncLastFetched[channelId] && now - _syncLastFetched[channelId] < SYNC_THROTTLE_MS) return;
    _syncLastFetched[channelId] = now;

    try {
        const friendConfig: any = await getPublicPluginConfig("channelWallpaper", friendUserId);
        if (!friendConfig) return;

        const dmWallpapers = friendConfig.settings?.dmWallpapers || friendConfig.dmWallpapers;
        if (!dmWallpapers || typeof dmWallpapers !== "object") return;

        const rawEntry = dmWallpapers[myUserId];
        let friendSharedWp = "";
        let friendUpdatedAt = 0;

        if (typeof rawEntry === "string") {
            friendSharedWp = rawEntry;
        } else if (rawEntry && typeof rawEntry === "object") {
            friendSharedWp = rawEntry.url || "";
            friendUpdatedAt = rawEntry.updatedAt || 0;
        }

        const currentWp = getWallpaper(channelId);
        const deletion = _deletedChannels[channelId];
        const isUserOwned = _userSetChannels.has(channelId);

        // Case 1: Friend shared a non-empty wallpaper
        if (friendSharedWp) {
            // Guard: Did the current user explicitly delete this same wallpaper?
            if (deletion) {
                // If friend's URL matches what user deleted AND friend hasn't set a newer one:
                if (friendSharedWp === deletion.url || (friendUpdatedAt > 0 && friendUpdatedAt <= deletion.deletedAt)) {
                    return; // Stale wallpaper, do not resurrect!
                }
                // Friend has set a genuinely new wallpaper: clear deletion record
                delete _deletedChannels[channelId];
                saveMap(LS_DELETED_CHANNELS, _deletedChannels);
            }

            // Guard: If user explicitly set their own wallpaper, do not overwrite unless friend's is newer
            if (isUserOwned && currentWp && currentWp !== friendSharedWp) {
                if (friendUpdatedAt <= (_syncLastFetched[channelId] || 0)) {
                    return;
                }
            }

            if (friendSharedWp !== currentWp) {
                saveLocalWallpaperOnly(channelId, friendSharedWp);
                _syncedFromFriends.add(channelId);
                saveSet(LS_SYNCED_CHANNELS, _syncedFromFriends);
                _userSetChannels.delete(channelId);
                saveSet(LS_USER_SET_CHANNELS, _userSetChannels);
                showToast(t("Applied shared wallpaper from friend!"), Toasts.Type.SUCCESS);
            }
        }
        // Case 2: Friend shared an empty wallpaper / removed it
        else {
            // Only clear if the wallpaper was genuinely synced from friend and NOT set by user
            if (currentWp && _syncedFromFriends.has(channelId) && !isUserOwned) {
                saveLocalWallpaperOnly(channelId, "");
                _syncedFromFriends.delete(channelId);
                saveSet(LS_SYNCED_CHANNELS, _syncedFromFriends);
                removeWallpaperElements();
                showToast(t("Friend removed the shared wallpaper"), Toasts.Type.MESSAGE);
            }
        }
    } catch (err) {
        console.error("[ChannelWallpaper] Failed to fetch friend wallpaper config:", err);
    }
}

async function saveWallpaper(channelId: string, url: string): Promise<"synced" | "local" | "failed"> {
    if (!url) {
        await removeWallpaper(channelId);
        return "local";
    }

    // 1. Mark as user-owned
    _userSetChannels.add(channelId);
    saveSet(LS_USER_SET_CHANNELS, _userSetChannels);

    // 2. Clear friend sync and deletion flags
    _syncedFromFriends.delete(channelId);
    saveSet(LS_SYNCED_CHANNELS, _syncedFromFriends);
    delete _deletedChannels[channelId];
    saveMap(LS_DELETED_CHANNELS, _deletedChannels);

    // 3. Save locally
    saveLocalWallpaperOnly(channelId, url);

    // 4. Push to cloud if DM
    const channel = ChannelStore.getChannel(channelId);
    const isDM = Boolean(channel && (channel.type === 1 || (channel as any).isDM?.()));

    if (isDM && settings.store.syncWithFriends) {
        const friendUserId = (channel as any).getRecipientId?.() || channel?.recipients?.[0] || (channel as any)?.rawRecipients?.[0]?.id;
        const myUserId = UserStore.getCurrentUser()?.id;
        if (friendUserId && friendUserId !== myUserId) {
            if (url.length > 1.3 * 1024 * 1024) {
                showToast(t("Video/file too large for cloud sync (max 1.2 MB). Applied locally only."), Toasts.Type.WARNING);
                return "local";
            }
            const synced = await syncWallpaperToCloud(friendUserId, url);
            return synced ? "synced" : "failed";
        }
    }
    return "local";
}

async function removeWallpaper(channelId: string) {
    const currentWp = getWallpaper(channelId);

    // 1. Record deletion timestamp and URL to prevent ghost resurrection from friend's cloud
    _deletedChannels[channelId] = {
        url: currentWp,
        deletedAt: Date.now()
    };
    saveMap(LS_DELETED_CHANNELS, _deletedChannels);

    // 2. Clear state flags
    _userSetChannels.delete(channelId);
    saveSet(LS_USER_SET_CHANNELS, _userSetChannels);
    _syncedFromFriends.delete(channelId);
    saveSet(LS_SYNCED_CHANNELS, _syncedFromFriends);

    // 3. Remove locally & from DOM
    saveLocalWallpaperOnly(channelId, "");
    removeWallpaperElements();

    // 4. Update cloud config if DM
    const channel = ChannelStore.getChannel(channelId);
    const isDM = Boolean(channel && (channel.type === 1 || (channel as any).isDM?.()));
    if (isDM && settings.store.syncWithFriends) {
        const friendUserId = (channel as any).getRecipientId?.() || channel?.recipients?.[0] || (channel as any)?.rawRecipients?.[0]?.id;
        const myUserId = UserStore.getCurrentUser()?.id;
        if (friendUserId && friendUserId !== myUserId) {
            await syncWallpaperToCloud(friendUserId, "");
        }
    }

    showToast(t("Wallpaper deleted"), Toasts.Type.SUCCESS);
}

// ── Wallpaper Application & DOM Injection ─────────────────────────────────────

const STYLE_ID = "channel-wallpaper-style";
const CONTAINER_ID = "channel-wallpaper-container";

function removeWallpaperElements() {
    _activeChannelId = null;
    _activeWallpaperUrl = null;
    if (_chatObserver) {
        _chatObserver.disconnect();
        _chatObserver = null;
    }
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CONTAINER_ID)?.remove();
    if (_activeVideo) {
        _activeVideo.pause();
        _activeVideo = null;
    }
}

function pauseVideo() {
    if (_activeVideo && !_activeVideo.paused) {
        _activeVideo.pause();
    }
}

function playVideo() {
    if (_activeVideo && _activeVideo.paused && !document.hidden && document.hasFocus()) {
        _activeVideo.play().catch(() => {});
    }
}

function handleVisChange() {
    if (document.hidden) pauseVideo();
    else playVideo();
}

function handleFocusChange() {
    if (document.hasFocus()) playVideo();
    else pauseVideo();
}

function injectWallpaperContainer(channelId: string, url: string): boolean {
    const currentCid = SelectedChannelStore?.getChannelId?.();
    if (currentCid !== channelId) return false;

    // Ensure CSS overrides exist
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
[class*="messagesWrapper"],
[class*="chatContent"],
[class*="chat-messages"],
[class*="chat_"],
[class*="scroller"][class*="message"],
[class*="scrollerInner"] {
    background: transparent !important;
}

#${CONTAINER_ID} {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
    opacity: ${_cachedOpacity};
    ${_cachedBlur > 0 ? `filter: blur(${_cachedBlur}px);` : ""}
}

#${CONTAINER_ID} img,
#${CONTAINER_ID} video {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

[class*="messagesWrapper"],
[class*="chatContent"] {
    position: relative !important;
}
`.trim();
        document.head.appendChild(style);
    }

    // Check if container already exists with the same URL and is connected to DOM
    const existing = document.getElementById(CONTAINER_ID);
    if (existing && existing.isConnected && existing.dataset.url === url) {
        existing.style.opacity = String(_cachedOpacity);
        existing.style.filter = _cachedBlur > 0 ? `blur(${_cachedBlur}px)` : "";
        return true;
    }

    // Otherwise recreate
    existing?.remove();

    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.startsWith("data:video/");
    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.dataset.url = url;
    container.dataset.channelId = channelId;

    if (isVideo) {
        const video = document.createElement("video");
        video.src = url;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        _activeVideo = video;
        container.appendChild(video);
    } else {
        _activeVideo = null;
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.draggable = false;
        container.appendChild(img);
    }

    const target =
        document.querySelector('[class*="messagesWrapper"]') ||
        document.querySelector('[class*="chat-messages"]') ||
        document.querySelector('[class*="chatContent"]') ||
        document.querySelector('[class*="content_"][class*="chat"]');

    if (target && target instanceof HTMLElement) {
        if (!target.closest('[class*="popout"]') && !target.closest('[class*="modal"]')) {
            target.style.position = "relative";
            target.prepend(container);
            return true;
        }
    }
    return false;
}

function applyWallpaper(channelId?: string) {
    const cid = channelId || SelectedChannelStore?.getChannelId?.();
    if (!cid) {
        removeWallpaperElements();
        return;
    }

    const url = getWallpaper(cid);
    if (!url) {
        removeWallpaperElements();
        return;
    }

    _activeChannelId = cid;
    _activeWallpaperUrl = url;

    injectWallpaperContainer(cid, url);

    // Ensure continuous observer so container stays mounted if Discord re-renders or switches views
    if (!_chatObserver) {
        let lastCheck = 0;
        _chatObserver = new MutationObserver(() => {
            const now = Date.now();
            if (now - lastCheck < 150) return;
            lastCheck = now;

            const cur = SelectedChannelStore?.getChannelId?.();
            if (cur !== _activeChannelId || !_activeWallpaperUrl) return;

            const el = document.getElementById(CONTAINER_ID);
            if (!el || !el.isConnected) {
                injectWallpaperContainer(cur, _activeWallpaperUrl);
            }
        });

        const chatRoot = document.querySelector('[class*="chat"]') || document.body;
        _chatObserver.observe(chatRoot, { childList: true, subtree: true });
    }
}

// ── File & URL Input Helpers ──────────────────────────────────────────────────

function pickFileRaw(): Promise<string | null> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*,video/mp4,video/webm,.gif";
        input.style.display = "none";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                input.remove();
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                resolve(reader.result as string);
                input.remove();
            };
            reader.onerror = () => {
                resolve(null);
                input.remove();
            };
            reader.readAsDataURL(file);
        };
        input.oncancel = () => { resolve(null); input.remove(); };
        document.body.appendChild(input);
        input.click();
    });
}

function promptUrl(): Promise<string | null> {
    return new Promise(resolve => {
        const url = prompt(t("Enter wallpaper image or video URL:"));
        resolve(url?.trim() || null);
    });
}

async function compressImageIfNeeded(dataUrl: string, maxDim = 1920, quality = 0.85): Promise<string> {
    if (!dataUrl.startsWith("data:image/")) return dataUrl;
    if (dataUrl.startsWith("data:image/gif") || dataUrl.startsWith("data:image/svg")) {
        return dataUrl;
    }

    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) { resolve(dataUrl); return; }

                ctx.drawImage(img, 0, 0, width, height);
                const compressed = canvas.toDataURL("image/jpeg", quality);
                resolve(compressed.length < dataUrl.length ? compressed : dataUrl);
            } catch {
                resolve(dataUrl);
            }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

function SyncIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
    );
}

async function setWallpaperFromFile(channelId: string) {
    const rawData = await pickFileRaw();
    if (!rawData) return;

    const dataUrl = await compressImageIfNeeded(rawData);
    const status = await saveWallpaper(channelId, dataUrl);
    if (status === "synced") {
        showToast(t("Wallpaper applied and synced via Nightcord API!"), Toasts.Type.SUCCESS);
    } else if (status === "failed") {
        showToast(t("Wallpaper applied locally (cloud sync failed)"), Toasts.Type.WARNING);
    } else {
        showToast(t("Channel wallpaper applied!"), Toasts.Type.SUCCESS);
    }
}

async function setWallpaperFromUrl(channelId: string) {
    const url = await promptUrl();
    if (!url) return;

    const status = await saveWallpaper(channelId, url);
    if (status === "synced") {
        showToast(t("Wallpaper applied and synced via Nightcord API!"), Toasts.Type.SUCCESS);
    } else if (status === "failed") {
        showToast(t("Wallpaper applied locally (cloud sync failed)"), Toasts.Type.WARNING);
    } else {
        showToast(t("Channel wallpaper applied!"), Toasts.Type.SUCCESS);
    }
}

// ── Context Menu Components ───────────────────────────────────────────────────

function WallpaperIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v8.5l4-3 3 2.5 4-4 5 4V6H4zm0 12h16v-1.2l-5-4-3.8 3.8L8 14.5l-4 3V18zm5-8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
        </svg>
    );
}

function FolderIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
        </svg>
    );
}

function LinkIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
        </svg>
    );
}

function buildWallpaperMenu(channelId: string): React.ReactElement {
    const has = hasWallpaper(channelId);
    const channel = ChannelStore.getChannel(channelId);
    const isDM = Boolean(channel && (channel.type === 1 || (channel as any).isDM?.()));

    return (
        <Menu.MenuItem
            id="channel-wallpaper"
            label={t("Wallpaper")}
            icon={WallpaperIcon}
            leadingAccessory={WallpaperIcon}
        >
            <Menu.MenuItem
                id="wallpaper-from-file"
                label={t("From a file...")}
                icon={FolderIcon}
                leadingAccessory={FolderIcon}
                action={() => setWallpaperFromFile(channelId)}
            />
            <Menu.MenuItem
                id="wallpaper-from-url"
                label={t("From a URL...")}
                icon={LinkIcon}
                leadingAccessory={LinkIcon}
                action={() => setWallpaperFromUrl(channelId)}
            />
            {isDM && (
                <Menu.MenuItem
                    id="wallpaper-force-sync"
                    label={t("Sync with friend now")}
                    icon={SyncIcon}
                    leadingAccessory={SyncIcon}
                    action={async () => {
                        delete _syncLastFetched[channelId];
                        const current = getWallpaper(channelId);
                        const friendId = (channel as any).getRecipientId?.() || channel?.recipients?.[0];
                        if (current && friendId) {
                            const res = await syncWallpaperToCloud(friendId, current);
                            if (res) showToast(t("Wallpaper applied and synced via Nightcord API!"), Toasts.Type.SUCCESS);
                            else showToast(t("Wallpaper applied locally (cloud sync failed)"), Toasts.Type.WARNING);
                        } else {
                            await syncWithFriendForChannel(channelId, true);
                        }
                    }}
                />
            )}
            {has && (
                <>
                    <Menu.MenuSeparator />
                    <Menu.MenuItem
                        id="wallpaper-remove"
                        label={isDM ? t("Delete for both") : t("Delete wallpaper")}
                        color="danger"
                        icon={TrashIcon}
                        leadingAccessory={TrashIcon}
                        action={() => removeWallpaper(channelId)}
                    />
                </>
            )}
        </Menu.MenuItem>
    );
}

const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: any) => {
    if (!user?.id) return;
    const channelId = (ChannelStore as any).getDMFromUserId?.(user.id);
    if (!channelId) return;

    children.push(buildWallpaperMenu(channelId));
};

const channelContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: any) => {
    if (!channel?.id) return;
    children.push(buildWallpaperMenu(channel.id));
};

// ── Settings Panel Component ───────────────────────────────────────────────────

function ChannelWallpaperSettingsComponent() {
    const [token, setToken] = React.useState<string | null>(null);
    const [loadingAuth, setLoadingAuth] = React.useState(false);
    const [refreshTick, setRefreshTick] = React.useState(0);
    const wpMap = getWallpapers();
    const wpEntries = Object.entries(wpMap);

    React.useEffect(() => {
        getStoredToken().then(t => setToken(t));
    }, []);

    const handleConnect = async () => {
        setLoadingAuth(true);
        try {
            const res = await authorizeUser();
            setToken(res);
            if (res) {
                showToast(t("Connected to Nightcord Cloud"), Toasts.Type.SUCCESS);
            }
        } finally {
            setLoadingAuth(false);
        }
    };

    return (
        <Flex direction={FlexDirection.COLUMN} style={{ gap: 16 }}>
            {/* OAuth2 Cloud Sync Status */}
            <Card style={{ padding: "16px 20px", background: "var(--background-secondary)" }}>
                <Flex align={FlexAlign.CENTER} justify={FlexJustify.BETWEEN}>
                    <Flex direction={FlexDirection.COLUMN} style={{ gap: 4 }}>
                        <Text variant="text-md/semibold" style={{ color: "var(--header-primary)" }}>
                            {t("Sync DM Wallpapers with Friends")}
                        </Text>
                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                            {t("Automatically sync wallpapers in DMs with your Nightcord friends via OAuth2 API.")}
                        </Text>
                    </Flex>
                    {token ? (
                        <Text variant="text-sm/medium" style={{ color: "var(--text-positive)" }}>
                            {t("Connected to Nightcord Cloud")}
                        </Text>
                    ) : (
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.BRAND}
                            disabled={loadingAuth}
                            onClick={handleConnect}
                        >
                            {loadingAuth ? t("Connecting...") : t("Connect with Discord OAuth2")}
                        </Button>
                    )}
                </Flex>
            </Card>

            {/* List of Active Wallpapers */}
            <Card style={{ padding: "16px 20px", background: "var(--background-secondary)" }}>
                <Text variant="text-md/semibold" style={{ color: "var(--header-primary)", marginBottom: 12 }}>
                    {t("Active Wallpapers")}
                </Text>
                {wpEntries.length === 0 ? (
                    <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                        {t("No custom wallpapers set yet.")}
                    </Text>
                ) : (
                    <Flex direction={FlexDirection.COLUMN} style={{ gap: 8 }}>
                        {wpEntries.map(([cid, url]) => {
                            const ch = ChannelStore.getChannel(cid);
                            const label = ch?.name || (ch?.type === 1 ? `DM: ${ch?.recipients?.[0] || cid}` : cid);

                            return (
                                <Flex
                                    key={cid}
                                    align={FlexAlign.CENTER}
                                    justify={FlexJustify.BETWEEN}
                                    style={{
                                        padding: "8px 12px",
                                        background: "var(--background-tertiary)",
                                        borderRadius: 8
                                    }}
                                >
                                    <Flex align={FlexAlign.CENTER} style={{ gap: 12, flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                width: 36,
                                                height: 36,
                                                borderRadius: 6,
                                                backgroundImage: `url(${url})`,
                                                backgroundSize: "cover",
                                                backgroundPosition: "center",
                                                backgroundColor: "var(--background-secondary)"
                                            }}
                                        />
                                        <Text
                                            variant="text-sm/medium"
                                            style={{ color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                        >
                                            {label}
                                        </Text>
                                    </Flex>
                                    <Button
                                        size={Button.Sizes.MIN}
                                        color={Button.Colors.RED}
                                        look={Button.Looks.OUTLINED}
                                        onClick={async () => {
                                            await removeWallpaper(cid);
                                            setRefreshTick(t => t + 1);
                                        }}
                                    >
                                        {t("Clear")}
                                    </Button>
                                </Flex>
                            );
                        })}
                    </Flex>
                )}
            </Card>
        </Flex>
    );
}

// ── Plugin Definition ──────────────────────────────────────────────────────────

export default definePlugin({
    name: "ChannelWallpaper",
    enabledByDefault: false,
    authors: [Devs.rushii, Devs.Nickyux],
    description: "Allows for custom backgrounds for every individual channel and syncs DM wallpapers with friends via Nightcord API.",
    settings,
    settingsAboutComponent: ChannelWallpaperSettingsComponent,

    contextMenus: {
        "user-context": userContextMenuPatch,
        "channel-context": channelContextMenuPatch,
        "gdm-context": channelContextMenuPatch,
    },

    flux: {
        CHANNEL_SELECT({ channelId }: { channelId: string; }) {
            if (channelId) {
                applyWallpaper(channelId);
                setTimeout(() => applyWallpaper(channelId), 150);
                setTimeout(() => applyWallpaper(channelId), 400);
                syncWithFriendForChannel(channelId);
            } else {
                removeWallpaperElements();
            }
        }
    },

    start() {
        _cachedOpacity = settings.store.opacity ?? 0.3;
        _cachedBlur = settings.store.blur ?? 0;

        _wpCache = null;
        _wpRaw = "";
        _userSetChannels = loadSet(LS_USER_SET_CHANNELS);
        _syncedFromFriends = loadSet(LS_SYNCED_CHANNELS);
        _deletedChannels = loadMap<DeletionRecord>(LS_DELETED_CHANNELS);
        _cachedOwnCloudDmWallpapers = loadOwnCloudDmWallpapers();

        // Try loading own remote cloud config to merge with local cached DMs
        getStoredToken().then(async token => {
            if (!token) return;
            try {
                const ownConfig: any = await getOwnPluginConfig("channelWallpaper", token);
                const dmWallpapers = ownConfig?.settings?.dmWallpapers || ownConfig?.dmWallpapers;
                if (dmWallpapers && typeof dmWallpapers === "object") {
                    _cachedOwnCloudDmWallpapers = { ...dmWallpapers, ..._cachedOwnCloudDmWallpapers };
                    saveOwnCloudDmWallpapers(_cachedOwnCloudDmWallpapers);
                }
            } catch {}
        });

        const cid = SelectedChannelStore.getChannelId();
        if (cid) {
            applyWallpaper(cid);
            setTimeout(() => applyWallpaper(cid), 200);
            setTimeout(() => applyWallpaper(cid), 500);
            syncWithFriendForChannel(cid);
        }

        // Periodic background sync for active DM channel (every 10s)
        _syncPollInterval = setInterval(() => {
            const currentChannelId = SelectedChannelStore.getChannelId();
            if (currentChannelId) {
                syncWithFriendForChannel(currentChannelId);
            }
        }, 10000);

        document.addEventListener("visibilitychange", handleVisChange);
        window.addEventListener("focus", handleFocusChange);
        window.addEventListener("blur", handleFocusChange);
    },

    stop() {
        removeWallpaperElements();
        if (_syncPollInterval) {
            clearInterval(_syncPollInterval);
            _syncPollInterval = null;
        }
        document.removeEventListener("visibilitychange", handleVisChange);
        window.removeEventListener("focus", handleFocusChange);
        window.removeEventListener("blur", handleFocusChange);
        _activeVideo = null;
    }
});
