/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { copyToClipboard } from "@utils/clipboard";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import {
    createRoot,
    React,
    showToast,
    Toasts
} from "@webpack/common";

import { t } from "../autoTranslateNightcord";

const Tooltip = findComponentByCodeLazy("VoidTooltip cannot find DOM node") as React.ComponentType<{
    text: string | (() => React.ReactNode);
    position?: "top" | "bottom" | "left" | "right";
    color?: string;
    children: (props: Record<string, any>) => React.ReactNode;
}>;

const mountedRoots = new Map<HTMLElement, ReturnType<typeof createRoot>>();
let observer: MutationObserver | null = null;

function CopyProfileIdButton({
    userId,
    buttonClass,
    wrapperClass,
    childrenClass
}: {
    userId: string;
    buttonClass: string;
    wrapperClass: string;
    childrenClass: string;
}) {
    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        copyToClipboard(userId);
        showToast(t("User ID copied to clipboard!"), Toasts.Type.SUCCESS);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            copyToClipboard(userId);
            showToast(t("User ID copied to clipboard!"), Toasts.Type.SUCCESS);
        }
    };

    const combinedBtnClass = [
        buttonClass,
        "nc-copy-profile-id-button"
    ]
        .filter(Boolean)
        .join(" ")
        .split(" ")
        .filter((c, i, a) => a.indexOf(c) === i)
        .join(" ");

    return (
        <Tooltip text={t("Copy User ID")} position="top">
            {(tooltipProps: Record<string, any>) => (
                <button
                    {...tooltipProps}
                    data-mana-component="button"
                    role="button"
                    className={combinedBtnClass}
                    type="button"
                    aria-label={t("Copy User ID")}
                    onClick={e => {
                        tooltipProps?.onClick?.(e);
                        handleClick(e);
                    }}
                    onKeyDown={e => {
                        tooltipProps?.onKeyDown?.(e);
                        handleKeyDown(e);
                    }}
                >
                    <div className={wrapperClass}>
                        <div className={childrenClass}>
                            <svg
                                className="icon_a22cb0 vc-ic-save-icon"
                                aria-hidden="true"
                                role="img"
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                fill="none"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    fill="var(--control-critical-primary-background-default)"
                                    d="M16.32 14.72a1 1 0 0 1 0-1.41l2.51-2.51a3.98 3.98 0 0 0-5.62-5.63l-2.52 2.51a1 1 0 0 1-1.41-1.41l2.52-2.52a5.98 5.98 0 0 1 8.45 8.46l-2.52 2.51a1 1 0 0 1-1.41 0ZM7.68 9.29a1 1 0 0 1 0 1.41l-2.52 2.51a3.98 3.98 0 1 0 5.63 5.63l2.51-2.52a1 1 0 0 1 1.42 1.42l-2.52 2.51a5.98 5.98 0 0 1-8.45-8.45l2.51-2.51a1 1 0 0 1 1.42 0Z"
                                />
                                <path
                                    fill="var(--control-critical-primary-background-default)"
                                    d="M14.7 10.7a1 1 0 0 0-1.4-1.4l-4 4a1 1 0 1 0 1.4 1.4l4-4Z"
                                />
                            </svg>
                        </div>
                    </div>
                </button>
            )}
        </Tooltip>
    );
}

function extractUserIdFromFiber(el: Element | null): string | null {
    if (!el) return null;
    try {
        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
        if (!fiberKey) return null;
        let fiber = (el as any)[fiberKey];
        for (let i = 0; i < 45 && fiber; i++) {
            const props = fiber.memoizedProps || fiber.pendingProps;
            if (props) {
                if (props.user?.id && /^\d{17,20}$/.test(String(props.user.id))) return String(props.user.id);
                if (props.displayProfile?.userId && /^\d{17,20}$/.test(String(props.displayProfile.userId))) return String(props.displayProfile.userId);
                if (props.profile?.userId && /^\d{17,20}$/.test(String(props.profile.userId))) return String(props.profile.userId);
                if (props.member?.userId && /^\d{17,20}$/.test(String(props.member.userId))) return String(props.member.userId);
                if (props.member?.user?.id && /^\d{17,20}$/.test(String(props.member.user.id))) return String(props.member.user.id);
                if (props.author?.id && /^\d{17,20}$/.test(String(props.author.id))) return String(props.author.id);
                if (typeof props.userId === "string" && /^\d{17,20}$/.test(props.userId)) return props.userId;
            }
            fiber = fiber.return;
        }
    } catch {}
    return null;
}

function getPopoutUserId(popout: HTMLElement): string | null {
    const buttons = popout.querySelector<HTMLElement>("[class*='profileButtons_'], .profileButtons__9c3be");
    if (buttons) {
        const bid = extractUserIdFromFiber(buttons);
        if (bid) return bid;
    }

    const avatar = popout.querySelector<HTMLElement>("[class*='avatar_'], [class*='avatarStack_'], [class*='wrapper_'][role='img']");
    if (avatar) {
        const aid = extractUserIdFromFiber(avatar);
        if (aid) return aid;
    }

    const header = popout.querySelector<HTMLElement>("[class*='header_']");
    if (header) {
        const hid = extractUserIdFromFiber(header);
        if (hid) return hid;
    }

    const fiberId = extractUserIdFromFiber(popout);
    if (fiberId) return fiberId;

    const avatarImg = popout.querySelector<HTMLImageElement>("img[src*='/avatars/']");
    if (avatarImg) {
        const match = avatarImg.src.match(/\/avatars\/(\d{17,20})\//);
        if (match) return match[1];
    }

    return null;
}

function injectCopyIdButton(popout: HTMLElement) {
    const profileButtons = popout.querySelector<HTMLElement>("[class*='profileButtons_'], .profileButtons__9c3be");
    if (!profileButtons) return;
    if (profileButtons.querySelector(".nc-copy-profile-id-wrapper")) return;

    const userId = getPopoutUserId(popout);
    if (!userId) return;

    const messageBtn = profileButtons.querySelector<HTMLButtonElement>(
        "button[aria-label='Message'], button[aria-label*='message' i], button[aria-label*='Message' i], button:has(svg path[d^='M12 22a10'])"
    );

    const siblingBtn = messageBtn ?? profileButtons.querySelector<HTMLButtonElement>("button[class*='button_']");
    const btnClass = siblingBtn?.className || "button_a22cb0 sm_a22cb0 secondary_a22cb0";
    const wrapperClass = siblingBtn?.querySelector("[class*='buttonChildrenWrapper_']")?.className || "buttonChildrenWrapper_a22cb0";
    const childrenClass = siblingBtn?.querySelector("[class*='buttonChildren_']")?.className || "buttonChildren_a22cb0";

    const span = document.createElement("span");
    span.className = "nc-copy-profile-id-wrapper";

    if (messageBtn) {
        const targetEl = messageBtn.closest("span") ?? messageBtn;
        targetEl.insertAdjacentElement("afterend", span);
    } else {
        profileButtons.appendChild(span);
    }

    if (typeof createRoot === "function") {
        try {
            const root = createRoot(span);
            mountedRoots.set(span, root);
            root.render(
                <CopyProfileIdButton
                    userId={userId}
                    buttonClass={btnClass}
                    wrapperClass={wrapperClass}
                    childrenClass={childrenClass}
                />
            );
        } catch (err) {
            console.error("[CopyProfileId] Error rendering button root:", err);
        }
    }
}

function cleanupDisconnectedRoots() {
    for (const [spanEl, r] of mountedRoots.entries()) {
        if (!document.body.contains(spanEl)) {
            try { r.unmount(); } catch {}
            mountedRoots.delete(spanEl);
        }
    }
}

function scanPopouts() {
    cleanupDisconnectedRoots();
    const popouts = document.querySelectorAll<HTMLElement>(
        "[class*='user-profile-popout'], [class*='userPopout'], .user-profile-popout, [class*='biteSize_'], [class*='outer_'][class*='themeContainer_']"
    );
    for (const popout of Array.from(popouts)) {
        injectCopyIdButton(popout);
    }
}

export default definePlugin({
    name: "CopyProfileId",
    description: "Adds a button next to the Message button in user profile popouts to quickly copy the user ID.",
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
        for (const [spanEl, r] of mountedRoots.entries()) {
            try { r.unmount(); } catch {}
            spanEl.remove();
        }
        mountedRoots.clear();
        const buttons = document.querySelectorAll(".nc-copy-profile-id-wrapper");
        for (const btn of Array.from(buttons)) {
            btn.remove();
        }
    }
});
