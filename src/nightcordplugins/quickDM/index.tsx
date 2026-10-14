/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { openPrivateChannel } from "@utils/discord";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

import { t } from "../autoTranslateNightcord";

const KEYBOARD_SVG = `
<svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24">
    <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm4 2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H6Zm3 0a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H9Zm3 0a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1Zm3 0a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1ZM6 11a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H6Zm3 0a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H9Zm3 0a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1Zm3 0a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1ZM7 15a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H7Z" />
</svg>
`;

let observer: MutationObserver | null = null;

function extractUserIdFromFiber(el: Element | null): string | null {
    if (!el) return null;
    try {
        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
        if (!fiberKey) return null;
        let fiber = (el as any)[fiberKey];
        for (let i = 0; i < 45 && fiber; i++) {
            const props = fiber.memoizedProps || fiber.pendingProps;
            if (props) {
                if (props.user?.id) return String(props.user.id);
                if (props.displayProfile?.userId) return String(props.displayProfile.userId);
                if (props.profile?.userId) return String(props.profile.userId);
                if (props.userId) return String(props.userId);
                if (props.channel?.getRecipientId?.()) return String(props.channel.getRecipientId());
                if (props.channel?.recipients?.[0]) return String(props.channel.recipients[0]);
                if (props.author?.id) return String(props.author.id);
                if (props.member?.userId) return String(props.member.userId);
                if (props.member?.user?.id) return String(props.member.user.id);
            }
            fiber = fiber.return;
        }
    } catch {}
    return null;
}

function getPopoutUserId(popout: HTMLElement): string | null {
    const fiberId = extractUserIdFromFiber(popout);
    if (fiberId) return fiberId;

    const header = popout.querySelector<HTMLElement>("[class*='header_'], [class*='avatar_'], [class*='displayName_']");
    if (header) {
        const hid = extractUserIdFromFiber(header);
        if (hid) return hid;
    }

    const avatarImg = popout.querySelector<HTMLImageElement>("img[src*='/avatars/']");
    if (avatarImg) {
        const match = avatarImg.src.match(/\/avatars\/(\d+)\//);
        if (match) return match[1];
    }

    return null;
}

function injectQuickDMButton(popout: HTMLElement) {
    if (popout.querySelector(".nc-quick-dm-button-wrapper")) return;

    let wrapper = popout.querySelector<HTMLElement>("[class*='inner_'] > [class*='wrapper_']");
    if (!wrapper) {
        const bannerBtn = popout.querySelector("[class*='bannerButton_']");
        if (bannerBtn) {
            const span = bannerBtn.closest("span");
            if (span && span.parentElement) {
                wrapper = span.parentElement;
            } else {
                const overflow = bannerBtn.closest("[class*='overflowButtonContainer_']");
                if (overflow && overflow.parentElement) wrapper = overflow.parentElement;
            }
        }
    }
    if (!wrapper) return;

    const userId = getPopoutUserId(popout);
    if (!userId) return;

    const currentUserId = UserStore?.getCurrentUser?.()?.id;
    if (userId === currentUserId) return;

    const siblingBtn = wrapper.querySelector<HTMLElement>("[class*='bannerButton_']");
    let btnClass = "nc-quick-dm-button";
    if (siblingBtn) {
        const classes = Array.from(siblingBtn.classList).filter(c => !c.startsWith("nc-"));
        btnClass = classes.join(" ") + " nc-quick-dm-button";
    }

    const span = document.createElement("span");
    span.className = "nc-quick-dm-button-wrapper";

    const btn = document.createElement("div");
    btn.className = btnClass;
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.setAttribute("aria-label", t("Direct Message"));
    btn.setAttribute("title", t("Direct Message"));
    btn.innerHTML = KEYBOARD_SVG;

    const handleAction = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            openPrivateChannel(userId);
        } catch (err) {
            console.error("[QuickDM] Failed to open DM:", err);
        }
    };

    btn.addEventListener("click", handleAction);
    btn.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            handleAction(e);
        }
    });

    span.appendChild(btn);

    if (wrapper.firstChild) {
        wrapper.insertBefore(span, wrapper.firstChild);
    } else {
        wrapper.appendChild(span);
    }
}

function scanPopouts() {
    const popouts = document.querySelectorAll<HTMLElement>(
        "[class*='user-profile-popout'], [class*='userPopout'], .user-profile-popout, [class*='biteSize_'], [class*='outer_'][class*='themeContainer_']"
    );
    for (const popout of Array.from(popouts)) {
        injectQuickDMButton(popout);
    }
}

export default definePlugin({
    name: "QuickDM",
    description: "Adds a quick DM button with a keyboard icon to user profile popouts to open direct messages instantly.",
    authors: [
        {
            name: "Nightcord",
            id: 1539701501679894678n
        }
    ],
    enabledByDefault: true,

    start() {
        scanPopouts();
        observer = new MutationObserver(() => {
            scanPopouts();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
        const buttons = document.querySelectorAll(".nc-quick-dm-button-wrapper");
        for (const btn of Array.from(buttons)) {
            btn.remove();
        }
    }
});
