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
import { Button, ChannelStore, Menu, React, RelationshipStore, SelectedChannelStore, showToast, Text, Toasts, UserStore } from "@webpack/common";
import { t } from "../autoTranslateNightcord";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CloudWallpaperConfig {
    dmWallpapers?: Record<string, string>; // [friendUserId]: wallpaperUrl
    updatedAt?: number;
    private?: boolean;
}

// ── In-Memory State & Caches ───────────────────────────────────────────────────

let _cachedOpacity = 0.3;
let _cachedBlur = 0;
let _wpCache: Record<string, string> | null = null;
let _wpRaw = "";
let _activeVideo: HTMLVideoElement | null = null;
let _syncPollInterval: ReturnType<typeof setInterval> | null = null;
const LS_CLOUD_DM_WALLPAPERS = "NightcordCW_cloudDMs";

function loadOwnCloudDmWallpapers(): Record<string, string> {
    try {
        const raw = localStorage.getItem(LS_CLOUD_DM_WALLPAPERS);
        if (raw) return JSON.parse(raw);
    } catch {}
    return {};
}

function saveOwnCloudDmWallpapers(map: Record<string, string>) {
    try {
        localStorage.setItem(LS_CLOUD_DM_WALLPAPERS, JSON.stringify(map));
    } catch {}
}

let _cachedOwnCloudDmWallpapers: Record<string, string> = loadOwnCloudDmWallpapers();
const _syncedFromFriends = new Set<string>(); // channelIds synced from friend
const _syncLastFetched: Record<string, number> = {}; // channelId -> timestamp of last cloud sync
const SYNC_THROTTLE_MS = 10_000; // skip repeat sync calls within 10 s

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
        onChange(v: number) { _cachedOpacity = v; applyWallpaper(); }
    },
    blur: {
        type: OptionType.SLIDER,
        description: "Wallpaper blur (px)",
        markers: [0, 2, 5, 10, 15, 20],
        default: 0,
        stickToMarkers: false,
        restartNeeded: false,
        onChange(v: number) { _cachedBlur = v; applyWallpaper(); }
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
    if (url) {
        wp[channelId] = url;
    } else {
        delete wp[channelId];
    }
    settings.store.wallpapers = JSON.stringify(wp);
    _invalidateWpCache();

    if (SelectedChannelStore.getChannelId() === channelId) {
        applyWallpaper(channelId);
    }
}

// ── Nightcord API Cloud Synchronization ────────────────────────────────────────

async function syncWallpaperToCloud(recipientUserId: string, wallpaperUrl: string): Promise<boolean> {
    try {
        let token = await authorizeUser();
        if (!token) {
            showToast(t("Connect with Discord OAuth2 to sync with friends"), Toasts.Type.WARNING);
            return false;
        }

        if (wallpaperUrl) {
            _cachedOwnCloudDmWallpapers[recipientUserId] = wallpaperUrl;
        } else {
            delete _cachedOwnCloudDmWallpapers[recipientUserId];
        }
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

    // Throttle: skip cloud API call if this channel was synced recently (unless forced)
    const now = Date.now();
    if (!force && _syncLastFetched[channelId] && now - _syncLastFetched[channelId] < SYNC_THROTTLE_MS) return;
    _syncLastFetched[channelId] = now;

    try {
        const friendConfig: any = await getPublicPluginConfig("channelWallpaper", friendUserId);
        if (!friendConfig) return;

        // CRITICAL FIX: The backend wraps the payload inside .settings!
        // Check both friendConfig.settings.dmWallpapers and friendConfig.dmWallpapers for robustness
        const dmWallpapers = friendConfig.settings?.dmWallpapers || friendConfig.dmWallpapers;
        if (!dmWallpapers || typeof dmWallpapers !== "object") return;

        const friendSharedWp = dmWallpapers[myUserId] || "";
        const currentWp = getWallpaper(channelId);

        if (friendSharedWp && friendSharedWp !== currentWp) {
            saveLocalWallpaperOnly(channelId, friendSharedWp);
            _syncedFromFriends.add(channelId);
            showToast(t("Applied shared wallpaper from friend!"), Toasts.Type.SUCCESS);
        } else if (!friendSharedWp && currentWp && _syncedFromFriends.has(channelId)) {
            saveLocalWallpaperOnly(channelId, "");
            _syncedFromFriends.delete(channelId);
            showToast(t("Friend removed the shared wallpaper"), Toasts.Type.MESSAGE);
        }
    } catch (err) {
        console.error("[ChannelWallpaper] Failed to fetch friend wallpaper config:", err);
    }
}

async function saveWallpaper(channelId: string, url: string): Promise<"synced" | "local" | "failed"> {
    saveLocalWallpaperOnly(channelId, url);

    const channel = ChannelStore.getChannel(channelId);
    const isDM = Boolean(channel && (channel.type === 1 || (channel as any).isDM?.()));

    if (isDM && settings.store.syncWithFriends) {
        const friendUserId = (channel as any).getRecipientId?.() || channel?.recipients?.[0] || (channel as any)?.rawRecipients?.[0]?.id;
        const myUserId = UserStore.getCurrentUser()?.id;
        if (friendUserId && friendUserId !== myUserId) {
            // Check size limit: max 1.3 MB for cloud sync payload
            if (url && url.length > 1.3 * 1024 * 1024) {
                showToast(t("Video/file too large for cloud sync (max 1.2 MB). Applied locally only."), Toasts.Type.WARNING);
                return "local";
            }
            const synced = await syncWallpaperToCloud(friendUserId, url);
            return synced ? "synced" : "failed";
        }
    }
    return "local";
}

// ── Wallpaper Application & DOM Injection ─────────────────────────────────────

const STYLE_ID = "channel-wallpaper-style";
const CONTAINER_ID = "channel-wallpaper-container";

function removeWallpaperElements() {
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CONTAINER_ID)?.remove();
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

function applyWallpaper(channelId?: string) {
    removeWallpaperElements();

    const cid = channelId || SelectedChannelStore?.getChannelId?.();
    if (!cid) return;

    const url = getWallpaper(cid);
    if (!url) return;

    const opacity = _cachedOpacity;
    const blur = _cachedBlur;
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.startsWith("data:video/");

    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
[class*="messagesWrapper"],
[class*="chatContent"],
[class*="chat-messages"],
[class*="scroller"][class*="message"] {
    background: transparent !important;
}

#${CONTAINER_ID} {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
    opacity: ${opacity};
    ${blur > 0 ? `filter: blur(${blur}px);` : ""}
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

    const container = document.createElement("div");
    container.id = CONTAINER_ID;

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

    const tryInject = () => {
        const target =
            document.querySelector('[class*="messagesWrapper"]') ||
            document.querySelector('[class*="chat-messages"]') ||
            document.querySelector('[class*="chatContent"]') ||
            document.querySelector('[class*="content_"][class*="chat"]');

        if (target && target instanceof HTMLElement) {
            if (!target.closest('[class*="popout"]') && !target.closest('[class*="modal"]')) {
                if (!target.querySelector(`#${CONTAINER_ID}`)) {
                    (target as HTMLElement).style.position = "relative";
                    target.prepend(container);
                }
                return true;
            }
        }
        return false;
    };

    if (!tryInject()) {
        let tick = 0;
        const observer = new MutationObserver((_, obs) => {
            if (++tick % 3 !== 0) return;
            if (tryInject()) obs.disconnect();
        });
        const root = document.querySelector('[class*="chat"]') || document.body;
        observer.observe(root, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 3000);
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

async function removeWallpaper(channelId: string) {
    await saveWallpaper(channelId, "");
    showToast(t("Wallpaper deleted"), Toasts.Type.SUCCESS);
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
                                        onClick={() => {
                                            saveWallpaper(cid, "");
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
                setTimeout(() => {
                    applyWallpaper(channelId);
                    syncWithFriendForChannel(channelId);
                }, 100);
            } else {
                removeWallpaperElements();
            }
        }
    },

    start() {
        _cachedOpacity = settings.store.opacity ?? 0.3;
        _cachedBlur = settings.store.blur ?? 0;

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
            setTimeout(() => {
                applyWallpaper(cid);
                syncWithFriendForChannel(cid);
            }, 300);
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
