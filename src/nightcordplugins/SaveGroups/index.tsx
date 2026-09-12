/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { DataStore } from "@api/index";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { NavContextMenuPatchCallback } from "@utils/types";
import { findByCodeLazy, findByProps, findStore, waitFor } from "@webpack";
import {
    Alerts,
    ChannelStore,
    FluxDispatcher,
    Menu,
    MessageStore,
    React,
    SelectedChannelStore,
    showToast,
    Toasts
} from "@webpack/common";
import { NavigationRouter } from "@webpack/common/utils";
import { t } from "../autoTranslateNightcord";

const DATA_STORE_KEY = "Nightcord_SaveGroups_Entries";

const createChannelRecordFromServer = findByCodeLazy(".GUILD_TEXT]", "fromServer)");
const createMessageRecord = findByCodeLazy(".createFromServer(", ".isBlockedForMessage", "messageReference:");

export interface SavedGroupData {
    id: string;
    name: string;
    icon?: string | null;
    ownerId?: string;
    topic?: string;
    type: number; // 3 = GROUP_DM
    recipients?: any[];
    rawRecipients?: any[];
    lastMessageId?: string | null;
    kickedAt: number;
    savedMessages?: any[];
}

const settings = definePluginSettings({
    saveMessages: {
        type: OptionType.BOOLEAN,
        description: "Save loaded message history when a group is archived.",
        default: true
    },
    notifyOnSave: {
        type: OptionType.BOOLEAN,
        description: "Show a desktop notification when you are removed from a group and it gets saved.",
        default: true
    },
    dimOpacity: {
        type: OptionType.SLIDER,
        description: "Opacity of kicked groups in the Direct Messages sidebar.",
        default: 50,
        markers: [20, 35, 50, 65, 80],
        onChange: () => updateStyles()
    }
});

const savedGroups = new Map<string, SavedGroupData>();
const hydratedChannels = new Map<string, any>();
const activeGroupsCache = new Map<string, any>();
const manuallyDeletedGroupIds = new Set<string>();

let unpatchChannelStore: (() => void) | null = null;
let unpatchChannelStoreGetPrivate: (() => void) | null = null;
let unpatchChannelStoreGetMutablePrivate: (() => void) | null = null;
let unpatchPrivateChannelSortStore: (() => void) | null = null;
let unpatchFetchMessages: (() => void) | null = null;
let unpatchSendMessage: (() => void) | null = null;

let sidebarObserver: MutationObserver | null = null;
let _domUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let _bannerTimers: ReturnType<typeof setTimeout>[] = [];

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function hydrateChannelRecord(data: SavedGroupData): any {
    try {
        if (typeof createChannelRecordFromServer === "function") {
            const ch = createChannelRecordFromServer({
                id: data.id,
                type: 3,
                name: data.name || "Group DM",
                icon: data.icon || null,
                ownerId: data.ownerId,
                topic: data.topic || "",
                recipients: data.recipients || [],
                rawRecipients: data.rawRecipients || data.recipients || [],
                last_message_id: data.lastMessageId || null,
                is_spam: false,
                is_message_request: false,
            });
            if (ch) {
                ch.isArchivedGroup = true;
                return ch;
            }
        }
    } catch {}

    return {
        id: data.id,
        type: 3,
        name: data.name || "Group DM",
        icon: data.icon || null,
        ownerId: data.ownerId,
        topic: data.topic || "",
        recipients: data.recipients || [],
        rawRecipients: data.rawRecipients || data.recipients || [],
        lastMessageId: data.lastMessageId || null,
        isArchivedGroup: true,
        isDM: () => false,
        isGroupDM: () => true,
        isMultiUserDM: () => true,
        isPrivate: () => true,
        isSystemDM: () => false,
        getRecipientId: () => data.recipients?.[0]?.id || data.recipients?.[0] || "",
        getApplicationId: () => null,
        isManaged: () => false,
        isThread: () => false,
        isGuildVocal: () => false,
        isGuildStageVoice: () => false,
        isCategory: () => false,
        isAudioChannel: () => false,
        isVideoChannel: () => false,
        isVocal: () => false,
    };
}

function cacheActiveGroup(channel: any) {
    if (!channel || channel.type !== 3) return;
    activeGroupsCache.set(channel.id, channel);
}

function refreshActiveGroupsCache() {
    try {
        const privateChannels = (ChannelStore as any)?.getMutablePrivateChannels?.() || (ChannelStore as any)?.getPrivateChannels?.() || {};
        for (const id of Object.keys(privateChannels)) {
            const ch = privateChannels[id];
            if (ch && ch.type === 3 && !savedGroups.has(id)) {
                activeGroupsCache.set(id, ch);
            }
        }
    } catch {}
}

function getChannelMessagesSnapshot(channelId: string): any[] {
    try {
        const cache = MessageStore?.getMessages?.(channelId) as any;
        if (!cache) return [];
        let rawList: any[] = [];
        if (Array.isArray(cache)) rawList = cache;
        else if (typeof cache.toArray === "function") rawList = cache.toArray();
        else if (Array.isArray(cache._array)) rawList = cache._array;
        else if (typeof cache.values === "function") rawList = Array.from(cache.values());
        else if (typeof cache === "object") rawList = Object.values(cache);

        return rawList.map(msg => {
            if (!msg || typeof msg !== "object") return null;
            return {
                id: msg.id,
                channel_id: channelId,
                content: msg.content || "",
                author: msg.author ? {
                    id: msg.author.id,
                    username: msg.author.username,
                    discriminator: msg.author.discriminator,
                    avatar: msg.author.avatar,
                    global_name: msg.author.globalName || msg.author.global_name,
                    bot: msg.author.bot || false
                } : undefined,
                timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
                edited_timestamp: msg.editedTimestamp ? new Date(msg.editedTimestamp).toISOString() : null,
                attachments: Array.isArray(msg.attachments) ? msg.attachments.map((a: any) => ({
                    id: a.id,
                    filename: a.filename,
                    size: a.size,
                    url: a.url,
                    proxy_url: a.proxy_url || a.url,
                    width: a.width,
                    height: a.height,
                    content_type: a.content_type
                })) : [],
                embeds: Array.isArray(msg.embeds) ? msg.embeds : [],
                reactions: Array.isArray(msg.reactions) ? msg.reactions : [],
                type: msg.type ?? 0
            };
        }).filter(Boolean);
    } catch {
        return [];
    }
}

async function persistSavedGroups() {
    try {
        await DataStore.set(DATA_STORE_KEY, Array.from(savedGroups.values()));
    } catch (e) {
        console.error("[SaveGroups] Failed to save groups to DataStore:", e);
    }
}

function updateStyles() {
    let styleEl = document.getElementById("vc-savegroups-dynamic-styles") as HTMLStyleElement | null;
    if (savedGroups.size === 0) {
        if (styleEl) styleEl.remove();
        return;
    }

    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "vc-savegroups-dynamic-styles";
        document.head.appendChild(styleEl);
    }

    const opacity = (settings.store.dimOpacity ?? 50) / 100;
    const hoverOpacity = Math.min(1, opacity + 0.3);

    const selectors = Array.from(savedGroups.keys()).map(id => `
        a[href*="/channels/@me/${id}"],
        div[data-list-item-id*="${id}"],
        li:has(a[href*="/channels/@me/${id}"])
    `).join(",\n");

    const hoverSelectors = Array.from(savedGroups.keys()).map(id => `
        a[href*="/channels/@me/${id}"]:hover,
        div[data-list-item-id*="${id}"]:hover,
        li:has(a[href*="/channels/@me/${id}"]):hover
    `).join(",\n");

    styleEl.textContent = `
        ${selectors} {
            opacity: ${opacity} !important;
            filter: grayscale(80%) !important;
            transition: opacity 0.2s ease, filter 0.2s ease !important;
        }
        ${hoverSelectors} {
            opacity: ${hoverOpacity} !important;
            filter: grayscale(30%) !important;
        }
    `;
}

function scanAndTagSidebarElements() {
    if (savedGroups.size === 0) return;

    for (const [id] of savedGroups) {
        const elements = document.querySelectorAll(
            `a[href*="/channels/@me/${id}"], div[data-list-item-id*="${id}"]`
        );

        for (const el of Array.from(elements)) {
            if (!el.classList.contains("vc-savegroups-kicked")) {
                el.classList.add("vc-savegroups-kicked");
            }

            if (!el.querySelector(".vc-savegroups-badge")) {
                const nameContainer = el.querySelector('[class*="name_"], [class*="channelName_"], [class*="nameAndDecorators_"]') ||
                    el.querySelector('[class*="children_"]') ||
                    el.querySelector('div[class*="content_"]') ||
                    el;

                if (nameContainer) {
                    const badge = document.createElement("span");
                    badge.className = "vc-savegroups-badge";
                    badge.textContent = t("Archived");
                    nameContainer.appendChild(badge);
                }
            }
        }
    }
}

function startSidebarObserver() {
    if (sidebarObserver) return;

    sidebarObserver = new MutationObserver(() => {
        if (_domUpdateTimer) return;
        _domUpdateTimer = setTimeout(() => {
            _domUpdateTimer = undefined;
            scanAndTagSidebarElements();
        }, 150);
    });

    const target = document.querySelector('nav[aria-label]') ||
        document.querySelector('[class*="privateChannels_"]') ||
        document.querySelector('[class*="sidebar_"]') ||
        document.body;

    sidebarObserver.observe(target, { childList: true, subtree: true });
    scanAndTagSidebarElements();
}

function restoreSavedMessages(channelId: string) {
    const saved = savedGroups.get(channelId);
    if (!saved?.savedMessages || saved.savedMessages.length === 0) return;

    try {
        const messageRecords = saved.savedMessages.map((msg: any) => {
            if (typeof createMessageRecord === "function") {
                try {
                    return createMessageRecord(msg);
                } catch {}
            }
            return msg;
        });

        setTimeout(() => {
            try {
                FluxDispatcher.dispatch({
                    type: "LOAD_MESSAGES_SUCCESS",
                    channelId,
                    messages: messageRecords,
                    isBefore: false,
                    isAfter: false,
                    hasMoreBefore: false,
                    hasMoreAfter: false,
                    limit: 100,
                });
            } catch {}
        }, 60);
    } catch {}
}

function removeArchivedNoticeBanner() {
    _bannerTimers.forEach(clearTimeout);
    _bannerTimers = [];
    const el = document.getElementById("vc-savegroups-chat-banner");
    if (el) el.remove();
}

function renderArchivedNoticeBanner(channelId: string) {
    removeArchivedNoticeBanner();
    if (!savedGroups.has(channelId)) return;

    const group = savedGroups.get(channelId);
    if (!group) return;

    const banner = document.createElement("div");
    banner.id = "vc-savegroups-chat-banner";
    banner.className = "vc-savegroups-banner";

    const leftDiv = document.createElement("div");
    leftDiv.className = "vc-savegroups-banner-left";

    leftDiv.innerHTML = `
        <svg class="vc-savegroups-banner-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="21 8 21 3 21 3 8"></polyline>
            <rect x="1" y="3" width="22" height="5"></rect>
            <line x1="10" y1="12" x2="14" y2="12"></line>
        </svg>
        <div>
            <div class="vc-savegroups-banner-title">${escapeHtml(t("Archived Group"))} - ${escapeHtml(group.name || "Group DM")}</div>
            <div class="vc-savegroups-banner-subtitle">${escapeHtml(t("This group is archived. You were removed from this group. New messages and calls are disabled."))}</div>
        </div>
    `;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "vc-savegroups-banner-btn";
    deleteBtn.textContent = t("Delete Saved Group");
    deleteBtn.onclick = () => {
        confirmDeleteSavedGroup(channelId);
    };

    banner.appendChild(leftDiv);
    banner.appendChild(deleteBtn);

    const tryAttach = () => {
        const chatContent = document.querySelector('[class*="chatContent"]') ||
            document.querySelector('[class*="messagesWrapper"]')?.parentElement ||
            document.querySelector('[class*="content_"][class*="chat"]');
        if (chatContent && !document.getElementById("vc-savegroups-chat-banner")) {
            chatContent.prepend(banner);
            return true;
        }
        return false;
    };

    if (!tryAttach()) {
        const timer = setTimeout(tryAttach, 200);
        _bannerTimers.push(timer);
        const retryTimer = setTimeout(tryAttach, 600);
        _bannerTimers.push(retryTimer);
    }
}

function confirmDeleteSavedGroup(channelId: string) {
    const group = savedGroups.get(channelId);
    const name = group?.name || "Group DM";

    Alerts.show({
        title: t("Delete Saved Group"),
        confirmText: t("Delete"),
        cancelText: t("Cancel"),
        confirmColor: "brand-danger",
        body: (
            <div style={{ color: "var(--text-normal, #dbdee1)", fontSize: "14px", lineHeight: "1.4" }}>
                {t("Are you sure you want to permanently delete this saved group from your messages?")}
                <div style={{ marginTop: "8px", fontWeight: "bold", color: "var(--header-primary, #ffffff)" }}>
                    {name}
                </div>
            </div>
        ),
        onConfirm: () => {
            deleteSavedGroup(channelId);
        }
    });
}

async function deleteSavedGroup(channelId: string) {
    manuallyDeletedGroupIds.add(channelId);
    savedGroups.delete(channelId);
    hydratedChannels.delete(channelId);
    await persistSavedGroups();
    updateStyles();
    removeArchivedNoticeBanner();

    if (SelectedChannelStore.getChannelId() === channelId) {
        NavigationRouter.transitionTo("/channels/@me");
    }

    try { (ChannelStore as any)?.emitChange?.(); } catch {}
    const sortStore = (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
    try { sortStore?.emitChange?.(); } catch {}

    showToast(t("Saved group removed"), Toasts.Type.SUCCESS);
}

async function backupGroupNow(channel: any) {
    const channelId = channel.id;
    const messages = settings.store.saveMessages ? getChannelMessagesSnapshot(channelId) : [];
    const groupData: SavedGroupData = {
        id: channelId,
        name: channel.name || "Group DM",
        icon: channel.icon,
        ownerId: channel.ownerId,
        topic: channel.topic,
        type: 3,
        recipients: channel.recipients,
        rawRecipients: channel.rawRecipients,
        lastMessageId: channel.lastMessageId,
        kickedAt: Date.now(),
        savedMessages: messages
    };

    savedGroups.set(channelId, groupData);
    hydratedChannels.set(channelId, hydrateChannelRecord(groupData));
    await persistSavedGroups();
    updateStyles();
    scanAndTagSidebarElements();

    try { (ChannelStore as any)?.emitChange?.(); } catch {}
    const sortStore = (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
    try { sortStore?.emitChange?.(); } catch {}

    showToast(t("Group backed up successfully"), Toasts.Type.SUCCESS);
}

async function handleChannelDelete(event: { channel: any; }) {
    const channelId = event?.channel?.id;
    if (!channelId) return;

    if (manuallyDeletedGroupIds.has(channelId)) {
        manuallyDeletedGroupIds.delete(channelId);
        return;
    }

    const cached = activeGroupsCache.get(channelId);
    const existing = ChannelStore.getChannel(channelId);
    const channel = cached || existing || event.channel;

    if (!channel || (channel.type !== 3 && event.channel?.type !== 3)) return;

    const messages = settings.store.saveMessages ? getChannelMessagesSnapshot(channelId) : [];

    const groupData: SavedGroupData = {
        id: channelId,
        name: channel.name || "Group DM",
        icon: channel.icon,
        ownerId: channel.ownerId,
        topic: channel.topic,
        type: 3,
        recipients: channel.recipients,
        rawRecipients: channel.rawRecipients,
        lastMessageId: channel.lastMessageId || channel.last_message_id,
        kickedAt: Date.now(),
        savedMessages: messages
    };

    savedGroups.set(channelId, groupData);
    hydratedChannels.set(channelId, hydrateChannelRecord(groupData));
    await persistSavedGroups();
    updateStyles();
    scanAndTagSidebarElements();

    try { (ChannelStore as any)?.emitChange?.(); } catch {}
    const sortStore = (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
    try { sortStore?.emitChange?.(); } catch {}

    if (settings.store.notifyOnSave) {
        showNotification({
            title: t("Kicked from group"),
            body: `${groupData.name} - ${t("Saved group to your DMs.")}`,
            icon: undefined
        });
    }
    showToast(t("Saved group to your DMs."), Toasts.Type.INFO);
}

function handleChannelSelect(channelId: string) {
    if (!channelId) {
        removeArchivedNoticeBanner();
        return;
    }

    if (savedGroups.has(channelId)) {
        renderArchivedNoticeBanner(channelId);
        restoreSavedMessages(channelId);
    } else {
        removeArchivedNoticeBanner();
    }
}

function patchChannelStore() {
    const channelStoreAny = ChannelStore as any;
    if (!channelStoreAny) return;

    const origGetChannel = ChannelStore.getChannel;
    ChannelStore.getChannel = function(id: string) {
        if (id && savedGroups.has(id)) {
            return hydratedChannels.get(id);
        }
        return origGetChannel.apply(this, arguments as any);
    };
    unpatchChannelStore = () => { ChannelStore.getChannel = origGetChannel; };

    if (channelStoreAny.getMutablePrivateChannels) {
        const origGetMut = channelStoreAny.getMutablePrivateChannels;
        channelStoreAny.getMutablePrivateChannels = function() {
            const chs = origGetMut.apply(this, arguments as any) || {};
            if (savedGroups.size === 0) return chs;
            let modified = false;
            const res = { ...chs };
            for (const [id] of savedGroups) {
                if (!res[id]) {
                    const hydrated = hydratedChannels.get(id);
                    if (hydrated) {
                        res[id] = hydrated;
                        modified = true;
                    }
                }
            }
            return modified ? res : chs;
        };
        unpatchChannelStoreGetMutablePrivate = () => { channelStoreAny.getMutablePrivateChannels = origGetMut; };
    }

    if (channelStoreAny.getPrivateChannels) {
        const origGetPriv = channelStoreAny.getPrivateChannels;
        channelStoreAny.getPrivateChannels = function() {
            const chs = origGetPriv.apply(this, arguments as any) || {};
            if (savedGroups.size === 0) return chs;
            let modified = false;
            const res = { ...chs };
            for (const [id] of savedGroups) {
                if (!res[id]) {
                    const hydrated = hydratedChannels.get(id);
                    if (hydrated) {
                        res[id] = hydrated;
                        modified = true;
                    }
                }
            }
            return modified ? res : chs;
        };
        unpatchChannelStoreGetPrivate = () => { channelStoreAny.getPrivateChannels = origGetPriv; };
    }
}

function patchPrivateChannelSortStore(sortStore: any) {
    if (!sortStore || (sortStore as any).__nightcordSaveGroupsPatched) return;
    (sortStore as any).__nightcordSaveGroupsPatched = true;

    const sortUnpatches: (() => void)[] = [];
    const patchSortFn = (fnName: string) => {
        if (typeof sortStore[fnName] === "function") {
            const orig = sortStore[fnName];
            const isObjectArray = fnName === "getSortedPrivateChannels";

            sortStore[fnName] = function(...args: any[]) {
                const list: any = orig.apply(this, args);
                if (!list || !Array.isArray(list) || savedGroups.size === 0) return list;

                const result = [...list];
                const existingIds = new Set(result.map((item: any) => typeof item === "string" ? item : item?.id));

                for (const [id] of savedGroups) {
                    if (!existingIds.has(id)) {
                        existingIds.add(id);
                        if (isObjectArray) {
                            const hydrated = hydratedChannels.get(id);
                            if (hydrated) result.push(hydrated);
                        } else {
                            result.push(id);
                        }
                    }
                }
                return result;
            };

            sortUnpatches.push(() => {
                sortStore[fnName] = orig;
                delete (sortStore as any).__nightcordSaveGroupsPatched;
            });
        }
    };

    ["getPrivateChannelIds", "getSortedPrivateChannels", "getSortedPrivateChannelIds"].forEach(patchSortFn);
    unpatchPrivateChannelSortStore = () => {
        sortUnpatches.forEach(fn => fn());
        sortUnpatches.length = 0;
    };
}

function patchMessageActions() {
    try {
        const MessageActions = (findByProps("fetchMessages", "sendMessage") || findByProps("sendMessage")) as any;
        if (MessageActions) {
            if (typeof MessageActions.fetchMessages === "function") {
                const origFetch = MessageActions.fetchMessages;
                MessageActions.fetchMessages = function(opts: any) {
                    const channelId = opts?.channelId;
                    if (channelId && savedGroups.has(channelId)) {
                        return Promise.resolve();
                    }
                    return origFetch.apply(this, arguments as any);
                };
                unpatchFetchMessages = () => { MessageActions.fetchMessages = origFetch; };
            }

            if (typeof MessageActions.sendMessage === "function") {
                const origSend = MessageActions.sendMessage;
                MessageActions.sendMessage = function(channelId: string, ...args: any[]) {
                    if (channelId && savedGroups.has(channelId)) {
                        showToast(t("Cannot send messages in an archived group."), Toasts.Type.FAILURE);
                        return Promise.resolve({ ok: false });
                    }
                    return origSend.apply(this, [channelId, ...args]);
                };
                unpatchSendMessage = () => { MessageActions.sendMessage = origSend; };
            }
        }
    } catch (e) {
        console.error("[SaveGroups] Failed to patch MessageActions:", e);
    }
}

const ContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { channel?: any; } = {}) => {
    const { channel } = ctx;
    if (!channel) return;

    const channelId = channel.id;
    if (savedGroups.has(channelId)) {
        children.unshift(
            <Menu.MenuGroup key="vc-savegroups-actions">
                <Menu.MenuItem
                    key="delete-saved-group"
                    id="vc-delete-saved-group"
                    label={t("Delete Saved Group")}
                    color="danger"
                    action={() => confirmDeleteSavedGroup(channelId)}
                />
                <Menu.MenuSeparator key="separator-savegroups" />
            </Menu.MenuGroup>
        );
    } else if (channel.type === 3) {
        children.unshift(
            <Menu.MenuGroup key="vc-savegroups-backup">
                <Menu.MenuItem
                    key="backup-group-now"
                    id="vc-backup-group-now"
                    label={t("Backup Group Now")}
                    action={() => backupGroupNow(channel)}
                />
                <Menu.MenuSeparator key="separator-savegroups-backup" />
            </Menu.MenuGroup>
        );
    }
};

export default definePlugin({
    name: "SaveGroups",
    description: "Bypasses group DM removal by keeping kicked groups in your direct messages in read-only mode.",
    authors: [{ name: "Nightcord", id: 0n }],
    enabledByDefault: false,
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "channel-context": ContextMenuPatch,
        "gdm-context": ContextMenuPatch
    },

    flux: {
        CHANNEL_CREATE(event: { channel: any; }) {
            cacheActiveGroup(event?.channel);
        },
        CHANNEL_UPDATES(event: { channels: any[]; }) {
            if (Array.isArray(event?.channels)) {
                event.channels.forEach(cacheActiveGroup);
            }
        },
        CONNECTION_OPEN() {
            refreshActiveGroupsCache();
        },
        CHANNEL_DELETE(event: { channel: any; }) {
            handleChannelDelete(event);
        },
        CHANNEL_SELECT(event: { channelId: string; }) {
            handleChannelSelect(event?.channelId);
        }
    },

    async start() {
        try {
            const entries = await DataStore.get<SavedGroupData[]>(DATA_STORE_KEY);
            if (Array.isArray(entries)) {
                for (const data of entries) {
                    if (data?.id) {
                        savedGroups.set(data.id, data);
                        hydratedChannels.set(data.id, hydrateChannelRecord(data));
                    }
                }
            }
        } catch (e) {
            console.error("[SaveGroups] Failed to load saved groups from DataStore:", e);
        }

        refreshActiveGroupsCache();
        patchChannelStore();

        const existingSortStore = (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
        if (existingSortStore) {
            patchPrivateChannelSortStore(existingSortStore);
        }
        waitFor(["getPrivateChannelIds"], (store: any) => {
            patchPrivateChannelSortStore(store);
        });

        patchMessageActions();
        updateStyles();
        startSidebarObserver();

        const currentChannelId = SelectedChannelStore?.getChannelId?.();
        if (currentChannelId && savedGroups.has(currentChannelId)) {
            renderArchivedNoticeBanner(currentChannelId);
            restoreSavedMessages(currentChannelId);
        }

        try { (ChannelStore as any)?.emitChange?.(); } catch {}
        try { existingSortStore?.emitChange?.(); } catch {}
    },

    stop() {
        if (unpatchChannelStore) {
            unpatchChannelStore();
            unpatchChannelStore = null;
        }
        if (unpatchChannelStoreGetMutablePrivate) {
            unpatchChannelStoreGetMutablePrivate();
            unpatchChannelStoreGetMutablePrivate = null;
        }
        if (unpatchChannelStoreGetPrivate) {
            unpatchChannelStoreGetPrivate();
            unpatchChannelStoreGetPrivate = null;
        }
        if (unpatchPrivateChannelSortStore) {
            unpatchPrivateChannelSortStore();
            unpatchPrivateChannelSortStore = null;
        }
        if (unpatchFetchMessages) {
            unpatchFetchMessages();
            unpatchFetchMessages = null;
        }
        if (unpatchSendMessage) {
            unpatchSendMessage();
            unpatchSendMessage = null;
        }

        if (sidebarObserver) {
            sidebarObserver.disconnect();
            sidebarObserver = null;
        }
        if (_domUpdateTimer) {
            clearTimeout(_domUpdateTimer);
            _domUpdateTimer = undefined;
        }

        document.querySelectorAll(".vc-savegroups-kicked").forEach(el => {
            el.classList.remove("vc-savegroups-kicked");
        });
        document.querySelectorAll(".vc-savegroups-badge").forEach(el => {
            el.remove();
        });

        removeArchivedNoticeBanner();

        const styleEl = document.getElementById("vc-savegroups-dynamic-styles");
        if (styleEl) styleEl.remove();

        const sortStore = (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
        try { (ChannelStore as any)?.emitChange?.(); } catch {}
        try { sortStore?.emitChange?.(); } catch {}
    }
});
