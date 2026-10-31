/*
 * Plumecord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { playAudio } from "@api/AudioPlayer";

import { proxyLazy } from "@utils/lazy";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { StartAt, OptionType } from "@utils/types";
import { closeModal, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { findAll, filters, findByCodeLazy, findByProps, findByPropsLazy, findComponentByCodeLazy, findStore, waitFor } from "@webpack";
import { ChannelActionCreators, ChannelStore, DisplayProfileUtils, FluxDispatcher, i18n, IconUtils, NavigationRouter, React, SelectedChannelStore, SnowflakeUtils, UsernameUtils, UserProfileActions, UserStore } from "@webpack/common";
import ErrorBoundary from "@components/ErrorBoundary";
import { BaseText } from "@components/BaseText";
import { t } from "../autoTranslateNightcord";
import { PLUMECORD_AVATAR_BASE64 } from "./avatarData";
import { Button } from "@components/Button";
import { fetchReleases, releaseInfo } from "./releases";
import { localStorage as savedLocalStorage } from "@utils/localStorage";

export const PLUMECORD_USER_ID = "999999999999999988";
export const PLUMECORD_CHANNEL_ID = "999999999999999980";
export const PLUMECORD_CREATED_AT = new Date("2024-01-01T00:00:00Z");

function formatDate(date: Date): string {
    try {
        return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

const LS_LAST_SEEN = "plumecord_official_dm_last_seen";
const LS_LAST_TS = "plumecord_official_dm_last_ts";
const LS_LAST_ACK = "plumecord_official_dm_last_ack";

export const settings = definePluginSettings({
    isDmClosed: {
        type: OptionType.BOOLEAN,
        description: "Whether the official DM is closed",
        default: false,
        hidden: true,
    }
});

// Discord retire `window.localStorage` de la page : on passe par la copie que
// le mod garde au démarrage, sinon rien n'est retenu d'un lancement à l'autre.
function getItemSafe(key: string): string | null {
    try {
        return savedLocalStorage?.getItem(key) ?? null;
    } catch {}
    return null;
}

function setItemSafe(key: string, val: string): void {
    try {
        savedLocalStorage?.setItem(key, val);
    } catch {}
}

let lastSeenPostId = getItemSafe(LS_LAST_SEEN) || "";
let lastPostTimestamp = Number(getItemSafe(LS_LAST_TS) || 0);
let lastAckTimestamp = Number(getItemSafe(LS_LAST_ACK) || 0);
// Les messages étaient numérotés par l'identifiant GitHub de la release ; ils le
// sont maintenant par leur date (releases.ts). La date du dernier message vu
// est justement son nouveau numéro : personne ne reçoit de fausse alerte.
if (lastSeenPostId && Number(lastSeenPostId) < 1e11 && lastPostTimestamp > 0) {
    lastSeenPostId = String(lastPostTimestamp);
    setItemSafe(LS_LAST_SEEN, lastSeenPostId);
}
if (!lastAckTimestamp && lastPostTimestamp > 0) {
    lastAckTimestamp = lastPostTimestamp;
    setItemSafe(LS_LAST_ACK, String(lastAckTimestamp));
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let unreadCount = 0;
let domObserver: MutationObserver | null = null;
let isAppLoaded = false;

function emitAllNotificationStores(): void {
    try { (findStore("ReadStateStore") as any)?.emitChange(); } catch {}
    try { (findStore("GuildReadStateStore") as any)?.emitChange(); } catch {}
    try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch {}
    try { (findStore("ChannelStore") as any)?.emitChange(); } catch {}
    setTimeout(() => {
        scanAndFixPlumecordDmElements();
    }, 50);
}

function triggerPlumecordNotification(post: any): void {
    playNotificationSoundSafe();

    try {
        openUrgentMessageModal();
    } catch {}

    try {
        const bodyText = htmlToMarkdown(post?.content || "").slice(0, 120) || t("There's an official message from the Plumecord team that needs your attention.").replace(/\bPlumecord\b/g, "Plume");
        // Dans Plume : vraie notification Windows, par Plume lui-même. Celles
        // du moteur web (Notification, et donc celles du mod) n'y apparaissent pas.
        const plume = (window as any).__TAURI_INTERNALS__?.invoke;
        const Notifications = (window as any).Vencord?.Api?.Notifications;
        if (typeof plume === "function") {
            plume("notify", { title: "Plume t'a envoyé un message", body: bodyText }).catch(() => { });
        }
        // Carte dans Discord (en bas à droite), même si la bulle Windows est
        // masquée par Windows (mode Ne pas déranger, notifications coupées…).
        if (Notifications?.showNotification) {
            Notifications.showNotification({
                title: "Plume t'a envoyé un message",
                body: bodyText,
                icon: plumecordAvatarUrl,
                type: "info",
                // Reste affichée jusqu'à ce qu'on la ferme : si le message
                // arrive pendant que Plume est derrière un jeu, on la voit en
                // revenant au lieu qu'elle ait disparu entre-temps.
                permanent: true,
                inApp: true,
                // Le journal des notifications ne sait pas garder un bouton.
                noPersist: true,
                actions: [{
                    label: "Voir le message",
                    onClick: () => {
                        try { NavigationRouter.transitionTo(`/channels/@me/${PLUMECORD_CHANNEL_ID}`); } catch {}
                    }
                }]
            });
        } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const notif = new Notification("Plume", {
                body: bodyText,
                icon: plumecordAvatarUrl
            });
            notif.onclick = () => {
                try {
                    window.focus();
                    NavigationRouter.transitionTo(`/channels/@me/${PLUMECORD_CHANNEL_ID}`);
                } catch {}
            };
        }
    } catch {}
}

function playNotificationSoundSafe(): void {
    try {
        const soundModule = findByProps("playSound", "createSound") as any;
        if (typeof soundModule?.playSound === "function") {
            soundModule.playSound("message1");
            return;
        }
    } catch {}
    try {
        playAudio("message1");
    } catch {}
}

const plumecordAvatarUrl = PLUMECORD_AVATAR_BASE64;

const createChannelRecordFromServer = findByCodeLazy(".GUILD_TEXT]", "fromServer)");
const createMessageRecord = findByCodeLazy(".createFromServer(", ".isBlockedForMessage", "messageReference:");

function replaceDiscordWithPlumecord(text: string): string {
    if (!text || typeof text !== "string") return text;
    return text
        .replace(/Official Discord Message/gi, "Official Plume Message")
        .replace(/Message officiel de Discord/gi, "Message officiel de Plume")
        .replace(/Message de discorde officiel/gi, "Message officiel de Plume")
        .replace(/Team Discord/gi, "Team Plume")
        .replace(/l'équipe Discord/gi, "l'équipe Plume")
        .replace(/official Discord notifications/gi, "official Plume notifications")
        .replace(/notifications officielles de Discord/gi, "notifications officielles de Plume")
        .replace(/Discord ne vous demandera/gi, "Plume ne vous demandera")
        .replace(/Discord ne te demandera/gi, "Plume ne te demandera")
        .replace(/Discord will never ask/gi, "Plume will never ask")
        .replace(/Official Discord/gi, "Official Plume")
        .replace(/Discord Official/gi, "Plume Official");
}

function isPlumecordContext(node: Node): boolean {
    try {
        if (SelectedChannelStore?.getChannelId?.() === PLUMECORD_CHANNEL_ID) return true;

        let curr: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;

        if (curr?.closest) {
            const tooltip = curr.closest("[class*='tooltip'], [role='tooltip']");
            if (tooltip && /Discord/i.test(tooltip.textContent || "") && /Official|Message|Officiel|System/i.test(tooltip.textContent || "")) {
                return true;
            }
        }

        while (curr) {
            if (curr.getAttribute) {
                const href = curr.getAttribute("href");
                if (href && (href.includes(PLUMECORD_CHANNEL_ID) || href.includes(PLUMECORD_USER_ID))) return true;
                const ariaLabel = curr.getAttribute("aria-label");
                if (ariaLabel && ariaLabel.toLowerCase().includes("plume")) return true;
                const dataId = curr.getAttribute("data-list-item-id") || curr.getAttribute("data-channel-id");
                if (dataId && (dataId.includes(PLUMECORD_CHANNEL_ID) || dataId.includes(PLUMECORD_USER_ID))) return true;
            }

            if (curr.querySelector) {
                const hasPlumecord = curr.querySelector(`[href*="${PLUMECORD_CHANNEL_ID}"], [href*="${PLUMECORD_USER_ID}"], [data-list-item-id*="${PLUMECORD_CHANNEL_ID}"]`);
                if (hasPlumecord) return true;
            }

            if (curr.textContent && curr.textContent.includes("Plume") && (curr.classList?.contains?.("channel") || curr.getAttribute?.("role") === "listitem" || curr.classList?.contains?.("interactive") || curr.classList?.contains?.("layout"))) {
                return true;
            }

            curr = curr.parentElement;
        }
    } catch {}
    return false;
}

let isUpdatingDom = false;
let hoveredIsPlumecord = false;

function scanAndFixPlumecordDmElements() {
    if (isUpdatingDom) return;
    isUpdatingDom = true;
    try {
        // 1. Target specifically the Plume DM list item
        const plumecordDmElements = document.querySelectorAll(
            `[href*="${PLUMECORD_CHANNEL_ID}"], [href*="${PLUMECORD_USER_ID}"], [data-list-item-id*="${PLUMECORD_CHANNEL_ID}"]`
        );

        for (const el of Array.from(plumecordDmElements)) {
            // Fix subtext inside this specific Plume DM element
            const subtexts = el.querySelectorAll('[class*="subtext"], [class*="activityText"]');
            for (const sub of Array.from(subtexts)) {
                if (sub.textContent && /Official Discord Message|Message officiel de Discord|Message de discorde officiel/i.test(sub.textContent)) {
                    sub.textContent = replaceDiscordWithPlumecord(sub.textContent);
                }
            }

            // Fix aria-labels
            const aria = el.getAttribute("aria-label");
            if (aria && /Discord/i.test(aria)) {
                el.setAttribute("aria-label", replaceDiscordWithPlumecord(aria));
            }

            // Track hover for tooltip
            if (!(el as any).__ncHoverBound) {
                (el as any).__ncHoverBound = true;
                el.addEventListener("mouseenter", () => { hoveredIsPlumecord = true; });
                el.addEventListener("mouseleave", () => { hoveredIsPlumecord = false; });
            }

            // 3. Ensure red ping badge is rendered inside the Plume DM list item when unreadCount > 0
            const existingCustomBadge = el.querySelector(".plumecord-dm-ping-badge") as HTMLElement | null;
            const hasNativeBadge = el.querySelector('[class*="numberBadge"], [class*="mentionsBadge"]');
            if (unreadCount > 0 && SelectedChannelStore?.getChannelId?.() !== PLUMECORD_CHANNEL_ID) {
                if (hasNativeBadge) {
                    if (existingCustomBadge) existingCustomBadge.remove();
                } else {
                    const layoutEl = el.querySelector('[class*="layout"], [class*="children"]') || el;
                    if (!existingCustomBadge) {
                        const badge = document.createElement("div");
                        badge.className = "plumecord-dm-ping-badge";
                        badge.textContent = String(unreadCount);
                        layoutEl.appendChild(badge);
                    } else if (existingCustomBadge.textContent !== String(unreadCount)) {
                        existingCustomBadge.textContent = String(unreadCount);
                    }
                }
            } else if (existingCustomBadge) {
                existingCustomBadge.remove();
            }
        }

        // 2. If tooltip is visible and hovered element is Plume, fix tooltip text
        if (hoveredIsPlumecord) {
            const tooltips = document.querySelectorAll('[role="tooltip"], [class*="tooltip"]');
            for (const tip of Array.from(tooltips)) {
                if (tip.textContent && /Official Discord Message|Message officiel de Discord|Message de discorde officiel/i.test(tip.textContent)) {
                    tip.textContent = replaceDiscordWithPlumecord(tip.textContent);
                }
            }
        }
    } catch {} finally {
        isUpdatingDom = false;
    }
}

let dmDebounceTimer: ReturnType<typeof setTimeout> | undefined;

function startDomObserver() {
    if (domObserver) return;
    scanAndFixPlumecordDmElements();
    domObserver = new MutationObserver(() => {
        if (dmDebounceTimer) return;
        dmDebounceTimer = setTimeout(() => {
            dmDebounceTimer = undefined;
            scanAndFixPlumecordDmElements();
        }, 300);
    });
    const target =
        document.querySelector<Element>("[class*=\"privateChannels\"]") ??
        document.querySelector<Element>("nav[aria-label]") ??
        document.querySelector<Element>("[class*=\"sidebar\"]") ??
        document.body;
    domObserver.observe(target, { childList: true, subtree: true });
}

function stopDomObserver() {
    if (domObserver) {
        domObserver.disconnect();
        domObserver = null;
    }
    if (dmDebounceTimer) {
        clearTimeout(dmDebounceTimer);
        dmDebounceTimer = undefined;
    }
}

function handleGlobalClick(e: MouseEvent) {
    if (SelectedChannelStore.getChannelId() !== PLUMECORD_CHANNEL_ID) return;
    const target = e.target as HTMLElement;
    if (!target) return;

    const btn = target.closest("button") || target.closest("a");
    if (btn) {
        const txt = btn.textContent?.trim().toLowerCase();
        if (txt === "learn more" || txt === "en savoir plus") {
            e.preventDefault();
            e.stopPropagation();
            window.open("https://github.com/dontleteuwatchyou/plumecord", "_blank");
        }
    }
}

const rawPlumecordUser = {
    id: PLUMECORD_USER_ID,
    username: "plume",
    discriminator: "0",
    globalName: "Plume",
    global_name: "Plume",
    avatar: "plumecord_avatar",
    avatarURL: plumecordAvatarUrl,
    accentColor: 5793266, // #5865F2 Blue
    accent_color: 5793266,
    bannerColor: "#5865f2",
    banner_color: "#5865f2",
    bot: true,
    system: true,
    publicFlags: 1, // 1 << 0 STAFF
    public_flags: 1,
    flags: 1,
    premiumType: 0,
    mfaEnabled: false,
    verified: true,
    email: null,
    phone: null,
    nsfwAllowed: true,
    createdAt: new Date("2009-11-07T12:00:00.000Z"),
    getCreatedAt: () => new Date("2009-11-07T12:00:00.000Z"),
    isSystemUser: () => true,
    isVerifiedBot: () => true,
    isOfficialSystem: () => true,
    isStaff: () => true,
    isStaffPersonal: () => true,
    isBot: () => true,
    isNonUserBot: () => true,
    isObfuscated: () => false,
    hasUniqueUsername: () => true,
    hasFlag: (flag: number) => (flag & 1) !== 0,
    hasPublicFlag: (flag: number) => (flag & 1) !== 0,
    getAvatarURL: () => plumecordAvatarUrl,
    getAvatarSource: () => ({ uri: plumecordAvatarUrl }),
    getAvatarDecorationURL: () => null,
    getBannerURL: () => null,
    toString: () => `<@${PLUMECORD_USER_ID}>`,
};

const rawPlumecordUserProxy = new Proxy(rawPlumecordUser, {
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

export const PLUMECORD_USER = proxyLazy(() => {
    try {
        const URec: any = UserStore.getCurrentUser()?.constructor;
        if (URec) {
            const u = new URec({
                id: PLUMECORD_USER_ID,
                username: "plume",
                discriminator: "0",
                globalName: "Plume",
                global_name: "Plume",
                avatar: "plumecord_avatar",
                accent_color: 5793266,
                accentColor: 5793266,
                banner_color: "#5865f2",
                bannerColor: "#5865f2",
                bot: true,
                system: true,
                public_flags: 1,
                flags: 1,
                verified: true,
            });
            u.isSystemUser = () => true;
            u.isVerifiedBot = () => true;
            u.isOfficialSystem = () => true;
            u.isStaff = () => true;
            u.isStaffPersonal = () => true;
            u.hasFlag = (flag: number) => (flag & 1) !== 0;
            u.hasPublicFlag = (flag: number) => (flag & 1) !== 0;
            u.getAvatarURL = () => plumecordAvatarUrl;
            u.getAvatarSource = () => ({ uri: plumecordAvatarUrl });
            u.createdAt = new Date("2009-11-07T12:00:00.000Z");
            u.getCreatedAt = () => new Date("2009-11-07T12:00:00.000Z");
            u.accentColor = 5793266;
            u.bannerColor = "#5865f2";
            return u;
        }
    } catch {}
    return rawPlumecordUserProxy;
});

const rawPlumecordChannel = {
    id: PLUMECORD_CHANNEL_ID,
    type: 1, // DM
    name: "Plume",
    guild_id: null,
    guildId: null,
    lastMessageId: lastSeenPostId || null,
    last_message_id: lastSeenPostId || null,
    lastPinTimestamp: lastPostTimestamp || null,
    getGuildId: () => null,
    getRecipientId: () => PLUMECORD_USER_ID,
    recipients: [PLUMECORD_USER_ID],
    rawRecipients: [PLUMECORD_USER],
    isSystem: () => true,
    isOfficialSystem: () => true,
    isSystemDM: () => true,
    isDM: () => true,
    isGroupDM: () => false,
    isMultiUserDM: () => false,
    isPrivate: () => true,
    isArchivedThread: () => false,
    isThread: () => false,
    isSpam: () => false,
    isMessageRequest: () => false,
    isSystemMessage: () => false,
    isNsfw: () => false,
    isNSFW: () => false,
    isObfuscated: () => false,
    isVS: () => false,
    isDirectory: () => false,
    isManaged: () => false,
    isOwner: () => false,
    isGuildVocal: () => false,
    isVoice: () => false,
    isCategory: () => false,
    isGuildStageVoice: () => false,
    isMediaChannel: () => false,
    isForumLikeChannel: () => false,
    isForumPost: () => false,
    isRoleSubscriptionTemplateSupported: () => false,
    isListenable: () => false,
    isVocal: () => false,
    flags: 0,
    hasFlag: () => false,
    hasPublicFlag: () => false,
    getApplicationId: () => null,
    isGuildVoice: () => false,
    isGuildText: () => false,
    isGuildAnnouncement: () => false,
    isModeratorReportChannel: () => false,
    computedPosition: 0,
    position: 0,
    permissionOverwrites: {},
};

const rawPlumecordChannelProxy = new Proxy(rawPlumecordChannel, {
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

export const PLUMECORD_CHANNEL = proxyLazy(() => {
    try {
        if (typeof createChannelRecordFromServer === "function") {
            const ch = createChannelRecordFromServer({
                id: PLUMECORD_CHANNEL_ID,
                type: 1, // DM
                name: "Plume",
                recipients: [PLUMECORD_USER],
                rawRecipients: [PLUMECORD_USER],
                is_spam: false,
                is_message_request: false,
            });
            if (ch) {
                ch.isSystem = () => true;
                ch.isOfficialSystem = () => true;
                ch.isSystemDM = () => true;
                ch.getRecipientId = () => PLUMECORD_USER_ID;
                ch.lastMessageId = lastSeenPostId || null;
                ch.last_message_id = lastSeenPostId || null;
                ch.lastPinTimestamp = lastPostTimestamp || null;
                return ch;
            }
        }
    } catch {}
    return rawPlumecordChannelProxy;
});

let unpatchUserStore: (() => void) | null = null;
let unpatchUserStoreGetUsers: (() => void) | null = null;
let unpatchChannelStore: (() => void) | null = null;
let unpatchChannelStoreGetPrivate: (() => void) | null = null;
let unpatchPrivateChannelSortStore: (() => void) | null = null;
let unpatchFetchMessages: (() => void) | null = null;
let unpatchHTTPGet: (() => void) | null = null;
let unpatchHTTPPost: (() => void) | null = null;
let unpatchOpenPrivateChannel: (() => void) | null = null;
let unpatchClosePrivateChannel: (() => void) | null = null;
let unpatchFluxDispatch: (() => void) | null = null;
let unpatchReadStateGetMention: (() => void) | null = null;
let unpatchReadStateGetUnread: (() => void) | null = null;
let unpatchReadStateHasUnread: (() => void) | null = null;
let unpatchIntlString: (() => void) | null = null;
let unpatchIntlFormat: (() => void) | null = null;
let unpatchUserProfileStore: (() => void) | null = null;
let unpatchSnowflakeUtils: (() => void) | null = null;
let unpatchDisplayProfile: (() => void) | null = null;
let unpatchGuildReadState: (() => void) | null = null;
let unpatchSectionStores: (() => void)[] = [];
let unpatchAvatarFns: (() => void)[] = [];

function htmlToMarkdown(html: string): string {
    if (!html) return "";
    let text = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p><p>/gi, "\n\n")
        .replace(/<p>/gi, "")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
        .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
        .replace(/<b>(.*?)<\/b>/gi, "**$1**")
        .replace(/<em>(.*?)<\/em>/gi, "*$1*")
        .replace(/<i>(.*?)<\/i>/gi, "*$1*")
        .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
        .replace(/<[^>]+>/g, "");

    text = text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    return text.trim();
}

const knownPostIds = new Set<string>();
let streamingSocket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Pas de connexion en direct : les releases sont relues régulièrement.
const STREAMING_URLS: string[] = [];

let streamUrlIdx = 0;

function convertPostToMessage(post: any): any {
    const postId = String(post.id);

    const embeds: any[] = [];
    if (Array.isArray(post.media_attachments)) {
        for (const att of post.media_attachments) {
            if (att.type === "image" || att.type === "gifv") {
                const w = att.meta?.original?.width || att.meta?.small?.width;
                const h = att.meta?.original?.height || att.meta?.small?.height;
                const imageObj: any = { url: att.url, proxy_url: att.url };
                if (w && h) {
                    imageObj.width = w;
                    imageObj.height = h;
                }
                embeds.push({
                    type: "image",
                    url: att.url,
                    image: imageObj
                });
            }
        }
    }

    const rawAuthor = {
        id: PLUMECORD_USER_ID,
        username: "plume",
        discriminator: "0",
        global_name: "Plume",
        avatar: "plumecord_avatar",
        bot: true,
        system: true,
        public_flags: 1,
        flags: 1,
    };

    const rawMsg = {
        id: postId,
        channel_id: PLUMECORD_CHANNEL_ID,
        author: rawAuthor,
        content: post.markdown ?? htmlToMarkdown(post.content),
        timestamp: new Date(post.created_at).toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds,
        pinned: false,
        type: 0,
        flags: 0,
    };

    let msgRecord = rawMsg;
    try {
        if (typeof createMessageRecord === "function") {
            msgRecord = createMessageRecord(rawMsg);
        }
    } catch {}

    return msgRecord;
}

function injectSinglePost(post: any, isInitialLoad = false) {
    if (!post || !post.id) return;
    const postId = String(post.id);
    if (knownPostIds.has(postId)) return;
    knownPostIds.add(postId);

    const postDate = new Date(post.created_at).getTime();
    const isNew = Boolean(lastSeenPostId) && (function() {
        try { return BigInt(postId) > BigInt(lastSeenPostId); } catch { return postId !== lastSeenPostId; }
    })();

    if (isNew && settings.store.isDmClosed) {
        settings.store.isDmClosed = false;
    }

    if (settings.store.isDmClosed) return;

    if (postDate > lastPostTimestamp) {
        lastPostTimestamp = postDate;
        setItemSafe(LS_LAST_TS, String(lastPostTimestamp));
    }

    if (!lastSeenPostId || isNew) {
        lastSeenPostId = postId;
        setItemSafe(LS_LAST_SEEN, lastSeenPostId);
    }

    try {
        (PLUMECORD_CHANNEL as any).lastMessageId = postId;
        (PLUMECORD_CHANNEL as any).last_message_id = postId;
        (PLUMECORD_CHANNEL as any).lastPinTimestamp = postDate;
    } catch {}

    const msgRecord = convertPostToMessage(post);

    // Make sure channel is created in store
    try {
        FluxDispatcher.dispatch({
            type: "CHANNEL_CREATE",
            channel: PLUMECORD_CHANNEL,
        });
    } catch {}

    // Instant zero-delay message creation in UI
    try {
        FluxDispatcher.dispatch({
            type: "MESSAGE_CREATE",
            channelId: PLUMECORD_CHANNEL_ID,
            message: msgRecord,
            optimistic: false,
            isPushNotification: true
        });
    } catch {}

    const isCurrentChannel = SelectedChannelStore.getChannelId() === PLUMECORD_CHANNEL_ID;
    if (!isCurrentChannel && !isInitialLoad) {
        unreadCount++;
        triggerPlumecordNotification(post);
    } else if (isCurrentChannel) {
        lastAckTimestamp = Math.max(Date.now(), postDate);
        setItemSafe(LS_LAST_ACK, String(lastAckTimestamp));
    }

    emitAllNotificationStores();
}

let wsRetryCount = 0;

function connectMastodonStreaming() {
    if (streamingSocket || !STREAMING_URLS.length) return;

    try {
        const url = STREAMING_URLS[streamUrlIdx % STREAMING_URLS.length];
        const ws = new WebSocket(url);
        streamingSocket = ws;

        ws.onopen = () => {
            wsRetryCount = 0;
            try {
                ws.send(JSON.stringify({ type: "subscribe", stream: "public:local" }));
                ws.send(JSON.stringify({ type: "subscribe", stream: "public" }));
            } catch {}
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.event === "update" && data.payload) {
                    const post = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
                    injectSinglePost(post);
                }
            } catch (err) {
                console.warn("[PlumecordOfficialDM] Error parsing streaming message:", err);
            }
        };

        ws.onerror = () => {
            streamUrlIdx++;
        };

        ws.onclose = () => {
            streamingSocket = null;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            wsRetryCount++;
            const delay = Math.min(30000 * Math.pow(1.5, Math.min(wsRetryCount, 4)), 120000);
            reconnectTimer = setTimeout(connectMastodonStreaming, delay);
        };
    } catch (e) {
        streamingSocket = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        wsRetryCount++;
        const delay = Math.min(30000 * Math.pow(1.5, Math.min(wsRetryCount, 4)), 120000);
        reconnectTimer = setTimeout(connectMastodonStreaming, delay);
    }
}

function disconnectMastodonStreaming() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (streamingSocket) {
        try { streamingSocket.close(); } catch {}
        streamingSocket = null;
    }
}

async function fetchMastodonFeed(): Promise<any[]> {
    return fetchReleases();
}

// ─── Urgent Message Modal (System Alert for Plume Messages) ──────────────

interface UrgentMessageModalProps extends ModalProps {
    onClose: () => void;
}

export function UrgentMessageModal({ onClose, transitionState }: UrgentMessageModalProps) {
    const handleConfirm = () => {
        onClose();
        try {
            NavigationRouter.transitionTo(`/channels/@me/${PLUMECORD_CHANNEL_ID}`);
        } catch {}
    };

    return (
        <ModalRoot transitionState={transitionState} size={ModalSize.DYNAMIC} className="plumecord-urgent-modal-root">
            <div data-mana-component="modal" className="plumecord-urgent-container container__8a031 size-md__8a031 padding-size-lg__8a031" style={{ opacity: 1, transform: "scale(1)" }}>
                <div className="plumecord-urgent-header-gradient container_a62383 blue_a62383 headerGradient__8a031" style={{ "--custom-gradient-offset-bottom": "0%" } as any}>
                    <header className="section__8a031 header__8a031 headerCentered__8a031">
                        <div data-align="stretch" data-justify="start" data-direction="vertical" data-wrap="false" data-full-width="true" className="stack_dbd263" style={{ gap: "var(--space-8)", padding: "var(--space-0)" }}>
                            <div className="plumecord-urgent-header-top headerLayout__8a031">
                                <div className="headerLeading__8a031 headerLeadingAbsolute__8a031"></div>
                                <div className="headerLeadingSpacer__8a031" style={{ height: 35, width: 45 }}></div>
                                <div className="plumecord-urgent-graphic-wrap headerMain__8a031">
                                    <div className="headerGraphic__8a031">
                                        <div className="headerGraphicContainer__8a031">
                                            <div className="container__8ef77 aspect-ratio-16/9__8ef77">
                                                <img className="plumecord-urgent-img image__8ef77" alt="" draggable={false} src="https://cdn.discordapp.com/assets/content/88cde2b0ab4c8015cee8fdb8732b85b01df4fc78a75b3aa5e621539ea94b1803.svg" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="headerTrailingSpacer__8a031" style={{ height: 35, width: 45 }}></div>
                                <div className="headerTrailing__8a031 headerTrailingAbsolute__8a031">
                                    <button data-mana-component="button" role="button" className="plumecord-urgent-close-btn button_a22cb0 md_a22cb0 color-mix_a22cb0" type="button" aria-label="Close" onClick={onClose}>
                                        <div className="buttonChildrenWrapper_a22cb0">
                                            <div className="buttonChildren_a22cb0">
                                                <svg className="icon_a22cb0" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
                                                    <path fill="currentColor" d="M19.3 20.7a1 1 0 0 0 1.4-1.4L13.42 12l7.3-7.3a1 1 0 0 0-1.42-1.4L12 10.58l-7.3-7.3a1 1 0 0 0-1.4 1.42L10.58 12l-7.3 7.3a1 1 0 1 0 1.42 1.4L12 13.42l7.3 7.3Z"></path>
                                                </svg>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                            <h1 className="plumecord-urgent-title heading-xl/semibold_cf4812 defaultColor__5345c headerTitle__8a031" id="heading-_r_53_" data-text-variant="heading-xl/semibold" style={{ color: "var(--text-strong, #ffffff)" }}>
                                {t("Urgent Message")}
                            </h1>
                            <div className="headerSubtitleWrapper__8a031">
                                <div className="plumecord-urgent-subtitle text-md/normal_cf4812 headerSubtitle__8a031" data-text-variant="text-md/normal" style={{ color: "var(--text-subtle, #dbdee1)" }}>
                                    {t("There's an official message from the Plumecord team that needs your attention.").replace(/\bPlumecord\b/g, "Plume")}
                                </div>
                            </div>
                        </div>
                    </header>
                </div>
                <footer className="plumecord-urgent-footer actionBar__8a031 section__8a031">
                    <div className="actionBarTrailing__8a031 actionBarTrailingFullWidth__8a031">
                        <div data-align="stretch" data-justify="start" data-direction="horizontal" data-wrap="true" data-full-width="true" className="stack_dbd263" style={{ gap: "var(--space-8)", padding: "var(--space-0)" }}>
                            <button
                                data-mana-component="button"
                                role="button"
                                className="plumecord-urgent-ok-btn button_a22cb0 md_a22cb0 primary_a22cb0 hasText_a22cb0 fullWidth_a22cb0"
                                type="button"
                                onClick={handleConfirm}
                            >
                                <div className="buttonChildrenWrapper_a22cb0">
                                    <div className="buttonChildren_a22cb0">
                                        <span className="lineClamp1__4bd52 text-md/medium_cf4812" data-text-variant="text-md/medium">
                                            {t("Okay")}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        </div>
                    </div>
                </footer>
            </div>
        </ModalRoot>
    );
}

let activeUrgentModalKey: string | null = null;
export function openUrgentMessageModal() {
    if (activeUrgentModalKey) return;
    activeUrgentModalKey = openModal(props => (
        <UrgentMessageModal
            {...props}
            onClose={() => {
                if (activeUrgentModalKey) {
                    closeModal(activeUrgentModalKey);
                    activeUrgentModalKey = null;
                }
            }}
        />
    ));
}

async function checkAndInjectPosts(isInitialLoad = false) {
    try {
        const posts = await fetchMastodonFeed();
        if (!Array.isArray(posts) || posts.length === 0) {
            // GitHub injoignable et rien en cache : la conversation finit quand
            // même de charger (vide) au lieu de tourner sans fin.
            try {
                FluxDispatcher.dispatch({ type: "LOAD_MESSAGES_SUCCESS", channelId: PLUMECORD_CHANNEL_ID, messages: [], isBefore: false, isAfter: false, hasMoreBefore: false, hasMoreAfter: false, limit: 50 });
            } catch {}
            return;
        }

        const previousLastTs = Number(getItemSafe(LS_LAST_TS) || 0);
        const previousLastSeenId = getItemSafe(LS_LAST_SEEN);

        // Keep posts ordered NEWEST FIRST (descending timestamp order) for LOAD_MESSAGES_SUCCESS
        const sortedPosts = [...posts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const messageRecords: any[] = [];
        const newPostsToNotify: any[] = [];
        let hasNewWhileOffline = false;

        if (sortedPosts.length > 0) {
            const newestDate = new Date(sortedPosts[0].created_at).getTime();
            const newestId = String(sortedPosts[0].id);

            const isNewerThanSaved = (previousLastTs > 0 && newestDate > previousLastTs) ||
                Boolean(previousLastSeenId && (function() {
                    try { return BigInt(newestId) > BigInt(previousLastSeenId); } catch { return newestId !== previousLastSeenId; }
                })());

            // If a brand new post arrived, reopen DM if it had been closed
            if (isNewerThanSaved && settings.store.isDmClosed) {
                settings.store.isDmClosed = false;
            }

            if (settings.store.isDmClosed) return;

            setTimeout(() => {
                try {
                    FluxDispatcher.dispatch({
                        type: "CHANNEL_CREATE",
                        channel: PLUMECORD_CHANNEL,
                    });
                } catch {}
            }, 0);

            try {
                (PLUMECORD_CHANNEL as any).lastMessageId = newestId;
                (PLUMECORD_CHANNEL as any).last_message_id = newestId;
                (PLUMECORD_CHANNEL as any).lastPinTimestamp = newestDate;
            } catch {}

            if (!lastAckTimestamp) {
                lastAckTimestamp = previousLastTs > 0 ? previousLastTs : newestDate;
                setItemSafe(LS_LAST_ACK, String(lastAckTimestamp));
            }

            if (isInitialLoad && isNewerThanSaved) {
                hasNewWhileOffline = true;
            }

            if (newestDate > lastPostTimestamp) {
                lastPostTimestamp = newestDate;
                setItemSafe(LS_LAST_TS, String(lastPostTimestamp));
            }
        } else if (settings.store.isDmClosed) {
            return;
        }

        for (const post of sortedPosts) {
            const postId = String(post.id);
            const isKnown = knownPostIds.has(postId);
            const isNew = Boolean(lastSeenPostId) && (function() {
                try { return BigInt(postId) > BigInt(lastSeenPostId); } catch { return postId !== lastSeenPostId; }
            })();

            const postDate = new Date(post.created_at).getTime();
            const isUnread = lastAckTimestamp > 0 && postDate > lastAckTimestamp;

            if (!isKnown && isNew && !isInitialLoad) {
                newPostsToNotify.push(post);
            } else {
                if (isInitialLoad && (isUnread || (hasNewWhileOffline && isNew)) && !isKnown) {
                    if (SelectedChannelStore.getChannelId() !== PLUMECORD_CHANNEL_ID) {
                        unreadCount++;
                    }
                }
                knownPostIds.add(postId);
            }

            const msgRecord = convertPostToMessage(post);
            messageRecords.push(msgRecord);
        }

        // Au lancement, comme la notice de mise à jour de Nightcord : la carte
        // s'affiche tant qu'il reste un message pas encore LU (MP pas ouvert
        // depuis), même si un Plume ouvert plus tôt l'avait déjà reçu.
        const newestUnread = sortedPosts.length > 0 && new Date(sortedPosts[0].created_at).getTime() > lastAckTimestamp;
        if (isInitialLoad && (hasNewWhileOffline || newestUnread) && SelectedChannelStore.getChannelId() !== PLUMECORD_CHANNEL_ID) {
            if (unreadCount === 0) unreadCount = 1;
            setTimeout(() => {
                triggerPlumecordNotification(sortedPosts[0]);
            }, 1200);
        }

        if (sortedPosts.length > 0 && newPostsToNotify.length === 0) {
            const newestId = String(sortedPosts[0].id);
            if (!lastSeenPostId || (function() {
                try { return BigInt(newestId) > BigInt(lastSeenPostId); } catch { return newestId !== lastSeenPostId; }
            })()) {
                lastSeenPostId = newestId;
                setItemSafe(LS_LAST_SEEN, lastSeenPostId);
            }
        }

        setTimeout(() => {
            try {
                FluxDispatcher.dispatch({
                    type: "LOAD_MESSAGES_SUCCESS",
                    channelId: PLUMECORD_CHANNEL_ID,
                    messages: messageRecords,
                    isBefore: false,
                    isAfter: false,
                    hasMoreBefore: false,
                    hasMoreAfter: false,
                    limit: 50,
                });
            } catch {}

            // Inject newest posts chronologically (oldest to newest) so notifications fire cleanly
            for (const newPost of [...newPostsToNotify].reverse()) {
                injectSinglePost(newPost, false);
            }

            emitAllNotificationStores();
        }, 10);
    } catch (e) {
        console.warn("[PlumecordOfficialDM] Error checking posts:", e);
    }
}

function handleChannelClose(e: any) {
    const id = typeof e === "string" ? e : (e?.channelId || e?.channel_id || e?.channel?.id || e?.id || (typeof e?.channel === "string" ? e.channel : null));
    if (id === PLUMECORD_CHANNEL_ID || id === "999999999999999990") {
        settings.store.isDmClosed = true;
                unreadCount = 0;
        if (SelectedChannelStore.getChannelId() === PLUMECORD_CHANNEL_ID) {
            try {
                FluxDispatcher.dispatch({
                    type: "CHANNEL_SELECT",
                    channelId: null,
                    guildId: null,
                });
            } catch {}
        }
        try { (findStore("ReadStateStore") as any)?.emitChange(); } catch {}
        try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch {}
        try { (findStore("ChannelStore") as any)?.emitChange(); } catch {}
    }
}

function handleChannelSelect(e: any) {
    const id = typeof e === "string" ? e : (e?.channelId || e?.channel_id || e?.channel?.id || e?.id);
    if (id === PLUMECORD_CHANNEL_ID || id === "999999999999999990") {
        if (settings.store.isDmClosed) {
            // Reopen the DM — remove isAppLoaded guard so this works from search too
            settings.store.isDmClosed = false;
            setTimeout(() => {
                try {
                    FluxDispatcher.dispatch({
                        type: "CHANNEL_CREATE",
                        channel: PLUMECORD_CHANNEL,
                    });
                } catch {}
                try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch {}
                try { (findStore("ChannelStore") as any)?.emitChange(); } catch {}
            }, 0);
        }
        unreadCount = 0;
        lastAckTimestamp = Math.max(Date.now(), lastPostTimestamp);
        setItemSafe(LS_LAST_ACK, String(lastAckTimestamp));
        setTimeout(() => {
            emitAllNotificationStores();
        }, 0);
        checkAndInjectPosts(true);
    }
}

const Section = findComponentByCodeLazy("headingVariant:", '"section"', "headingIcon:");


const PlumecordProfileSections = ErrorBoundary.wrap(({ isSideBar }: { isSideBar: boolean }) => (
    <>
        <Section
            heading="Nom d'utilisateur"
            headingVariant={isSideBar ? "text-xs/semibold" : "text-xs/medium"}
            headingColor={isSideBar ? "text-strong" : "text-default"}
        >
            <BaseText size="sm" color="text-normal" style={{ userSelect: "text" }}>
                @plumecord
            </BaseText>
        </Section>
        <Section
            heading="Compte créé le"
            headingVariant={isSideBar ? "text-xs/semibold" : "text-xs/medium"}
            headingColor={isSideBar ? "text-strong" : "text-default"}
        >
            <BaseText size="sm" color="text-normal">
                {formatDate(PLUMECORD_CREATED_AT)}
            </BaseText>
        </Section>
    </>
), { noop: true });

export function PlumecordSystemBanner() {
    return (
        <div className="plumecord-official-banner">
            <div className="plumecord-official-banner-content">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#5865F2" fillRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-6h-2v6zm0-8h2V7h-2v2z" clipRule="evenodd" />
                </svg>
                <div>
                    <div className="plumecord-official-banner-title">
                        Ce salon est réservé aux notifications officielles de Plume.
                    </div>
                    <div className="plumecord-official-banner-sub">
                        Plume ne te demandera jamais ton mot de passe ou ton token de compte.
                    </div>
                </div>
            </div>
            <button
                className="plumecord-official-banner-btn"
                onClick={() => window.open("https://github.com/dontleteuwatchyou/plumecord", "_blank")}
            >
                En savoir plus
            </button>
        </div>
    );
}

function UpdateButtons({ id }: { id: string; }) {
    const info = releaseInfo.get(id);
    if (!info) return null;
    const openPanel = (window as any).__plumeOpenPanel as ((section?: string) => void) | undefined;
    return (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {info.product === "Plume" && openPanel && (
                <Button size="small" onClick={() => openPanel("update")}>Mettre à jour Plume</Button>
            )}
            {info.url && (
                <Button size="small" variant="secondary" onClick={() => window.open(info.url, "_blank")}>
                    {info.product === "Annonce" ? "Ouvrir le lien" : "Voir sur GitHub"}
                </Button>
            )}
        </div>
    );
}

export default definePlugin({
    name: "PlumecordOfficialDM",
    description: "MP officiel de Plume : prévient des nouvelles versions de Plume et de Plume (releases GitHub), avec un bouton vers la mise à jour.",
    enabledByDefault: true,
    required: true,
    startAt: StartAt.WebpackReady,
    authors: [{ name: "dontleteuwatchyou", id: 0n }],

    renderMessageAccessory({ message }) {
        if (message.channel_id !== PLUMECORD_CHANNEL_ID) return null;
        return <ErrorBoundary noop><UpdateButtons id={String(message.id)} /></ErrorBoundary>;
    },
    settings,

    flux: {
        CHANNEL_DELETE: handleChannelClose,
        CHANNEL_CLOSE: handleChannelClose,
        PRIVATE_CHANNEL_CLOSE: handleChannelClose,
        CHANNEL_SELECT: handleChannelSelect,
    },

    patches: [
        {
            find: '"sticker")',
            replacement: {
                match: /0===(\i)\.length(?=\)+\?null:\(0,\i\.jsxs?\)\("div")/,
                replace: "($self.isPlumecordChannel(arguments[0])?$self.renderBanner():$&)"
            }
        },
        // Inject username + creation date in DM sidebar profile panel
        {
            find: "#{intl::PROVISIONAL_ACCOUNT}),headingIcon:",
            replacement: {
                match: /(#{intl::USER_PROFILE_MEMBER_SINCE}\),.{0,100}userId:(\i\.id)}\)}\))/,
                replace: "$1,$self.renderPlumecordProfileSections({userId:$2,isSideBar:true})"
            }
        },
        // Inject in profile modal
        {
            find: ",applicationRoleConnection:",
            replacement: {
                match: /(#{intl::USER_PROFILE_MEMBER_SINCE}\),.{0,100}userId:(\i\.id),.{0,100}}\)}\)),/,
                replace: "$1,$self.renderPlumecordProfileSections({userId:$2,isSideBar:false}),"
            }
        },
        // Inject in profile modal v2
        {
            find: ".MODAL_V2,onClose:",
            replacement: {
                match: /(#{intl::USER_PROFILE_MEMBER_SINCE}\),.{0,100}userId:(\i\.id),.{0,100}}\)}\)),/,
                replace: "$1,$self.renderPlumecordProfileSections({userId:$2,isSideBar:false}),"
            }
        },
        // Direct React Component patch for DM list — filters out Plume DM when closed
        {
            find: '"dm-quick-launcher"===',
            replacement: {
                match: /privateChannelIds:([^,]+)(?=,listRef:)/,
                replace: "privateChannelIds:$self.filterPlumecordDm($1)"
            }
        }
    ],

    filterPlumecordDm(channelIds: any) {
        if (!Array.isArray(channelIds)) return channelIds;
        const closed = settings.store.isDmClosed;
        if (closed) {
            return channelIds.filter((id: string) => id !== PLUMECORD_CHANNEL_ID);
        }
        const filtered = channelIds.filter((id: string) => id !== PLUMECORD_CHANNEL_ID);
        const savedIndex = filtered.indexOf("999999999999999991");
        if (savedIndex === 0) {
            filtered.splice(1, 0, PLUMECORD_CHANNEL_ID);
            return filtered;
        }
        return [PLUMECORD_CHANNEL_ID, ...filtered];
    },

    renderPlumecordProfileSections({ userId, isSideBar }: { userId: string, isSideBar: boolean }) {
        if (userId !== PLUMECORD_USER_ID) return null;
        return <PlumecordProfileSections isSideBar={isSideBar} />;
    },

    isPlumecordChannel(props: any) {
        const id = props?.channel?.id || props?.id;
        if (id === PLUMECORD_CHANNEL_ID) return true;
        if (props?.channel?.name === "Plume" || props?.name === "Plume") return true;
        if (props?.channel?.recipients?.includes?.(PLUMECORD_USER_ID)) return true;
        if (SelectedChannelStore.getChannelId() === PLUMECORD_CHANNEL_ID) return true;
        return false;
    },

    getPlumecordSystemText() {
        return "Official Plume Message";
    },

    renderBanner() {
        return <PlumecordSystemBanner />;
    },

    start() {
        window.addEventListener("click", handleGlobalClick, true);

        // --- Core fix: intercept FluxDispatcher.dispatch ---
        // When settings.store.isDmClosed=true, we must NEVER let CHANNEL_CREATE for our fake channel
        // reach Discord's stores, otherwise Discord caches it in IndexedDB and shows
        // it again on next startup even before our other patches fire.
        try {
            const fd = FluxDispatcher as any;
            const origDispatch = fd.dispatch.bind(fd);
            fd.dispatch = function(action: any, ...args: any[]) {
                if (
                    action?.type === "CHANNEL_CREATE" &&
                    (action?.channel?.id === PLUMECORD_CHANNEL_ID || action?.channelId === PLUMECORD_CHANNEL_ID) &&
                    settings.store.isDmClosed
                ) {
                    return Promise.resolve();
                }
                return origDispatch(action, ...args);
            };
            unpatchFluxDispatch = () => { fd.dispatch = origDispatch; };
        } catch {}

        // If the DM was closed, purge any stale entry Discord may have cached
        // in its IndexedDB from a previous session where the DM was open.
        if (settings.store.isDmClosed) {
            setTimeout(() => {
                try {
                    FluxDispatcher.dispatch({
                        type: "CHANNEL_DELETE",
                        channelId: PLUMECORD_CHANNEL_ID,
                        channel: { id: PLUMECORD_CHANNEL_ID, type: 1 },
                    });
                } catch {}
                try { (findStore("ChannelStore") as any)?.emitChange(); } catch {}
                try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch {}
            }, 500);
        }


        // Defer all heavy store-patching (findByProps/findAll/prototype wrapping) to the
        // next macrotask so Discord's own startup rendering completes first. The FluxDispatcher
        // guard above stays synchronous because it must intercept CHANNEL_CREATE before
        // Discord's stores process it. Everything else is safe to defer by ~0 ms.
        setTimeout(() => {

        // Safely patch SnowflakeUtils as soon as loaded
        waitFor(["fromTimestamp", "extractTimestamp"], (m: any) => {
            if (m && typeof m.extractTimestamp === "function" && !unpatchSnowflakeUtils) {
                const origExtract = m.extractTimestamp;
                m.extractTimestamp = function(snowflake: string) {
                    if (snowflake === PLUMECORD_USER_ID || snowflake === "999999999999999999") {
                        return new Date("2009-11-07T12:00:00Z").getTime();
                    }
                    return origExtract.apply(this, arguments as any);
                };
                unpatchSnowflakeUtils = () => { m.extractTimestamp = origExtract; };
            }
        });

        // Safely patch UsernameUtils as soon as loaded
        waitFor(["useName", "getGlobalName"], (m: any) => {
            if (m && typeof m.formatForDisplay === "function") {
                const origFmt = m.formatForDisplay;
                m.formatForDisplay = function(user: any, ...args: any[]) {
                    const id = typeof user === "string" ? user : user?.id;
                    if (id === PLUMECORD_USER_ID || id === "999999999999999999") return "plumecord";
                    return origFmt.apply(this, arguments as any);
                };
            }
        });

        // Patch DisplayProfileUtils for blue profile theme
        try {
            if (DisplayProfileUtils?.getDisplayProfile) {
                const origGetDP = DisplayProfileUtils.getDisplayProfile;
                DisplayProfileUtils.getDisplayProfile = function(userId: string, ...args: any[]) {
                    if (userId === PLUMECORD_USER_ID || userId === "999999999999999999") {
                        const dp = origGetDP.apply(this, arguments as any) || {};
                        dp.accentColor = 5793266;
                        dp.banner = null;
                        dp.themeColors = [5793266, 5793266];
                        return dp;
                    }
                    return origGetDP.apply(this, arguments as any);
                };
                unpatchDisplayProfile = () => { DisplayProfileUtils.getDisplayProfile = origGetDP; };
            }
        } catch {}

        // Patch IconUtils and all Webpack modules that have getUserAvatarURL or getAvatarURL
        try {
            if (IconUtils) {
                if (typeof IconUtils.getUserAvatarURL === "function") {
                    const orig = IconUtils.getUserAvatarURL;
                    IconUtils.getUserAvatarURL = function(user: any, ...args: any[]) {
                        const id = typeof user === "string" ? user : (user?.id ?? user?.userId);
                        if (id === PLUMECORD_USER_ID || id === "999999999999999999") return plumecordAvatarUrl;
                        return orig.apply(this, arguments as any);
                    };
                    unpatchAvatarFns.push(() => { IconUtils.getUserAvatarURL = orig; });
                }
                if (typeof (IconUtils as any).getAvatarURL === "function") {
                    const origAv = (IconUtils as any).getAvatarURL;
                    (IconUtils as any).getAvatarURL = function(guildId: any, user: any, ...args: any[]) {
                        const id = typeof user === "string" ? user : (user?.id ?? user?.userId);
                        if (id === PLUMECORD_USER_ID || id === "999999999999999999") return plumecordAvatarUrl;
                        return origAv.apply(this, arguments as any);
                    };
                    unpatchAvatarFns.push(() => { (IconUtils as any).getAvatarURL = origAv; });
                }
                if (typeof (IconUtils as any).getDefaultAvatarURL === "function") {
                    const origDef = (IconUtils as any).getDefaultAvatarURL;
                    (IconUtils as any).getDefaultAvatarURL = function(user: any, ...args: any[]) {
                        const id = typeof user === "string" ? user : (user?.id ?? user?.userId);
                        if (id === PLUMECORD_USER_ID || id === "999999999999999999") return plumecordAvatarUrl;
                        return origDef.apply(this, arguments as any);
                    };
                    unpatchAvatarFns.push(() => { (IconUtils as any).getDefaultAvatarURL = origDef; });
                }
            }

            const modsWithAvatar = findAll(filters.byProps("getUserAvatarURL"));
            for (const mod of modsWithAvatar) {
                if (mod && typeof mod.getUserAvatarURL === "function") {
                    const origFn = mod.getUserAvatarURL;
                    mod.getUserAvatarURL = function(user: any, ...args: any[]) {
                        const id = typeof user === "string" ? user : (user?.id ?? user?.userId);
                        if (id === PLUMECORD_USER_ID || id === "999999999999999999") return plumecordAvatarUrl;
                        return origFn.apply(this, arguments as any);
                    };
                    unpatchAvatarFns.push(() => { mod.getUserAvatarURL = origFn; });
                }
            }

            const URec: any = UserStore.getCurrentUser()?.constructor;
            if (URec?.prototype) {
                if (typeof URec.prototype.getAvatarURL === "function") {
                    const origProto = URec.prototype.getAvatarURL;
                    URec.prototype.getAvatarURL = function(this: any, ...args: any[]) {
                        if (this?.id === PLUMECORD_USER_ID || this?.id === "999999999999999999") return plumecordAvatarUrl;
                        return origProto.apply(this, args as any);
                    };
                    unpatchAvatarFns.push(() => { URec.prototype.getAvatarURL = origProto; });
                }
                if (typeof URec.prototype.getAvatarSource === "function") {
                    const origProtoSrc = URec.prototype.getAvatarSource;
                    URec.prototype.getAvatarSource = function(this: any, ...args: any[]) {
                        if (this?.id === PLUMECORD_USER_ID || this?.id === "999999999999999999") return { uri: plumecordAvatarUrl };
                        return origProtoSrc.apply(this, args as any);
                    };
                    unpatchAvatarFns.push(() => { URec.prototype.getAvatarSource = origProtoSrc; });
                }
            }
        } catch {}

        // Patch UserProfileStore to return Staff badge, blue banner and Plume profile
        try {
            const UserProfileStore = (findStore("UserProfileStore") || findByProps("getUserProfile")) as any;
            if (UserProfileStore) {
                const origGetProfile = UserProfileStore.getUserProfile;
                UserProfileStore.getUserProfile = function(userId: string) {
                    if (userId === PLUMECORD_USER_ID || userId === "999999999999999999") {
                        const createdAt = new Date("2009-11-07T12:00:00.000Z");
                        return {
                            user: PLUMECORD_USER,
                            connectedAccounts: [],
                            connected_accounts: [],
                            premiumSince: null,
                            premiumType: null,
                            accentColor: 5793266,
                            accent_color: 5793266,
                            banner: null,
                            banner_color: "#5865f2",
                            themeColors: [5793266, 5793266],
                            theme_colors: [5793266, 5793266],
                            profileSince: createdAt,
                            memberSince: createdAt,
                            createdAt: createdAt,
                            badges: [
                                {
                                    id: "staff",
                                    description: "Discord Staff",
                                    icon: "5e74e9b61934fc1f67c65515d1f7e60d",
                                    link: "https://discord.com/company"
                                }
                            ],
                            bio: null,
                            userProfile: {
                                bio: null,
                                accentColor: 5793266,
                                banner: null,
                                themeColors: [5793266, 5793266],
                                profileSince: createdAt,
                                memberSince: createdAt,
                                createdAt: createdAt,
                            },
                            user_profile: {
                                bio: null,
                                accent_color: 5793266,
                                banner: null,
                                theme_colors: [5793266, 5793266],
                                profile_since: createdAt.toISOString(),
                                member_since: createdAt.toISOString(),
                                created_at: createdAt.toISOString(),
                            }
                        };
                    }
                    return origGetProfile.apply(this, arguments as any);
                };
                unpatchUserProfileStore = () => { UserProfileStore.getUserProfile = origGetProfile; };

                if (typeof UserProfileStore.isFetchingProfile === "function") {
                    const origFetch = UserProfileStore.isFetchingProfile;
                    UserProfileStore.isFetchingProfile = function(userId: string) {
                        if (userId === PLUMECORD_USER_ID) return false;
                        return origFetch.apply(this, arguments as any);
                    };
                }

                if (typeof UserProfileStore.getUserProfileFetchStatus === "function") {
                    const origStat = UserProfileStore.getUserProfileFetchStatus;
                    UserProfileStore.getUserProfileFetchStatus = function(userId: string) {
                        if (userId === PLUMECORD_USER_ID) return "SUCCESS";
                        return origStat.apply(this, arguments as any);
                    };
                }
            }
        } catch {}

        // Patch i18n intl methods for Plume official strings (only when in Plume context)
        try {
            if (i18n?.intl?.string) {
                const origString = i18n.intl.string;
                i18n.intl.string = function(descriptor: any) {
                    try {
                        const res = origString.apply(this, arguments as any);
                        if (typeof res === "string" && SelectedChannelStore?.getChannelId?.() === PLUMECORD_CHANNEL_ID) {
                            return replaceDiscordWithPlumecord(res);
                        }
                        return res;
                    } catch {
                        return origString.apply(this, arguments as any);
                    }
                };
                unpatchIntlString = () => { i18n.intl.string = origString; };
            }

            if (i18n?.intl?.format) {
                const origFormat = i18n.intl.format;
                i18n.intl.format = function(descriptor: any, values: any) {
                    try {
                        const res = origFormat.apply(this, arguments as any);
                        if (SelectedChannelStore?.getChannelId?.() === PLUMECORD_CHANNEL_ID) {
                            if (typeof res === "string") {
                                return replaceDiscordWithPlumecord(res);
                            }
                            if (Array.isArray(res)) {
                                return res.map(item => typeof item === "string" ? replaceDiscordWithPlumecord(item) : item);
                            }
                        }
                        return res;
                    } catch {
                        return origFormat.apply(this, arguments as any);
                    }
                };
                unpatchIntlFormat = () => { i18n.intl.format = origFormat; };
            }
        } catch {}

        startDomObserver();

        // Patch GuildReadStateStore for Home / App unread badges
        const patchGuildReadStateStore = (GuildStore: any) => {
            if (!GuildStore || (GuildStore as any).__plumecordPatched) return;
            (GuildStore as any).__plumecordPatched = true;
            const unpatches: (() => void)[] = [];

            if (typeof GuildStore.getTotalMentionCount === "function") {
                const orig = GuildStore.getTotalMentionCount;
                GuildStore.getTotalMentionCount = function(...args: any[]) {
                    return orig.apply(this, args) + unreadCount;
                };
                unpatches.push(() => { GuildStore.getTotalMentionCount = orig; });
            }

            if (typeof GuildStore.hasAnyUnread === "function") {
                const orig = GuildStore.hasAnyUnread;
                GuildStore.hasAnyUnread = function(...args: any[]) {
                    return orig.apply(this, args) || unreadCount > 0;
                };
                unpatches.push(() => { GuildStore.hasAnyUnread = orig; });
            }

            unpatchGuildReadState = () => {
                unpatches.forEach(fn => fn());
                delete (GuildStore as any).__plumecordPatched;
            };
        };

        const existingGuildRSStore = (findStore("GuildReadStateStore") || findByProps("getTotalMentionCount")) as any;
        if (existingGuildRSStore) {
            patchGuildReadStateStore(existingGuildRSStore);
        }
        waitFor(filters.byStoreName("GuildReadStateStore"), patchGuildReadStateStore);

        // Patch ReadStateStore comprehensively to show red ping badge for new unread Plume posts
        const patchReadStateStore = (RSStore: any) => {
            if (!RSStore || (RSStore as any).__plumecordPatched) return;
            (RSStore as any).__plumecordPatched = true;
            const unpatches: (() => void)[] = [];

            const patchMethod = (name: string, impl: (...args: any[]) => any) => {
                if (typeof RSStore[name] === "function") {
                    const orig = RSStore[name];
                    RSStore[name] = function(...args: any[]) {
                        return impl.call(this, orig, ...args);
                    };
                    unpatches.push(() => { RSStore[name] = orig; });
                }
            };

            patchMethod("getMentionCount", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return unreadCount;
                return orig.call(RSStore, channelId);
            });

            patchMethod("getUnreadCount", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return unreadCount;
                return orig.call(RSStore, channelId);
            });

            patchMethod("hasUnread", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return unreadCount > 0;
                return orig.call(RSStore, channelId);
            });

            patchMethod("hasUnreadOrMentions", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return unreadCount > 0;
                return orig.call(RSStore, channelId);
            });

            patchMethod("hasNotableUnread", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return unreadCount > 0;
                return orig.call(RSStore, channelId);
            });

            patchMethod("hasTrackedUnread", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return unreadCount > 0;
                return orig.call(RSStore, channelId);
            });

            patchMethod("getIsMentionLowImportance", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return false;
                return orig.call(RSStore, channelId);
            });

            patchMethod("lastMessageId", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return lastSeenPostId || (PLUMECORD_CHANNEL as any).lastMessageId || null;
                return orig.call(RSStore, channelId);
            });

            patchMethod("lastMessageTimestamp", (orig, channelId) => {
                if (channelId === PLUMECORD_CHANNEL_ID) return lastPostTimestamp || 0;
                return orig.call(RSStore, channelId);
            });

            patchMethod("getMentionChannelIds", (orig) => {
                const list = orig.call(RSStore) || [];
                if (unreadCount > 0 && !list.includes(PLUMECORD_CHANNEL_ID)) {
                    return [...list, PLUMECORD_CHANNEL_ID];
                }
                return list;
            });

            unpatchReadStateGetMention = () => {
                unpatches.forEach(fn => fn());
                delete (RSStore as any).__plumecordPatched;
            };
        };

        const existingRSStore = (findStore("ReadStateStore") || findByProps("getMentionCount", "hasUnread")) as any;
        if (existingRSStore) {
            patchReadStateStore(existingRSStore);
        }
        waitFor(filters.byStoreName("ReadStateStore"), patchReadStateStore);

        // Intercept MessageActions.fetchMessages to prevent 404 REST calls
        try {
            const MessageActions = findByProps("fetchMessages", "sendMessage") as any;
            if (MessageActions?.fetchMessages) {
                const origFetchMessages = MessageActions.fetchMessages;
                MessageActions.fetchMessages = function(opts: any) {
                    if (opts?.channelId === PLUMECORD_CHANNEL_ID) {
                        checkAndInjectPosts(true);
                        return Promise.resolve();
                    }
                    return origFetchMessages.apply(this, arguments as any);
                };
                unpatchFetchMessages = () => { MessageActions.fetchMessages = origFetchMessages; };
            }
        } catch {}

        // Intercept HTTP.get and HTTP.post REST calls to prevent 404 errors for fake channel/user ID
        try {
            const HTTP = (findByProps("get", "post", "put", "del") || findByProps("get", "post")) as any;
            const createFakeRestChain = (responseObj: any) => {
                const p = Promise.resolve(responseObj) as any;
                const chainMethods = ["query", "send", "set", "type", "accept", "timeout", "retry", "redirects", "on", "ok", "end"];
                for (const m of chainMethods) {
                    p[m] = function(arg?: any) {
                        if (m === "end" && typeof arg === "function") {
                            try { arg(null, responseObj); } catch {}
                        }
                        return p;
                    };
                }
                return p;
            };
            if (HTTP) {
                if (HTTP.get) {
                    const origGet = HTTP.get;
                    HTTP.get = function(opts: any) {
                        const url = typeof opts === "string" ? opts : opts?.url;
                        if (url && (url.includes(PLUMECORD_CHANNEL_ID) || url.includes(PLUMECORD_USER_ID) || url.includes("999999999999999999"))) {
                            if (url.includes("/profile")) {
                                return createFakeRestChain({
                                    ok: true,
                                    status: 200,
                                    body: {
                                        user: {
                                            id: PLUMECORD_USER_ID,
                                            username: "plume",
                                            global_name: "Plume",
                                            avatar: "plumecord_avatar",
                                            bot: true,
                                            system: true,
                                            public_flags: 1,
                                            flags: 1,
                                            accent_color: 5793266,
                                            banner_color: "#5865f2",
                                        },
                                        connected_accounts: [],
                                        premium_since: null,
                                        premium_type: null,
                                        accent_color: 5793266,
                                        banner_color: "#5865f2",
                                        theme_colors: [5793266, 5793266],
                                        badges: [
                                            {
                                                id: "staff",
                                                description: "Discord Staff",
                                                icon: "5e74e9b61934fc1f67c65515d1f7e60d",
                                                link: "https://discord.com/company"
                                            }
                                        ]
                                    },
                                    text: "{}",
                                    headers: {},
                                });
                            }
                            return createFakeRestChain({
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
                        if (url && (url.includes(PLUMECORD_CHANNEL_ID) || url.includes(PLUMECORD_USER_ID) || url.includes("999999999999999999"))) {
                            return createFakeRestChain({
                                ok: true,
                                status: 200,
                                body: {
                                    id: PLUMECORD_CHANNEL_ID,
                                    type: 1,
                                    last_message_id: null,
                                    recipients: [PLUMECORD_USER],
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
                if (httpAny.del || httpAny.delete) {
                    const fnName = httpAny.del ? "del" : "delete";
                    const origDel = httpAny[fnName];
                    httpAny[fnName] = function(opts: any) {
                        const url = typeof opts === "string" ? opts : opts?.url;
                        if (url && (url.includes(PLUMECORD_CHANNEL_ID) || url.includes(PLUMECORD_USER_ID) || url.includes("999999999999999999"))) {
                            return createFakeRestChain({
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
            }
        } catch {}

        // Patch UserStore.getUser
        const origGetUser = UserStore.getUser;
        UserStore.getUser = function(id: string) {
            if (id === PLUMECORD_USER_ID || id === "999999999999999999") return PLUMECORD_USER;
            return origGetUser.apply(this, arguments as any);
        };
        unpatchUserStore = () => { UserStore.getUser = origGetUser; };

        // Patch UserStore.getUsers if exists
        if ((UserStore as any).getUsers) {
            const origGetUsers = (UserStore as any).getUsers;
            (UserStore as any).getUsers = function() {
                const users = origGetUsers.apply(this, arguments as any) || {};
                if (!users[PLUMECORD_USER_ID]) {
                    return { ...users, [PLUMECORD_USER_ID]: PLUMECORD_USER };
                }
                return users;
            };
            unpatchUserStoreGetUsers = () => { (UserStore as any).getUsers = origGetUsers; };
        }

        // Patch ChannelActionCreators & ChannelActionsMod methods (closePrivateChannel, closeChannel, deletePrivateChannel, closeDM)
        try {
            const actionMods = [ChannelActionCreators, findByProps("closePrivateChannel"), findByProps("openPrivateChannel")].filter(Boolean);
            actionMods.forEach((mod: any) => {
                const closeMethods = ["closePrivateChannel", "closeChannel", "deletePrivateChannel", "closeDM"];
                closeMethods.forEach(methodName => {
                    if (typeof mod[methodName] === "function" && !mod[methodName].__plumecordPatched) {
                        const orig = mod[methodName];
                        mod[methodName] = function(...args: any[]) {
                            const arg = args[0];
                            const targetId = typeof arg === "string" ? arg : (arg?.channelId || arg?.id || arg?.channel_id || arg?.userId || arg?.recipientId);
                            if (targetId === PLUMECORD_CHANNEL_ID || targetId === "999999999999999990") {
                                settings.store.isDmClosed = true;
                                                                unreadCount = 0;
                                try {
                                    FluxDispatcher.dispatch({
                                        type: "CHANNEL_CLOSE",
                                        channelId: PLUMECORD_CHANNEL_ID,
                                    });
                                } catch {}
                                try {
                                    FluxDispatcher.dispatch({
                                        type: "CHANNEL_DELETE",
                                        channelId: PLUMECORD_CHANNEL_ID,
                                        channel: { id: PLUMECORD_CHANNEL_ID, type: 1 },
                                    });
                                } catch {}
                                if (SelectedChannelStore.getChannelId() === PLUMECORD_CHANNEL_ID) {
                                    try {
                                        FluxDispatcher.dispatch({
                                            type: "CHANNEL_SELECT",
                                            channelId: null,
                                            guildId: null,
                                        });
                                    } catch {}
                                }
                                try { (findStore("ReadStateStore") as any)?.emitChange(); } catch {}
                                try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch {}
                                try { (findStore("ChannelStore") as any)?.emitChange(); } catch {}
                                return;
                            }
                            return orig.apply(this, args);
                        };
                        mod[methodName].__plumecordPatched = true;
                    }
                });

                if (typeof mod.openPrivateChannel === "function" && !mod.openPrivateChannel.__plumecordPatched) {
                    const origOpen = mod.openPrivateChannel;
                    mod.openPrivateChannel = function(...args: any[]) {
                        const arg = args[0];
                        const targetId = typeof arg === "string" ? arg : (arg?.recipientId || arg?.userId || arg?.id || arg?.channelId);
                        if (targetId === PLUMECORD_USER_ID || targetId === "999999999999999999") {
                            settings.store.isDmClosed = false;
                                                        unreadCount = 0;
                            setTimeout(() => {
                                try {
                                    FluxDispatcher.dispatch({
                                        type: "CHANNEL_CREATE",
                                        channel: PLUMECORD_CHANNEL,
                                    });
                                } catch {}
                                try {
                                    FluxDispatcher.dispatch({
                                        type: "CHANNEL_SELECT",
                                        channelId: PLUMECORD_CHANNEL_ID,
                                        guildId: null,
                                    });
                                } catch {}
                                try { (findStore("ReadStateStore") as any)?.emitChange(); } catch {}
                                try { (findStore("PrivateChannelSortStore") as any)?.emitChange(); } catch {}
                                try { (findStore("ChannelStore") as any)?.emitChange(); } catch {}
                            }, 0);
                            return Promise.resolve(PLUMECORD_CHANNEL_ID);
                        }
                        return origOpen.apply(this, args);
                    };
                    mod.openPrivateChannel.__plumecordPatched = true;
                }
            });
        } catch {}

        // Patch ChannelStore.getChannel & getDMFromUserId
        const origGetChannel = ChannelStore.getChannel;
        ChannelStore.getChannel = function(id: string) {
            if (id === PLUMECORD_CHANNEL_ID) {
                // Always return the channel so navigation works (even when closed)
                // Visibility in the DM list sidebar is handled by filterPlumecordDm
                return PLUMECORD_CHANNEL;
            }
            return origGetChannel.apply(this, arguments as any);
        };
        unpatchChannelStore = () => { ChannelStore.getChannel = origGetChannel; };

        const channelStoreAny = ChannelStore as any;
        if (typeof channelStoreAny.getDMFromUserId === "function") {
            const origGetDM = channelStoreAny.getDMFromUserId;
            channelStoreAny.getDMFromUserId = function(userId: string) {
                if (userId === PLUMECORD_USER_ID || userId === "999999999999999999") {
                    // Always return channel ID so Discord can navigate to it
                    return PLUMECORD_CHANNEL_ID;
                }
                return origGetDM.apply(this, arguments as any);
            };
        }

        // Patch ChannelStore.getMutablePrivateChannels / getPrivateChannels if exists
        if (channelStoreAny.getMutablePrivateChannels) {
            const origGetMut = channelStoreAny.getMutablePrivateChannels;
            channelStoreAny.getMutablePrivateChannels = function() {
                const chs = origGetMut.apply(this, arguments as any) || {};
                const closed = settings.store.isDmClosed;
                if (!closed && !chs[PLUMECORD_CHANNEL_ID]) {
                    return { ...chs, [PLUMECORD_CHANNEL_ID]: PLUMECORD_CHANNEL };
                }
                if (closed && chs[PLUMECORD_CHANNEL_ID]) {
                    const copy = { ...chs };
                    delete copy[PLUMECORD_CHANNEL_ID];
                    return copy;
                }
                return chs;
            };
            unpatchChannelStoreGetPrivate = () => { channelStoreAny.getMutablePrivateChannels = origGetMut; };
        }

        if (channelStoreAny.getPrivateChannels) {
            const origGetPriv = channelStoreAny.getPrivateChannels;
            channelStoreAny.getPrivateChannels = function() {
                const chs = origGetPriv.apply(this, arguments as any) || {};
                const closed = settings.store.isDmClosed;
                if (!closed && !chs[PLUMECORD_CHANNEL_ID]) {
                    return { ...chs, [PLUMECORD_CHANNEL_ID]: PLUMECORD_CHANNEL };
                }
                if (closed && chs[PLUMECORD_CHANNEL_ID]) {
                    const copy = { ...chs };
                    delete copy[PLUMECORD_CHANNEL_ID];
                    return copy;
                }
                return chs;
            };
        }

        // Instantaneous patch for PrivateChannelSortStore (0ms overhead)
        const patchPrivateChannelSortStore = (SortStore: any) => {
            if (!SortStore || (SortStore as any).__plumecordPatched) return;
            (SortStore as any).__plumecordPatched = true;
            const sortUnpatches: (() => void)[] = [];
            const patchSortFn = (fnName: string) => {
                if (typeof SortStore[fnName] === "function") {
                    const orig = SortStore[fnName];
                    const isObjectArray = fnName === "getSortedPrivateChannels";
                    const entryToInsert = isObjectArray ? PLUMECORD_CHANNEL : PLUMECORD_CHANNEL_ID;

                    SortStore[fnName] = function(...args: any[]) {
                        const list: any = orig.apply(this, args);
                        if (!list || !Array.isArray(list) || settings.store.isDmClosed) return list;

                        const filtered = list.filter((item: any) => {
                            const id = typeof item === "string" ? item : (item?.id || item?.channelId);
                            return id !== PLUMECORD_CHANNEL_ID;
                        });

                        const savedIndex = filtered.findIndex((item: any) => {
                            const id = typeof item === "string" ? item : (item?.id || item?.channelId);
                            return id === "999999999999999991";
                        });

                        if (savedIndex === 0) {
                            filtered.splice(1, 0, entryToInsert);
                        } else {
                            filtered.unshift(entryToInsert);
                        }

                        return filtered;
                    };
                    sortUnpatches.push(() => {
                        SortStore[fnName] = orig;
                        delete (SortStore as any).__plumecordPatched;
                    });
                }
            };

            ["getPrivateChannelIds", "getSortedPrivateChannels", "getSortedPrivateChannelIds"].forEach(patchSortFn);
            unpatchPrivateChannelSortStore = () => { sortUnpatches.forEach(fn => fn()); };
        };

        const existingSortStore = (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
        if (existingSortStore) {
            patchPrivateChannelSortStore(existingSortStore);
        }
        waitFor(["getPrivateChannelIds"], (store: any) => {
            patchPrivateChannelSortStore(store);
        });

        FluxDispatcher.subscribe("CHANNEL_DELETE", handleChannelClose);
        FluxDispatcher.subscribe("CHANNEL_CLOSE", handleChannelClose);
        FluxDispatcher.subscribe("PRIVATE_CHANNEL_CLOSE", handleChannelClose);
        FluxDispatcher.subscribe("CHANNEL_SELECT", handleChannelSelect);

        setTimeout(() => {
            isAppLoaded = true;
            checkAndInjectPosts(true);
            pollInterval = setInterval(() => checkAndInjectPosts(false), 30000);
        }, 1000);
        }, 500); // end deferred startup — all store patches run after first paint + CONNECTION_OPEN
    },

    stop() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        disconnectMastodonStreaming();
        window.removeEventListener("click", handleGlobalClick, true);
        stopDomObserver();

        if (unpatchUserStore) unpatchUserStore();
        if (unpatchUserStoreGetUsers) unpatchUserStoreGetUsers();
        if (unpatchChannelStore) unpatchChannelStore();
        if (unpatchChannelStoreGetPrivate) unpatchChannelStoreGetPrivate();
        if (unpatchPrivateChannelSortStore) unpatchPrivateChannelSortStore();
        if (unpatchFetchMessages) unpatchFetchMessages();
        if (unpatchHTTPGet) unpatchHTTPGet();
        if (unpatchHTTPPost) unpatchHTTPPost();
        if (unpatchOpenPrivateChannel) unpatchOpenPrivateChannel();
        if (unpatchClosePrivateChannel) unpatchClosePrivateChannel();
        if (unpatchFluxDispatch) unpatchFluxDispatch();
        if (unpatchReadStateGetMention) unpatchReadStateGetMention();
        if (unpatchReadStateGetUnread) unpatchReadStateGetUnread();
        if (unpatchReadStateHasUnread) unpatchReadStateHasUnread();
        if (unpatchGuildReadState) unpatchGuildReadState();
        if (unpatchIntlString) unpatchIntlString();
        if (unpatchIntlFormat) unpatchIntlFormat();
        if (unpatchUserProfileStore) unpatchUserProfileStore();
        if (unpatchSnowflakeUtils) unpatchSnowflakeUtils();
        if (unpatchDisplayProfile) unpatchDisplayProfile();

        unpatchSectionStores.forEach(fn => { try { fn(); } catch {} });
        unpatchSectionStores = [];

        unpatchAvatarFns.forEach(fn => { try { fn(); } catch {} });
        unpatchAvatarFns = [];

        FluxDispatcher.unsubscribe("CHANNEL_DELETE", handleChannelClose);
        FluxDispatcher.unsubscribe("PRIVATE_CHANNEL_CLOSE", handleChannelClose);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", handleChannelSelect);

        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }
});
