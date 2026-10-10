/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, GuildMemberStore, SelectedGuildStore, UserStore } from "@webpack/common";
import { getCachedEffectsConfig, getCachedPremiumSettings, profileCache, readUserPremiumData } from "../sync";
import type { ProfileEffectsConfig } from "../types";

let observer: MutationObserver | null = null;
let active = false;
let scanTimer: ReturnType<typeof setTimeout> | null = null;

function getAuthorIdFromElement(el: HTMLElement): string | null {
    if (el.dataset.authorId) return el.dataset.authorId;
    if (el.dataset.userId) return el.dataset.userId;

    const img = el.querySelector("img[src*='/avatars/']") ||
        el.closest("[class*='message_'], [class*='member_'], [class*='userProfile'], [class*='userPopout']")?.querySelector("img[src*='/avatars/']");
    if (img) {
        const match = img.getAttribute("src")?.match(/\/avatars\/(\d+)\//);
        if (match) return match[1];
    }

    try {
        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
        if (fiberKey) {
            let fiber = (el as any)[fiberKey];
            for (let i = 0; i < 20 && fiber; i++) {
                const props = fiber.memoizedProps;
                if (props) {
                    if (props.message?.author?.id) return String(props.message.author.id);
                    if (props.author?.id) return String(props.author.id);
                    if (props.user?.id) return String(props.user.id);
                    if (props.userId) return String(props.userId);
                }
                fiber = fiber.return;
            }
        }
    } catch {}

    const container = el.closest<HTMLElement>("[class*='message_'], [class*='member_'], [class*='userPopout'], [class*='userProfile']");
    if (container && container !== el) {
        try {
            const fiberKey = Object.keys(container).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
            if (fiberKey) {
                let fiber = (container as any)[fiberKey];
                for (let i = 0; i < 20 && fiber; i++) {
                    const props = fiber.memoizedProps;
                    if (props) {
                        if (props.message?.author?.id) return String(props.message.author.id);
                        if (props.author?.id) return String(props.author.id);
                        if (props.user?.id) return String(props.user.id);
                        if (props.userId) return String(props.userId);
                    }
                    fiber = fiber.return;
                }
            }
        } catch {}
    }

    return null;
}

function isForbiddenElement(el: HTMLElement): boolean {
    const tag = el.tagName.toLowerCase();
    if (["h1", "h2", "h3", "h4", "h5", "h6", "label", "p", "button", "input", "textarea", "svg", "path"].includes(tag)) {
        return true;
    }

    // Explicitly forbid username handles/tags (e.g. eaooe) — ONLY display names and chat usernames get effects!
    if (
        el.matches("[class*='userTag_'], [class*='userTagUsername'], [class*='userTag'], [class*='discriminator_'], [class*='userTagDiscriminator_']") ||
        el.closest("[class*='userTag_'], [class*='userTagUsername'], [class*='userTag'], [class*='discriminator_']")
    ) {
        return true;
    }

    const text = (el.getAttribute("data-username-with-effects") || el.getAttribute("data-text") || el.textContent || "").trim().toLowerCase();
    if (!text) return true;

    // Disallow common section headers
    const forbiddenTexts = [
        "bio", "about me", "à propos de moi",
        "member since", "membre depuis",
        "connections", "connexions",
        "note", "notes",
        "mutual servers", "serveurs en commun", "mutual guilds",
        "mutual friends", "amis en commun",
        "activity", "activité",
        "display name", "nom d'affichage",
        "pronouns", "pronoms",
        "user profile", "profil d'utilisateur"
    ];
    if (forbiddenTexts.includes(text)) return true;

    // Disallow section containers unless specifically display name / username
    if (el.matches("[class*='section_'], [class*='userInfoSection_'], [class*='tabBar_'], [class*='banner_']")) {
        return true;
    }

    return false;
}

export function getTargetNameElement(el: HTMLElement): HTMLElement {
    const decorated = el.querySelector<HTMLElement>("[data-username-with-effects], [class*='innerContainer_']");
    if (decorated) return decorated;
    let curr = el;
    while (
        curr.children.length === 1 &&
        curr.firstElementChild instanceof HTMLElement &&
        curr.firstElementChild.textContent?.trim() === el.textContent?.trim()
    ) {
        curr = curr.firstElementChild;
    }
    return curr;
}

interface TypewriterState {
    fullText: string;
    currentIndex: number;
    isDeleting: boolean;
    pauseUntil: number;
}

const activeTypewriters = new Map<HTMLElement, TypewriterState>();
let typewriterTimer: ReturnType<typeof setInterval> | null = null;

function updateElementText(el: HTMLElement, text: string) {
    const child = el.firstChild;
    if (child && child.nodeType === Node.TEXT_NODE) {
        child.nodeValue = text;
    } else {
        el.textContent = text;
    }
}

function startTypewriterLoop() {
    if (typewriterTimer !== null) return;
    typewriterTimer = setInterval(() => {
        if (!active || activeTypewriters.size === 0) {
            stopTypewriterLoop();
            return;
        }

        const now = Date.now();
        for (const [el, state] of Array.from(activeTypewriters.entries())) {
            if (!el.isConnected) {
                activeTypewriters.delete(el);
                continue;
            }

            if (state.pauseUntil > now) continue;

            if (!state.isDeleting) {
                if (state.currentIndex < state.fullText.length) {
                    state.currentIndex++;
                    updateElementText(el, state.fullText.slice(0, state.currentIndex));
                    if (state.currentIndex === state.fullText.length) {
                        state.pauseUntil = now + 1800; // Pause 1.8s once full username is displayed
                    }
                } else {
                    state.isDeleting = true;
                }
            } else {
                if (state.currentIndex > 0) {
                    state.currentIndex--;
                    updateElementText(el, state.fullText.slice(0, state.currentIndex));
                    if (state.currentIndex === 0) {
                        state.pauseUntil = now + 600; // Pause 0.6s at empty cursor before re-typing
                    }
                } else {
                    state.isDeleting = false;
                }
            }
        }

        if (activeTypewriters.size === 0) {
            stopTypewriterLoop();
        }
    }, 90);
}

function stopTypewriterLoop() {
    if (typewriterTimer !== null) {
        clearInterval(typewriterTimer);
        typewriterTimer = null;
    }
}

export function removeNameEffectFromElement(nameEl: HTMLElement) {
    if (
        !nameEl.dataset.ncAppliedEffect &&
        !nameEl.classList.contains("cpe-glow") &&
        !nameEl.classList.contains("cpe-glitch") &&
        !nameEl.classList.contains("cpe-rainbow-letter") &&
        !nameEl.classList.contains("cpe-type-cursor")
    ) {
        return;
    }
    delete nameEl.dataset.ncAppliedEffect;
    delete nameEl.dataset.ncGlowColor;
    nameEl.classList.remove("cpe-glow", "cpe-glitch", "cpe-rainbow-letter", "cpe-type-cursor");
    nameEl.removeAttribute("data-cpe-text");
    nameEl.style.removeProperty("--cpe-glow-color");

    if (activeTypewriters.has(nameEl)) {
        const state = activeTypewriters.get(nameEl);
        if (state) {
            const originalText = nameEl.getAttribute("data-cpe-original-text") || state.fullText;
            updateElementText(nameEl, originalText);
        }
        nameEl.removeAttribute("data-cpe-original-text");
        activeTypewriters.delete(nameEl);
        if (activeTypewriters.size === 0) {
            stopTypewriterLoop();
        }
    }
}

export function applyNameEffectToElement(nameEl: HTMLElement, effectType: string, glowColor = "#a78bfa") {
    if (!effectType || effectType === "none" || isForbiddenElement(nameEl)) {
        removeNameEffectFromElement(nameEl);
        return;
    }

    const currentText = nameEl.getAttribute("data-username-with-effects") ||
                        nameEl.getAttribute("data-text") ||
                        nameEl.textContent?.trim() || "";
    if (!currentText) {
        removeNameEffectFromElement(nameEl);
        return;
    }

    if (
        nameEl.dataset.ncAppliedEffect === effectType &&
        nameEl.dataset.ncGlowColor === glowColor &&
        nameEl.getAttribute("data-cpe-text") === currentText
    ) {
        return;
    }

    nameEl.dataset.ncAppliedEffect = effectType;
    nameEl.dataset.ncGlowColor = glowColor;

    nameEl.classList.remove("cpe-glow", "cpe-glitch", "cpe-rainbow-letter", "cpe-type-cursor");
    nameEl.removeAttribute("data-cpe-text");
    nameEl.style.removeProperty("--cpe-glow-color");

    if (effectType === "glow") {
        nameEl.classList.add("cpe-glow");
        nameEl.style.setProperty("--cpe-glow-color", glowColor);
    } else if (effectType === "glitch") {
        nameEl.classList.add("cpe-glitch");
        nameEl.setAttribute("data-cpe-text", currentText);
    } else if (effectType === "rainbow") {
        nameEl.classList.add("cpe-rainbow-letter");
    } else if (effectType === "type") {
        nameEl.classList.add("cpe-type-cursor");
        if (!activeTypewriters.has(nameEl)) {
            const fullText = nameEl.getAttribute("data-cpe-original-text") || currentText;
            nameEl.setAttribute("data-cpe-original-text", fullText);
            activeTypewriters.set(nameEl, {
                fullText,
                currentIndex: fullText.length,
                isDeleting: false,
                pauseUntil: Date.now() + 1500
            });
            startTypewriterLoop();
        }
    }
}

async function injectBackground(profileEl: HTMLElement, _config: ProfileEffectsConfig) {
    profileEl.querySelector(".cpe-bg-layer")?.remove();
}

export function scanAndApplyEffects() {
    if (!active || (typeof document !== "undefined" && document.hidden)) return;

    const settings = getCachedPremiumSettings();
    if (!settings.enabled) return;

    const curUser = UserStore.getCurrentUser();
    if (!curUser?.id) return;

    const ownConfig = getCachedEffectsConfig();
    const selfEffectsActive = !!settings.profileEffectsEnabled || (ownConfig.nameEffect && ownConfig.nameEffect !== "none") || !!ownConfig.showBanner;

    const userNames = new Set<string>();
    if (curUser.username) userNames.add(curUser.username.trim().toLowerCase());
    if (curUser.globalName) userNames.add(curUser.globalName.trim().toLowerCase());
    if ((curUser as any).displayName) userNames.add(String((curUser as any).displayName).trim().toLowerCase());
    try {
        const curGuildId = SelectedGuildStore?.getGuildId?.();
        if (curGuildId) {
            const nick = GuildMemberStore?.getNick?.(curGuildId, curUser.id);
            if (nick) userNames.add(nick.trim().toLowerCase());
        }
    } catch {}

    // 0. Active Cleanup: Strip effects from any forbidden headings/labels/userTags
    const allApplied = document.querySelectorAll<HTMLElement>(
        "[data-nc-applied-effect], .cpe-glitch, .cpe-glow, .cpe-rainbow-letter, .cpe-type-cursor"
    );
    for (const el of Array.from(allApplied)) {
        if (isForbiddenElement(el)) {
            removeNameEffectFromElement(el);
        }
    }

    // 1. All Display Names across Discord (Settings preview sizer, Account popout menu, User popouts, Profile modals)
    const allDisplayNames = document.querySelectorAll<HTMLElement>(
        "[class*='displayNameContent_'], [class*='displayName_']"
    );
    for (const el of Array.from(allDisplayNames)) {
        if (isForbiddenElement(el)) {
            removeNameEffectFromElement(el);
            continue;
        }

        const authorId = getAuthorIdFromElement(el);
        const txt = (el.getAttribute("data-username-with-effects") || el.getAttribute("data-text") || el.textContent || "").trim().toLowerCase();
        const isSelf = (authorId && authorId === curUser.id) ||
                       (txt && userNames.has(txt)) ||
                       !!el.closest("[id='account'], [class*='accountProfile'], [class*='sizer_']");

        const targetEl = getTargetNameElement(el);

        if (isSelf) {
            if (selfEffectsActive && ownConfig.nameEffect && ownConfig.nameEffect !== "none") {
                applyNameEffectToElement(targetEl, ownConfig.nameEffect, ownConfig.glowColor);
            } else {
                removeNameEffectFromElement(targetEl);
            }
        } else if (authorId) {
            const cached = profileCache.get(authorId);
            if (cached && cached.data?.effects?.nameEffect && cached.data.effects.nameEffect !== "none") {
                applyNameEffectToElement(targetEl, cached.data.effects.nameEffect, cached.data.effects.glowColor);
            } else if (!cached) {
                void readUserPremiumData(authorId).then(data => {
                    if (data?.effects?.nameEffect && data.effects.nameEffect !== "none") {
                        applyNameEffectToElement(targetEl, data.effects.nameEffect, data.effects.glowColor);
                    }
                });
            }
        }
    }

    // 2. Profile Popouts, Modals and Live Previews (Banners & Nicknames)
    const profileElements = document.querySelectorAll<HTMLElement>(
        "[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout'], [class*='profile_'], [class*='biteSize_'], [class*='fullSize_'], [class*='preview_'], [id='account'], [class*='accountProfile']"
    );

    for (const el of Array.from(profileElements)) {
        const authorId = getAuthorIdFromElement(el);
        const nameEls = el.querySelectorAll<HTMLElement>(
            "[class*='displayNameContent_'], [class*='displayName_'], [class*='nickname'], [class*='globalName']"
        );

        let hasOwnName = false;
        for (const n of Array.from(nameEls)) {
            const txt = (n.getAttribute("data-username-with-effects") || n.getAttribute("data-text") || n.textContent || "").trim().toLowerCase();
            if (txt && userNames.has(txt)) {
                hasOwnName = true;
                break;
            }
        }

        const isSelf = (authorId && authorId === curUser.id) || hasOwnName || !!el.closest("[id='account'], [class*='accountProfile']");

        if (isSelf) {
            if (selfEffectsActive) {
                void injectBackground(el, ownConfig);
                for (const n of Array.from(nameEls)) {
                    if (isForbiddenElement(n)) {
                        removeNameEffectFromElement(n);
                        continue;
                    }
                    const targetEl = getTargetNameElement(n);
                    if (ownConfig.nameEffect && ownConfig.nameEffect !== "none") {
                        applyNameEffectToElement(targetEl, ownConfig.nameEffect, ownConfig.glowColor);
                    } else {
                        removeNameEffectFromElement(targetEl);
                    }
                }
            } else {
                el.querySelector(".cpe-bg-layer")?.remove();
                for (const n of Array.from(nameEls)) {
                    removeNameEffectFromElement(getTargetNameElement(n));
                }
            }
        } else if (authorId) {
            const cached = profileCache.get(authorId);
            if (cached && cached.data?.effects) {
                if (cached.data.effects.showBanner) void injectBackground(el, cached.data.effects);
                if (cached.data.effects.nameEffect && cached.data.effects.nameEffect !== "none") {
                    for (const n of Array.from(nameEls)) {
                        if (!isForbiddenElement(n)) {
                            applyNameEffectToElement(getTargetNameElement(n), cached.data.effects.nameEffect, cached.data.effects.glowColor);
                        }
                    }
                }
            } else if (!cached) {
                void readUserPremiumData(authorId).then(data => {
                    if (!data?.effects) return;
                    if (data.effects.showBanner) void injectBackground(el, data.effects);
                    if (data.effects.nameEffect && data.effects.nameEffect !== "none") {
                        for (const n of Array.from(nameEls)) {
                            if (!isForbiddenElement(n)) {
                                applyNameEffectToElement(getTargetNameElement(n), data.effects.nameEffect, data.effects.glowColor);
                            }
                        }
                    }
                });
            }
        }
    }

    // 3. Bottom-Left Current User Bar
    const currentUserBar = document.querySelectorAll<HTMLElement>(
        "[class*='panels_'] [class*='title_'], [class*='panels_'] [class*='nameTag_'] [class*='title_'], [class*='panels_'] [class*='displayName_']"
    );
    for (const el of Array.from(currentUserBar)) {
        if (isForbiddenElement(el)) {
            removeNameEffectFromElement(el);
            continue;
        }
        const targetEl = getTargetNameElement(el);
        if (selfEffectsActive && ownConfig.nameEffect && ownConfig.nameEffect !== "none") {
            applyNameEffectToElement(targetEl, ownConfig.nameEffect, ownConfig.glowColor);
        } else {
            removeNameEffectFromElement(targetEl);
        }
    }

    // 4. Chat Usernames & Decorators
    const chatNames = document.querySelectorAll<HTMLElement>(
        "[class*='message_'] [class*='username_'], " +
        "[class*='contents_'] [class*='username_'], " +
        "[class*='header_'] [class*='username_'], " +
        "[id^='message-username-'], " +
        "[class*='usernameFont_'], " +
        "[class*='innerContainer_'], " +
        "[data-username-with-effects]"
    );
    for (const el of Array.from(chatNames)) {
        if (el.closest("[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout'], [class*='biteSize_'], [class*='panels_'], [id='account'], [class*='accountProfile']")) {
            continue;
        }
        if (isForbiddenElement(el)) {
            removeNameEffectFromElement(el);
            continue;
        }
        // If an ancestor already has effect, don't nest effects on inner spans
        const parentEffect = el.parentElement?.closest("[data-nc-applied-effect], .cpe-glitch, .cpe-glow, .cpe-rainbow-letter, .cpe-type-cursor");
        if (parentEffect) {
            removeNameEffectFromElement(el);
            continue;
        }
        if (el.querySelector("[class*='innerContainer_'], [data-username-with-effects]")) {
            removeNameEffectFromElement(el);
            continue;
        }

        const targetEl = getTargetNameElement(el);
        const authorId = getAuthorIdFromElement(el);
        const txt = (el.getAttribute("data-username-with-effects") || el.getAttribute("data-text") || el.textContent || "").trim().toLowerCase();
        const isSelf = (authorId && authorId === curUser.id) || (txt && userNames.has(txt));

        if (isSelf) {
            const effect = (ownConfig.chatUsernameEffect && ownConfig.chatUsernameEffect !== "none")
                ? ownConfig.chatUsernameEffect
                : ownConfig.nameEffect;
            if (selfEffectsActive && effect && effect !== "none") {
                applyNameEffectToElement(targetEl, effect, ownConfig.glowColor);
            } else {
                removeNameEffectFromElement(targetEl);
            }
        } else if (authorId) {
            const cached = profileCache.get(authorId);
            if (cached && cached.data?.effects) {
                const effect = cached.data.effects.chatUsernameEffect || cached.data.effects.nameEffect;
                if (effect && effect !== "none") {
                    applyNameEffectToElement(targetEl, effect, cached.data.effects.glowColor);
                } else {
                    removeNameEffectFromElement(targetEl);
                }
            } else if (!cached) {
                void readUserPremiumData(authorId).then(data => {
                    if (data?.effects) {
                        const effect = data.effects.chatUsernameEffect || data.effects.nameEffect;
                        if (effect && effect !== "none") {
                            applyNameEffectToElement(targetEl, effect, data.effects.glowColor);
                        }
                    }
                });
            }
        }
    }

    // 5. Member List
    const memberNames = document.querySelectorAll<HTMLElement>(
        "[class*='member_'] [class*='name_'], " +
        "[class*='member_'] [class*='username_'], " +
        "[role='listitem'] [class*='name_'], " +
        "[role='listitem'] [class*='username_']"
    );
    for (const el of Array.from(memberNames)) {
        if (isForbiddenElement(el)) {
            removeNameEffectFromElement(el);
            continue;
        }

        const memberItem = el.closest<HTMLElement>("[class*='member_'], [role='listitem']") || el;
        const authorId = getAuthorIdFromElement(memberItem);
        const txt = (el.getAttribute("data-username-with-effects") || el.getAttribute("data-text") || el.textContent || "").trim().toLowerCase();
        const isSelf = (authorId && authorId === curUser.id) || (txt && userNames.has(txt));
        const targetEl = getTargetNameElement(el);

        if (isSelf) {
            const effect = (ownConfig.memberListEffect && ownConfig.memberListEffect !== "none")
                ? ownConfig.memberListEffect
                : ownConfig.nameEffect;
            if (selfEffectsActive && effect && effect !== "none") {
                applyNameEffectToElement(targetEl, effect, ownConfig.glowColor);
            } else {
                removeNameEffectFromElement(targetEl);
            }
        } else if (authorId) {
            const cached = profileCache.get(authorId);
            if (cached && cached.data?.effects) {
                const effect = cached.data.effects.memberListEffect || cached.data.effects.nameEffect;
                if (effect && effect !== "none") {
                    applyNameEffectToElement(targetEl, effect, cached.data.effects.glowColor);
                } else {
                    removeNameEffectFromElement(targetEl);
                }
            } else if (!cached) {
                void readUserPremiumData(authorId).then(data => {
                    if (data?.effects) {
                        const effect = data.effects.memberListEffect || data.effects.nameEffect;
                        if (effect && effect !== "none") {
                            applyNameEffectToElement(targetEl, effect, data.effects.glowColor);
                        }
                    }
                });
            }
        }
    }
}

export function triggerEffectsUpdate() {
    if (!active) {
        startProfileEffects();
    }
    if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
    }
    scanAndApplyEffects();
}

function debouncedScan() {
    if (!active || (typeof document !== "undefined" && document.hidden)) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
        scanAndApplyEffects();
    }, 140);
}

function onConnectionOpen() {
    triggerEffectsUpdate();
}

export function startProfileEffects() {
    if (active) return;
    active = true;

    observer = new MutationObserver(() => {
        debouncedScan();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    try {
        FluxDispatcher.subscribe("CONNECTION_OPEN", onConnectionOpen);
        FluxDispatcher.subscribe("CURRENT_USER_UPDATE", onConnectionOpen);
    } catch {}

    triggerEffectsUpdate();
}

export function stopProfileEffects() {
    active = false;
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
    }
    stopTypewriterLoop();
    for (const [el, state] of Array.from(activeTypewriters.entries())) {
        if (el.isConnected) {
            updateElementText(el, state.fullText);
            el.removeAttribute("data-cpe-original-text");
        }
    }
    activeTypewriters.clear();

    try {
        FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnectionOpen);
        FluxDispatcher.unsubscribe("CURRENT_USER_UPDATE", onConnectionOpen);
    } catch {}

    document.querySelectorAll(".cpe-bg-layer").forEach(el => el.remove());
    document.querySelectorAll("[data-nc-applied-effect], .cpe-glow, .cpe-glitch, .cpe-rainbow-letter, .cpe-type-cursor").forEach(el => {
        removeNameEffectFromElement(el as HTMLElement);
    });
}
