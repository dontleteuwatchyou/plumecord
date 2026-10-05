/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { definePluginSettings } from "@api/Settings";
import { proxyLazy } from "@utils/lazy";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { findAll, filters, findByCodeLazy, findByProps, findStore, waitFor } from "@webpack";
import {
    ChannelActionCreators,
    ChannelStore,
    ComponentDispatch,
    DraftStore,
    DraftType,
    FluxDispatcher,
    IconUtils,
    React,
    SelectedChannelStore,
    showToast,
    Toasts,
    UploadManager,
    UserStore
} from "@webpack/common";

import { t } from "../autoTranslateNightcord";
import { openSavedMessagesChangePasswordModal } from "./ChangePasswordModal";
import { SavedMessagesSettingsPanel } from "./SettingsPanel";
import {
    addSavedMessage,
    checkVaultStatus,
    clearAllSavedMessages,
    deleteSavedMessage,
    getDecryptedMessages,
    isVaultUnlocked,
    lockVault,
    Native,
    SAVED_MESSAGES_CHANNEL_ID,
    SAVED_MESSAGES_USER_ID,
    SavedMessage,
    storeListeners,
    unlockVault
} from "./store";
import { openSavedMessagesUnlockModal } from "./UnlockModal";

export const settings = definePluginSettings({
    isDmClosed: {
        type: OptionType.BOOLEAN,
        description: "Whether the Saved Messages DM is closed",
        default: false,
        hidden: true,
    }
});

export function isDmClosedSafe(): boolean {
    try {
        return Boolean(settings?.store?.isDmClosed);
    } catch {
        return false;
    }
}

export function setDmClosedSafe(val: boolean): void {
    try {
        if (settings?.store) {
            settings.store.isDmClosed = val;
        }
    } catch { }
}

const SAVED_MESSAGES_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5865F2"/>
      <stop offset="100%" stop-color="#3C45A5"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="64" fill="url(#bgGrad)"/>
  <path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M38 32c0-3.314 2.686-6 6-6h40c3.314 0 6 2.686 6 6v66.417c0 2.827-3.328 4.333-5.45 2.47L64 82.35l-20.55 18.537c-2.122 1.863-5.45.357-5.45-2.47V32Zm12 12a3 3 0 0 0 0 6h28a3 3 0 1 0 0-6H50Zm0 14a3 3 0 0 0 0 6h28a3 3 0 1 0 0-6H50Z"/>
</svg>
`);

const createChannelRecordFromServer = findByCodeLazy(".GUILD_TEXT]", "fromServer)");
const createMessageRecord = findByCodeLazy(".createFromServer(", ".isBlockedForMessage", "messageReference:");

const rawSavedMessagesUser = {
    id: SAVED_MESSAGES_USER_ID,
    username: "SavedMessages",
    discriminator: "0",
    globalName: "Saved Messages",
    global_name: "Saved Messages",
    avatar: "saved_messages_avatar",
    bot: false,
    system: false,
    verified: false,
    public_flags: 0,
    flags: 0,
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    getCreatedAt: () => new Date("2020-01-01T00:00:00.000Z"),
    isSystemUser: () => false,
    isVerifiedBot: () => false,
    isOfficialSystem: () => false,
    isBot: () => false,
    isNonUserBot: () => false,
    getAvatarURL: () => SAVED_MESSAGES_AVATAR,
    getAvatarSource: () => ({ uri: SAVED_MESSAGES_AVATAR }),
    toString: () => `<@${SAVED_MESSAGES_USER_ID}>`,
};

const rawSavedMessagesUserProxy = new Proxy(rawSavedMessagesUser, {
    get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === "string") {
            if (prop.startsWith("is") || prop.startsWith("has") || prop.startsWith("can")) {
                return () => false;
            }
            if (prop.startsWith("get")) {
                return () => null;
            }
        }
        return undefined;
    }
});

export const SAVED_MESSAGES_USER = proxyLazy(() => {
    try {
        const URec: any = UserStore.getCurrentUser()?.constructor;
        if (URec) {
            const u = new URec({
                id: SAVED_MESSAGES_USER_ID,
                username: "SavedMessages",
                discriminator: "0",
                globalName: "Saved Messages",
                global_name: "Saved Messages",
                avatar: "saved_messages_avatar",
                accent_color: 5793266,
                banner_color: "#5865f2",
                bot: false,
                system: false,
                public_flags: 0,
                flags: 0,
                verified: false,
            });
            u.isSystemUser = () => false;
            u.isVerifiedBot = () => false;
            u.isOfficialSystem = () => false;
            u.isBot = () => false;
            u.getAvatarURL = () => SAVED_MESSAGES_AVATAR;
            u.getAvatarSource = () => ({ uri: SAVED_MESSAGES_AVATAR });
            u.createdAt = new Date("2020-01-01T00:00:00.000Z");
            return u;
        }
    } catch { }
    return rawSavedMessagesUserProxy;
});

const rawSavedMessagesChannel = {
    id: SAVED_MESSAGES_CHANNEL_ID,
    type: 1, // DM
    name: "Saved Messages",
    guild_id: null,
    guildId: null,
    getGuildId: () => null,
    getRecipientId: () => SAVED_MESSAGES_USER_ID,
    recipients: [SAVED_MESSAGES_USER_ID],
    rawRecipients: [SAVED_MESSAGES_USER],
    isSystem: () => false,
    isOfficialSystem: () => false,
    isSystemDM: () => false,
    isDM: () => true,
    isGroupDM: () => false,
    isMultiUserDM: () => false,
    isPrivate: () => true,
    isArchivedThread: () => false,
    isThread: () => false,
    isSpam: () => false,
    isMessageRequest: () => false,
    computedPosition: 0,
    position: 0,
    permissionOverwrites: {},
};

const rawSavedMessagesChannelProxy = new Proxy(rawSavedMessagesChannel, {
    get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === "string") {
            if (prop.startsWith("is") || prop.startsWith("has") || prop.startsWith("can")) {
                return () => false;
            }
            if (prop.startsWith("get")) {
                return () => null;
            }
        }
        return undefined;
    }
});

export const SAVED_MESSAGES_CHANNEL = proxyLazy(() => {
    try {
        if (typeof createChannelRecordFromServer === "function") {
            const ch = createChannelRecordFromServer({
                id: SAVED_MESSAGES_CHANNEL_ID,
                type: 1, // DM
                name: "Saved Messages",
                recipients: [SAVED_MESSAGES_USER],
                rawRecipients: [SAVED_MESSAGES_USER],
                is_spam: false,
                is_message_request: false,
            });
            if (ch) {
                ch.isSystem = () => false;
                ch.isOfficialSystem = () => false;
                ch.isSystemDM = () => false;
                ch.isDM = () => true;
                ch.isPrivate = () => true;
                ch.getRecipientId = () => SAVED_MESSAGES_USER_ID;
                return ch;
            }
        }
    } catch { }
    return rawSavedMessagesChannelProxy;
});

let unpatchUserStore: (() => void) | null = null;
let unpatchUserStoreGetUsers: (() => void) | null = null;
let unpatchChannelStore: (() => void) | null = null;
let unpatchChannelStoreGetBasic: (() => void) | null = null;
let unpatchChannelStoreHasChannel: (() => void) | null = null;
let unpatchChannelStoreGetPrivate: (() => void) | null = null;
let unpatchChannelStoreGetMutablePrivate: (() => void) | null = null;
let unpatchChannelStoreGetSortedPrivate: (() => void) | null = null;
let unpatchChannelStoreGetDMFromUserId: (() => void) | null = null;
let unpatchChannelStoreGetDMChannelFromUserId: (() => void) | null = null;
let unpatchChannelStoreGetDMUserIds: (() => void) | null = null;
let unpatchChannelStoreGetMutableDMsByUserIds: (() => void) | null = null;
let unpatchPrivateChannelSortStore: (() => void) | null = null;
let unpatchFetchMessages: (() => void) | null = null;
let unpatchDeleteMessage: (() => void) | null = null;
let unpatchHTTPGet: (() => void) | null = null;
let unpatchHTTPPost: (() => void) | null = null;
let unpatchPermissionStore: (() => void) | null = null;
let unpatchRelationshipStore: (() => void) | null = null;
let unpatchAvatarFns: (() => void)[] = [];

function convertSavedMessageToDiscordMessage(msg: SavedMessage): any {
    const attachments: any[] = [];

    for (const att of msg.attachments || []) {
        attachments.push({
            id: att.id,
            filename: att.filename,
            size: att.size,
            url: att.dataUrl,
            proxy_url: att.dataUrl,
            content_type: att.contentType,
            width: att.width || (att.isImage ? 600 : undefined),
            height: att.height || (att.isImage ? 400 : undefined),
            spoiler: false
        });
    }

    const rawMsg = {
        id: msg.id,
        channel_id: SAVED_MESSAGES_CHANNEL_ID,
        author: {
            id: SAVED_MESSAGES_USER_ID,
            username: "SavedMessages",
            discriminator: "0",
            global_name: "Saved Messages",
            avatar: "saved_messages_avatar",
            bot: false,
            system: false
        },
        content: msg.content || "",
        timestamp: msg.timestamp,
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments,
        embeds: msg.embeds || [],
        pinned: false,
        type: 0,
        flags: 0,
    };

    try {
        if (typeof createMessageRecord === "function") {
            return createMessageRecord(rawMsg);
        }
    } catch { }

    return rawMsg;
}

function injectDecryptedMessages() {
    const messages = getDecryptedMessages();
    const discordRecords = messages.map(convertSavedMessageToDiscordMessage);

    try {
        FluxDispatcher.dispatch({
            type: "CHANNEL_CREATE",
            channel: SAVED_MESSAGES_CHANNEL,
        });
    } catch { }

    try {
        FluxDispatcher.dispatch({
            type: "LOAD_MESSAGES_SUCCESS",
            channelId: SAVED_MESSAGES_CHANNEL_ID,
            messages: discordRecords,
            isBefore: false,
            isAfter: false,
            hasMoreBefore: false,
            hasMoreAfter: false,
            limit: 100,
        });
    } catch { }
}

function resolveEmptyMessages() {
    try {
        FluxDispatcher.dispatch({
            type: "CHANNEL_CREATE",
            channel: SAVED_MESSAGES_CHANNEL,
        });
    } catch { }

    try {
        FluxDispatcher.dispatch({
            type: "LOAD_MESSAGES_SUCCESS",
            channelId: SAVED_MESSAGES_CHANNEL_ID,
            messages: [],
            isBefore: false,
            isAfter: false,
            hasMoreBefore: false,
            hasMoreAfter: false,
            limit: 100,
        });
    } catch { }
}

function reinjectSavedMessages() {
    if (isDmClosedSafe()) return;
    try {
        FluxDispatcher.dispatch({
            type: "CHANNEL_CREATE",
            channel: SAVED_MESSAGES_CHANNEL,
        });
    } catch { }
    try { (findStore("ChannelStore") as any)?.emitChange(); } catch { }
    try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch { }
    try { (findStore("UserStore") as any)?.emitChange(); } catch { }
}

function handleConnectionEvents() {
    if (!isDmClosedSafe()) {
        reinjectSavedMessages();
        setTimeout(reinjectSavedMessages, 150);
        setTimeout(reinjectSavedMessages, 600);
        setTimeout(reinjectSavedMessages, 1500);
    }
}

function handleChannelSelect(e: any) {
    const id = typeof e === "string" ? e : (e?.channelId || e?.channel_id || e?.channel?.id || e?.id);
    if (id === SAVED_MESSAGES_CHANNEL_ID) {
        setDmClosedSafe(false);
        reinjectSavedMessages();

        checkVaultStatus().then(() => {
            if (isVaultUnlocked()) {
                injectDecryptedMessages();
            } else {
                resolveEmptyMessages();
                setTimeout(() => {
                    openSavedMessagesUnlockModal(() => injectDecryptedMessages());
                }, 50);
            }
        });
    }
}

export function SavedMessagesBanner() {
    const [, forceUpdate] = React.useState(0);

    React.useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        storeListeners.add(listener);
        return () => { storeListeners.delete(listener); };
    }, []);

    const unlocked = isVaultUnlocked();

    return (
        <div className="nc-saved-messages-banner">
            <div className="nc-saved-messages-banner-left">
                <div className="nc-saved-messages-banner-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M18 2H6a2 2 0 0 0-2 2v18l8-4 8 4V4a2 2 0 0 0-2-2Zm-3 6H9V6h6v2Zm0 4H9v-2h6v2Z" />
                    </svg>
                </div>
                <div>
                    <div className="nc-saved-messages-banner-title">
                        {t("Saved Messages — Local Encrypted Storage")}
                    </div>
                    <div className="nc-saved-messages-banner-desc">
                        {unlocked
                            ? t("Vault unlocked. Messages & media are encrypted with AES-256 + ChaCha20 locally on your disk.")
                            : t("Vault locked. Enter your master password to view saved messages.")}
                    </div>
                </div>
            </div>
            <div className="nc-saved-messages-banner-actions">
                <button
                    className="nc-saved-messages-banner-btn"
                    style={{
                        padding: "6px 12px",
                        background: "var(--background-modifier-accent)",
                        color: "var(--header-primary)",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600
                    }}
                    onClick={() => openSavedMessagesChangePasswordModal()}
                >
                    {t("Change Password")}
                </button>
                <button
                    className="nc-saved-messages-banner-btn"
                    style={{
                        padding: "6px 12px",
                        background: "var(--background-modifier-accent)",
                        color: "var(--header-primary)",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600
                    }}
                    onClick={() => {
                        try { Native?.openStorageFolder?.(); } catch { }
                    }}
                >
                    {t("Open Folder")}
                </button>
                {unlocked ? (
                    <>
                        <button
                            style={{
                                padding: "6px 12px",
                                background: "var(--status-danger-background)",
                                color: "var(--text-danger)",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 600
                            }}
                            onClick={() => {
                                if (confirm(t("Are you sure you want to permanently clear all saved messages and media files?"))) {
                                    clearAllSavedMessages();
                                    showToast(t("All saved messages cleared."), Toasts.Type.SUCCESS);
                                }
                            }}
                        >
                            {t("Clear All")}
                        </button>
                        <button
                            style={{
                                padding: "6px 12px",
                                background: "var(--brand-500)",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 600
                            }}
                            onClick={() => {
                                lockVault();
                                showToast(t("Saved Messages locked."), Toasts.Type.INFO);
                            }}
                        >
                            {t("Lock Vault")}
                        </button>
                    </>
                ) : (
                    <button
                        style={{
                            padding: "6px 12px",
                            background: "var(--brand-500)",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 600
                        }}
                        onClick={() => openSavedMessagesUnlockModal(() => injectDecryptedMessages())}
                    >
                        {t("Unlock")}
                    </button>
                )}
            </div>
        </div>
    );
}

export default definePlugin({
    name: "SavedMessages",
    description: "Telegram-style Saved Messages DM with local military-grade encryption (AES-256 + ChaCha20). Zero transit with Discord servers.",
    enabledByDefault: false,
    startAt: StartAt.WebpackReady,
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["MessageEventsAPI"],
    settings,
    settingsAboutComponent: SavedMessagesSettingsPanel,

    flux: {
        CHANNEL_SELECT: handleChannelSelect,
        CONNECTION_OPEN: handleConnectionEvents,
        POST_CONNECTION_OPEN: handleConnectionEvents,
        CONNECTION_RESUMED: handleConnectionEvents,
        CURRENT_USER_UPDATE: handleConnectionEvents,
        LOGOUT: handleConnectionEvents,
        ACCOUNT_SWITCH: handleConnectionEvents,
        OVERLAY_INITIALIZE: handleConnectionEvents,
        PASSIVE_UPDATE_V2: handleConnectionEvents,
        CHANNEL_UPDATES: handleConnectionEvents,
    },

    patches: [
        {
            find: '"sticker")',
            replacement: {
                match: /0===(\i)\.length(?=.{0,25}?\(0,\i\.jsxs?\)\(.{0,75}?children:\1)/,
                replace: "(Vencord.Api.ChatButtons._injectButtons($1,arguments[0]),$self.isSavedMessagesChannel(arguments[0])?$self.renderBanner():$&)"
            }
        },
        // Direct React Component patch for DM list
        {
            find: '"dm-quick-launcher"===',
            replacement: {
                match: /privateChannelIds:([^,]+)(?=,listRef:)/,
                replace: "privateChannelIds:$self.injectSavedMessagesDm($1)"
            }
        }
    ],

    injectSavedMessagesDm(channelIds: any) {
        if (!Array.isArray(channelIds)) return channelIds;
        if (isDmClosedSafe()) {
            return channelIds.filter((id: string) => id !== SAVED_MESSAGES_CHANNEL_ID);
        }
        const filtered = channelIds.filter((id: string) => id !== SAVED_MESSAGES_CHANNEL_ID);
        return [SAVED_MESSAGES_CHANNEL_ID, ...filtered];
    },

    isSavedMessagesChannel(props: any) {
        const id = props?.channel?.id || props?.id;
        if (id === SAVED_MESSAGES_CHANNEL_ID) return true;
        if (props?.channel?.name === "Saved Messages" || props?.name === "Saved Messages") return true;
        if (SelectedChannelStore.getChannelId() === SAVED_MESSAGES_CHANNEL_ID) return true;
        return false;
    },

    renderBanner() {
        return (
            <ErrorBoundary noop>
                <SavedMessagesBanner />
            </ErrorBoundary>
        );
    },

    async onBeforeMessageSend(channelId, messageObj, options, props) {
        if (channelId !== SAVED_MESSAGES_CHANNEL_ID) return;

        if (!isVaultUnlocked()) {
            openSavedMessagesUnlockModal();
            return { cancel: true };
        }

        const text = messageObj?.content || options?.content || "";
        const files: (File | any)[] = [];

        if (Array.isArray(options?.uploads)) {
            for (const u of options.uploads) {
                if (u?.item?.file) files.push(u.item.file);
                else if (u?.file) files.push(u.file);
            }
        }

        try {
            const uploadStore = findStore("UploadStore") as any;
            if (uploadStore?.getUploads) {
                const draftUploads = uploadStore.getUploads(channelId, DraftType.Channel) || [];
                for (const u of draftUploads) {
                    if (u?.item?.file) files.push(u.item.file);
                    else if (u?.file) files.push(u.file);
                }
            }
        } catch { }

        // Clear chat input text and attached drafts immediately
        try {
            ComponentDispatch?.dispatchToLastSubscribed?.("CLEAR_TEXT");
        } catch { }

        try {
            UploadManager?.clearAll?.(channelId, DraftType.Channel);
        } catch { }

        try {
            if (DraftStore?.clearDraft) {
                DraftStore.clearDraft(channelId, DraftType.Channel);
            }
        } catch { }

        try {
            const uploadStore = findStore("UploadStore") as any;
            if (uploadStore?.clearUploads) {
                uploadStore.clearUploads(channelId, DraftType.Channel);
            }
        } catch { }

        // Defer extra clear passes to ensure Discord's Slate editor clears after this handler returns
        setTimeout(() => {
            try {
                ComponentDispatch?.dispatchToLastSubscribed?.("CLEAR_TEXT");
            } catch { }
            try {
                UploadManager?.clearAll?.(channelId, DraftType.Channel);
            } catch { }
            try {
                if (DraftStore?.clearDraft) {
                    DraftStore.clearDraft(channelId, DraftType.Channel);
                }
            } catch { }
            try {
                const slateEl = document.querySelector('[role="textbox"]') as HTMLElement;
                if (slateEl && SelectedChannelStore.getChannelId() === SAVED_MESSAGES_CHANNEL_ID) {
                    slateEl.innerText = "";
                    slateEl.textContent = "";
                }
            } catch { }
        }, 0);

        setTimeout(() => {
            try {
                ComponentDispatch?.dispatchToLastSubscribed?.("CLEAR_TEXT");
            } catch { }
        }, 50);

        // Save locally and encrypt
        try {
            const savedMsg = await addSavedMessage(text, files);
            const discordRecord = convertSavedMessageToDiscordMessage(savedMsg);

            setDmClosedSafe(false);

            FluxDispatcher.dispatch({
                type: "MESSAGE_CREATE",
                channelId: SAVED_MESSAGES_CHANNEL_ID,
                message: discordRecord,
                optimistic: false,
                isPushNotification: false
            });

            try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch { }
        } catch (err: any) {
            showToast(err?.message || t("Failed to save message"), Toasts.Type.FAILURE);
        }

        return { cancel: true };
    },

    start() {
        checkVaultStatus();

        // Patch SnowflakeUtils
        waitFor(["fromTimestamp", "extractTimestamp"], (m: any) => {
            if (m && typeof m.extractTimestamp === "function") {
                const origExtract = m.extractTimestamp;
                m.extractTimestamp = function(snowflake: string) {
                    if (snowflake === SAVED_MESSAGES_USER_ID || snowflake === SAVED_MESSAGES_CHANNEL_ID) {
                        return new Date("2020-01-01T00:00:00Z").getTime();
                    }
                    return origExtract.apply(this, arguments as any);
                };
            }
        });

        // Patch UsernameUtils
        waitFor(["useName", "getGlobalName"], (m: any) => {
            if (m && typeof m.formatForDisplay === "function") {
                const origFmt = m.formatForDisplay;
                m.formatForDisplay = function(user: any, ...args: any[]) {
                    const id = typeof user === "string" ? user : user?.id;
                    if (id === SAVED_MESSAGES_USER_ID) return "Saved Messages";
                    return origFmt.apply(this, arguments as any);
                };
            }
        });

        // Patch IconUtils
        try {
            if (IconUtils) {
                if (typeof IconUtils.getUserAvatarURL === "function") {
                    const orig = IconUtils.getUserAvatarURL;
                    IconUtils.getUserAvatarURL = function(user: any, ...args: any[]) {
                        const id = typeof user === "string" ? user : (user?.id ?? user?.userId);
                        if (id === SAVED_MESSAGES_USER_ID) return SAVED_MESSAGES_AVATAR;
                        return orig.apply(this, arguments as any);
                    };
                    unpatchAvatarFns.push(() => { IconUtils.getUserAvatarURL = orig; });
                }
            }

            const modsWithAvatar = findAll(filters.byProps("getUserAvatarURL"));
            for (const mod of modsWithAvatar) {
                if (mod && typeof mod.getUserAvatarURL === "function") {
                    const origFn = mod.getUserAvatarURL;
                    mod.getUserAvatarURL = function(user: any, ...args: any[]) {
                        const id = typeof user === "string" ? user : (user?.id ?? user?.userId);
                        if (id === SAVED_MESSAGES_USER_ID) return SAVED_MESSAGES_AVATAR;
                        return origFn.apply(this, arguments as any);
                    };
                    unpatchAvatarFns.push(() => { mod.getUserAvatarURL = origFn; });
                }
            }
        } catch { }

        // Patch UserStore
        const origGetUser = UserStore.getUser;
        UserStore.getUser = function(id: string) {
            if (id === SAVED_MESSAGES_USER_ID) return SAVED_MESSAGES_USER;
            return origGetUser.apply(this, arguments as any);
        };
        unpatchUserStore = () => { UserStore.getUser = origGetUser; };

        const userStoreAny = UserStore as any;
        if (typeof userStoreAny.getUsers === "function") {
            const origGetUsers = userStoreAny.getUsers;
            userStoreAny.getUsers = function() {
                const res = origGetUsers.apply(this, arguments as any) || {};
                return { ...res, [SAVED_MESSAGES_USER_ID]: SAVED_MESSAGES_USER };
            };
            unpatchUserStoreGetUsers = () => { userStoreAny.getUsers = origGetUsers; };
        }

        // Patch ChannelStore
        const channelStoreAny = ChannelStore as any;

        const origGetChannel = ChannelStore.getChannel;
        ChannelStore.getChannel = function(id: string) {
            if (id === SAVED_MESSAGES_CHANNEL_ID) return SAVED_MESSAGES_CHANNEL;
            return origGetChannel.apply(this, arguments as any);
        };
        unpatchChannelStore = () => { ChannelStore.getChannel = origGetChannel; };

        if (typeof channelStoreAny.getBasicChannel === "function") {
            const origGetBasicChannel = channelStoreAny.getBasicChannel;
            channelStoreAny.getBasicChannel = function(id: string) {
                if (id === SAVED_MESSAGES_CHANNEL_ID) return SAVED_MESSAGES_CHANNEL;
                return origGetBasicChannel.apply(this, arguments as any);
            };
            unpatchChannelStoreGetBasic = () => { channelStoreAny.getBasicChannel = origGetBasicChannel; };
        }

        if (typeof channelStoreAny.hasChannel === "function") {
            const origHasChannel = channelStoreAny.hasChannel;
            channelStoreAny.hasChannel = function(id: string) {
                if (id === SAVED_MESSAGES_CHANNEL_ID) return !isDmClosedSafe();
                return origHasChannel.apply(this, arguments as any);
            };
            unpatchChannelStoreHasChannel = () => { channelStoreAny.hasChannel = origHasChannel; };
        }

        // Patch ChannelStore.getPrivateChannels
        if (typeof channelStoreAny.getPrivateChannels === "function") {
            const origGetPrivate = channelStoreAny.getPrivateChannels;
            channelStoreAny.getPrivateChannels = function() {
                const res = origGetPrivate.apply(this, arguments as any) || {};
                if (!isDmClosedSafe()) {
                    return { ...res, [SAVED_MESSAGES_CHANNEL_ID]: SAVED_MESSAGES_CHANNEL };
                }
                return res;
            };
            unpatchChannelStoreGetPrivate = () => { channelStoreAny.getPrivateChannels = origGetPrivate; };
        }

        // Patch ChannelStore.getMutablePrivateChannels
        if (typeof channelStoreAny.getMutablePrivateChannels === "function") {
            const origGetMutablePrivate = channelStoreAny.getMutablePrivateChannels;
            channelStoreAny.getMutablePrivateChannels = function() {
                const res = origGetMutablePrivate.apply(this, arguments as any) || {};
                if (!isDmClosedSafe()) {
                    return { ...res, [SAVED_MESSAGES_CHANNEL_ID]: SAVED_MESSAGES_CHANNEL };
                }
                return res;
            };
            unpatchChannelStoreGetMutablePrivate = () => { channelStoreAny.getMutablePrivateChannels = origGetMutablePrivate; };
        }

        // Patch ChannelStore.getSortedPrivateChannels
        if (typeof channelStoreAny.getSortedPrivateChannels === "function") {
            const origGetSortedPrivate = channelStoreAny.getSortedPrivateChannels;
            channelStoreAny.getSortedPrivateChannels = function() {
                const res = origGetSortedPrivate.apply(this, arguments as any) || [];
                if (!Array.isArray(res)) return res;
                const filtered = res.filter((c: any) => (typeof c === "string" ? c : (c?.id || c?.channelId)) !== SAVED_MESSAGES_CHANNEL_ID);
                if (!isDmClosedSafe()) {
                    return [SAVED_MESSAGES_CHANNEL, ...filtered];
                }
                return filtered;
            };
            unpatchChannelStoreGetSortedPrivate = () => { channelStoreAny.getSortedPrivateChannels = origGetSortedPrivate; };
        }

        // Patch ChannelStore.getDMFromUserId
        if (typeof channelStoreAny.getDMFromUserId === "function") {
            const origGetDM = channelStoreAny.getDMFromUserId;
            channelStoreAny.getDMFromUserId = function(userId: string) {
                if (userId === SAVED_MESSAGES_USER_ID) return SAVED_MESSAGES_CHANNEL_ID;
                return origGetDM.apply(this, arguments as any);
            };
            unpatchChannelStoreGetDMFromUserId = () => { channelStoreAny.getDMFromUserId = origGetDM; };
        }

        // Patch ChannelStore.getDMChannelFromUserId
        if (typeof channelStoreAny.getDMChannelFromUserId === "function") {
            const origGetDMChannel = channelStoreAny.getDMChannelFromUserId;
            channelStoreAny.getDMChannelFromUserId = function(userId: string) {
                if (userId === SAVED_MESSAGES_USER_ID) return SAVED_MESSAGES_CHANNEL;
                return origGetDMChannel.apply(this, arguments as any);
            };
            unpatchChannelStoreGetDMChannelFromUserId = () => { channelStoreAny.getDMChannelFromUserId = origGetDMChannel; };
        }

        // Patch ChannelStore.getDMUserIds
        if (typeof channelStoreAny.getDMUserIds === "function") {
            const origGetDMUserIds = channelStoreAny.getDMUserIds;
            channelStoreAny.getDMUserIds = function() {
                const res = origGetDMUserIds.apply(this, arguments as any) || [];
                if (!Array.isArray(res)) return res;
                if (!isDmClosedSafe() && !res.includes(SAVED_MESSAGES_USER_ID)) {
                    return [SAVED_MESSAGES_USER_ID, ...res];
                }
                return res;
            };
            unpatchChannelStoreGetDMUserIds = () => { channelStoreAny.getDMUserIds = origGetDMUserIds; };
        }

        // Patch ChannelStore.getMutableDMsByUserIds
        if (typeof channelStoreAny.getMutableDMsByUserIds === "function") {
            const origGetMutableDMs = channelStoreAny.getMutableDMsByUserIds;
            channelStoreAny.getMutableDMsByUserIds = function() {
                const res = origGetMutableDMs.apply(this, arguments as any) || {};
                if (!isDmClosedSafe()) {
                    return { ...res, [SAVED_MESSAGES_USER_ID]: SAVED_MESSAGES_CHANNEL_ID };
                }
                return res;
            };
            unpatchChannelStoreGetMutableDMsByUserIds = () => { channelStoreAny.getMutableDMsByUserIds = origGetMutableDMs; };
        }

        // Patch PermissionStore.can to always allow sending, managing, and deleting messages
        try {
            const PermissionStore = findStore("PermissionStore") as any;
            if (PermissionStore && typeof PermissionStore.can === "function") {
                const origCan = PermissionStore.can;
                PermissionStore.can = function(permission: any, channel: any, ...args: any[]) {
                    const id = typeof channel === "string" ? channel : channel?.id;
                    if (id === SAVED_MESSAGES_CHANNEL_ID) return true;
                    return origCan.apply(this, [permission, channel, ...args]);
                };
                unpatchPermissionStore = () => { PermissionStore.can = origCan; };
            }
        } catch { }

        // Patch RelationshipStore to never block SAVED_MESSAGES_USER_ID
        try {
            const RelationshipStore = findStore("RelationshipStore") as any;
            if (RelationshipStore) {
                const origIsBlocked = RelationshipStore.isBlocked;
                if (typeof origIsBlocked === "function") {
                    RelationshipStore.isBlocked = function(userId: string) {
                        if (userId === SAVED_MESSAGES_USER_ID) return false;
                        return origIsBlocked.apply(this, arguments as any);
                    };
                    unpatchRelationshipStore = () => { RelationshipStore.isBlocked = origIsBlocked; };
                }
            }
        } catch { }

        // Patch MessageActions.deleteMessage and fetchMessages
        try {
            const MessageActions = (findByProps("fetchMessages", "deleteMessage") || findByProps("deleteMessage")) as any;
            if (MessageActions) {
                if (MessageActions.fetchMessages) {
                    const origFetchMessages = MessageActions.fetchMessages;
                    MessageActions.fetchMessages = function(opts: any) {
                        if (opts?.channelId === SAVED_MESSAGES_CHANNEL_ID) {
                            checkVaultStatus().then(() => {
                                if (isVaultUnlocked()) {
                                    injectDecryptedMessages();
                                } else {
                                    resolveEmptyMessages();
                                    setTimeout(() => {
                                        openSavedMessagesUnlockModal(() => injectDecryptedMessages());
                                    }, 50);
                                }
                            });
                            return Promise.resolve();
                        }
                        return origFetchMessages.apply(this, arguments as any);
                    };
                    unpatchFetchMessages = () => { MessageActions.fetchMessages = origFetchMessages; };
                }

                if (MessageActions.deleteMessage) {
                    const origDeleteMessage = MessageActions.deleteMessage;
                    MessageActions.deleteMessage = function(channelId: string, messageId: string, ...args: any[]) {
                        if (channelId === SAVED_MESSAGES_CHANNEL_ID) {
                            deleteSavedMessage(messageId);
                            return Promise.resolve();
                        }
                        return origDeleteMessage.apply(this, [channelId, messageId, ...args]);
                    };
                    unpatchDeleteMessage = () => { MessageActions.deleteMessage = origDeleteMessage; };
                }
            }
        } catch { }

        // Patch ChannelActionCreators (closePrivateChannel, openPrivateChannel, etc.)
        try {
            const actionMods = [ChannelActionCreators, findByProps("closePrivateChannel"), findByProps("openPrivateChannel")].filter(Boolean);
            actionMods.forEach((mod: any) => {
                const closeMethods = ["closePrivateChannel", "closeChannel", "deletePrivateChannel", "closeDM"];
                closeMethods.forEach(methodName => {
                    if (typeof mod[methodName] === "function" && !mod[methodName].__savedMessagesPatched) {
                        const orig = mod[methodName];
                        mod[methodName] = function(...args: any[]) {
                            const arg = args[0];
                            const targetId = typeof arg === "string" ? arg : (arg?.channelId || arg?.id || arg?.channel_id || arg?.userId || arg?.recipientId);
                            if (targetId === SAVED_MESSAGES_CHANNEL_ID || targetId === SAVED_MESSAGES_USER_ID) {
                                setDmClosedSafe(true);
                                try {
                                    FluxDispatcher.dispatch({
                                        type: "CHANNEL_CLOSE",
                                        channelId: SAVED_MESSAGES_CHANNEL_ID,
                                    });
                                } catch { }
                                try {
                                    FluxDispatcher.dispatch({
                                        type: "CHANNEL_DELETE",
                                        channelId: SAVED_MESSAGES_CHANNEL_ID,
                                        channel: { id: SAVED_MESSAGES_CHANNEL_ID, type: 1 },
                                    });
                                } catch { }
                                if (SelectedChannelStore.getChannelId() === SAVED_MESSAGES_CHANNEL_ID) {
                                    try {
                                        FluxDispatcher.dispatch({
                                            type: "CHANNEL_SELECT",
                                            channelId: null,
                                            guildId: null,
                                        });
                                    } catch { }
                                }
                                try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch { }
                                try { (findStore("ChannelStore") as any)?.emitChange(); } catch { }
                                return;
                            }
                            return orig.apply(this, args);
                        };
                        mod[methodName].__savedMessagesPatched = true;
                    }
                });

                if (typeof mod.openPrivateChannel === "function" && !mod.openPrivateChannel.__savedMessagesPatched) {
                    const origOpen = mod.openPrivateChannel;
                    mod.openPrivateChannel = function(...args: any[]) {
                        const arg = args[0];
                        const targetId = typeof arg === "string" ? arg : (arg?.recipientId || arg?.userId || arg?.id || arg?.channelId);
                        if (targetId === SAVED_MESSAGES_USER_ID || targetId === SAVED_MESSAGES_CHANNEL_ID) {
                            setDmClosedSafe(false);
                            reinjectSavedMessages();
                        }
                        return origOpen.apply(this, args);
                    };
                    mod.openPrivateChannel.__savedMessagesPatched = true;
                }
            });
        } catch { }

        // Patch PrivateChannelSortStore to pin Saved Messages at the top
        const patchSortStore = (SortStore: any) => {
            if (!SortStore || (SortStore as any).__savedMessagesPatched) return;
            (SortStore as any).__savedMessagesPatched = true;

            const sortUnpatches: (() => void)[] = [];
            const patchSortFn = (fnName: string) => {
                if (typeof SortStore[fnName] === "function") {
                    const orig = SortStore[fnName];
                    const isObjectArray = fnName === "getSortedPrivateChannels";
                    const entryToInsert = isObjectArray ? SAVED_MESSAGES_CHANNEL : SAVED_MESSAGES_CHANNEL_ID;

                    SortStore[fnName] = function(...args: any[]) {
                        const list: any = orig.apply(this, args);
                        if (!list || !Array.isArray(list)) return list;

                        const filtered = list.filter((item: any) => {
                            const id = typeof item === "string" ? item : (item?.id || item?.channelId);
                            return id !== SAVED_MESSAGES_CHANNEL_ID;
                        });

                        if (!isDmClosedSafe()) {
                            filtered.unshift(entryToInsert);
                        }
                        return filtered;
                    };
                    sortUnpatches.push(() => {
                        SortStore[fnName] = orig;
                        delete (SortStore as any).__savedMessagesPatched;
                    });
                }
            };

            ["getPrivateChannelIds", "getSortedPrivateChannels", "getSortedPrivateChannelIds"].forEach(patchSortFn);
            unpatchPrivateChannelSortStore = () => { sortUnpatches.forEach(fn => fn()); };
        };

        const existingSortStore = (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
        if (existingSortStore) patchSortStore(existingSortStore);
        waitFor(["getPrivateChannelIds"], (store: any) => patchSortStore(store));

        // Intercept HTTP calls for SavedMessages channel/user
        try {
            const HTTP = (findByProps("get", "post", "put", "del") || findByProps("get", "post")) as any;
            if (HTTP) {
                if (HTTP.get) {
                    const origGet = HTTP.get;
                    HTTP.get = function(opts: any) {
                        const url = typeof opts === "string" ? opts : opts?.url;
                        if (url && (url.includes(SAVED_MESSAGES_CHANNEL_ID) || url.includes(SAVED_MESSAGES_USER_ID))) {
                            if (url.includes("messages")) {
                                const msgs = isVaultUnlocked() ? getDecryptedMessages().map(convertSavedMessageToDiscordMessage) : [];
                                return Promise.resolve({
                                    ok: true,
                                    status: 200,
                                    body: msgs,
                                    text: JSON.stringify(msgs),
                                    headers: {},
                                });
                            }
                            return Promise.resolve({
                                ok: true,
                                status: 200,
                                body: [],
                                text: "[]",
                                headers: {},
                            });
                        }
                        return origGet.apply(this, arguments as any);
                    };
                    unpatchHTTPGet = () => { HTTP.get = origGet; };
                }

                if (HTTP.post) {
                    const origPost = HTTP.post;
                    HTTP.post = function(opts: any) {
                        const url = typeof opts === "string" ? opts : opts?.url;
                        if (url && (url.includes(SAVED_MESSAGES_CHANNEL_ID) || url.includes(SAVED_MESSAGES_USER_ID))) {
                            return Promise.resolve({
                                ok: true,
                                status: 200,
                                body: {
                                    id: SAVED_MESSAGES_CHANNEL_ID,
                                    type: 1,
                                    last_message_id: null,
                                    recipients: [SAVED_MESSAGES_USER],
                                },
                                text: "{}",
                                headers: {},
                            });
                        }
                        return origPost.apply(this, arguments as any);
                    };
                    unpatchHTTPPost = () => { HTTP.post = origPost; };
                }

                const httpAny = HTTP as any;
                const delMethods = ["del", "delete"];
                delMethods.forEach(methodName => {
                    if (typeof httpAny[methodName] === "function") {
                        const origDel = httpAny[methodName];
                        httpAny[methodName] = function(opts: any) {
                            const url = typeof opts === "string" ? opts : opts?.url;
                            if (url && (url.includes(SAVED_MESSAGES_CHANNEL_ID) || url.includes(SAVED_MESSAGES_USER_ID))) {
                                const match = url.match(/messages\/(\d+)/);
                                if (match?.[1]) {
                                    deleteSavedMessage(match[1]);
                                }
                                return Promise.resolve({
                                    ok: true,
                                    status: 200,
                                    body: {},
                                    text: "{}",
                                    headers: {},
                                });
                            }
                            return origDel.apply(this, arguments as any);
                        };
                    }
                });
            }
        } catch { }

        if (!isDmClosedSafe()) {
            reinjectSavedMessages();
            setTimeout(reinjectSavedMessages, 100);
            setTimeout(reinjectSavedMessages, 500);
            setTimeout(reinjectSavedMessages, 1500);
        }

        if (SelectedChannelStore.getChannelId() === SAVED_MESSAGES_CHANNEL_ID) {
            setTimeout(() => {
                handleChannelSelect({ channelId: SAVED_MESSAGES_CHANNEL_ID });
            }, 200);
        }
    },

    stop() {
        lockVault();

        if (unpatchUserStore) unpatchUserStore();
        if (unpatchUserStoreGetUsers) unpatchUserStoreGetUsers();
        if (unpatchChannelStore) unpatchChannelStore();
        if (unpatchChannelStoreGetBasic) unpatchChannelStoreGetBasic();
        if (unpatchChannelStoreHasChannel) unpatchChannelStoreHasChannel();
        if (unpatchChannelStoreGetPrivate) unpatchChannelStoreGetPrivate();
        if (unpatchChannelStoreGetMutablePrivate) unpatchChannelStoreGetMutablePrivate();
        if (unpatchChannelStoreGetSortedPrivate) unpatchChannelStoreGetSortedPrivate();
        if (unpatchChannelStoreGetDMFromUserId) unpatchChannelStoreGetDMFromUserId();
        if (unpatchChannelStoreGetDMChannelFromUserId) unpatchChannelStoreGetDMChannelFromUserId();
        if (unpatchChannelStoreGetDMUserIds) unpatchChannelStoreGetDMUserIds();
        if (unpatchChannelStoreGetMutableDMsByUserIds) unpatchChannelStoreGetMutableDMsByUserIds();
        if (unpatchPrivateChannelSortStore) unpatchPrivateChannelSortStore();
        if (unpatchFetchMessages) unpatchFetchMessages();
        if (unpatchDeleteMessage) unpatchDeleteMessage();
        if (unpatchHTTPGet) unpatchHTTPGet();
        if (unpatchHTTPPost) unpatchHTTPPost();
        if (unpatchPermissionStore) unpatchPermissionStore();
        if (unpatchRelationshipStore) unpatchRelationshipStore();

        unpatchAvatarFns.forEach(fn => { try { fn(); } catch { } });
        unpatchAvatarFns = [];
    }
});
