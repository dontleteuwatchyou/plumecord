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
        el.closest("[class*='message_'], [class*='member_'], [class*='userProfile'], [class*='userPopout'], [class*='peopleListItem_'], [role='listitem']")?.querySelector("img[src*='/avatars/']");
    if (img) {
        const match = img.getAttribute("src")?.match(/\/avatars\/(\d+)\//);
        if (match) return match[1];
    }

    try {
        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
        if (fiberKey) {
            let fiber = (el as any)[fiberKey];
            for (let i = 0; i < 40 && fiber; i++) {
                const props = fiber.memoizedProps || fiber.pendingProps;
                if (props) {
                    if (props.user?.id) return String(props.user.id);
                    if (props.userId) return String(props.userId);
                    if (props.author?.id) return String(props.author.id);
                    if (props.message?.author?.id) return String(props.message.author.id);
                    if (props.member?.userId) return String(props.member.userId);
                    if (props.member?.user?.id) return String(props.member.user.id);
                    if (props.recipient?.id) return String(props.recipient.id);
                }
                fiber = fiber.return;
            }
        }
    } catch {}

    const container = el.closest<HTMLElement>(
        "[class*='message_'], [class*='member_'], [class*='userPopout'], [class*='userProfile'], [class*='peopleListItem'], [role='listitem'], [role='dialog'], [class*='modalRoot'], [class*='root_']"
    );
    if (container && container !== el) {
        try {
            const fiberKey = Object.keys(container).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
            if (fiberKey) {
                let fiber = (container as any)[fiberKey];
                for (let i = 0; i < 40 && fiber; i++) {
                    const props = fiber.memoizedProps || fiber.pendingProps;
                    if (props) {
                        if (props.user?.id) return String(props.user.id);
                        if (props.userId) return String(props.userId);
                        if (props.author?.id) return String(props.author.id);
                        if (props.message?.author?.id) return String(props.message.author.id);
                        if (props.member?.userId) return String(props.member.userId);
                        if (props.member?.user?.id) return String(props.member.user.id);
                        if (props.recipient?.id) return String(props.recipient.id);
                    }
                    fiber = fiber.return;
                }
            }
        } catch {}
    }

    return null;
}

export function getElementRawText(el: HTMLElement): string {
    const raw =
        el.getAttribute("data-cpe-original-text") ||
        el.getAttribute("data-cpe-text") ||
        el.querySelector("[data-cpe-original-text]")?.getAttribute("data-cpe-original-text") ||
        el.getAttribute("data-username-with-effects") ||
        el.getAttribute("data-text") ||
        el.textContent ||
        "";
    return raw.trim();
}

function isForbiddenElement(el: HTMLElement): boolean {
    const isProfileNameHeader =
        el.matches("[class*='header__00de6'], [class*='heading-xxl'], [data-text-variant*='heading-xxl']") ||
        !!el.closest("[class*='header__00de6'], [class*='heading-xxl'], [data-text-variant*='heading-xxl']");

    const tag = el.tagName.toLowerCase();
    if (!isProfileNameHeader && ["h1", "h2", "h3", "h4", "h5", "h6", "label", "p", "button", "input", "textarea", "svg", "path"].includes(tag)) {
        return true;
    }

    // Explicitly forbid username handles/tags (e.g. eaooe) and wrapper containers with discriminators
    if (
        el.matches("[class*='userTag_'], [class*='userTagUsername'], [class*='userTag'], [class*='discriminator_'], [class*='userTagDiscriminator_'], [class*='subText_'], [class*='nameTag_']") ||
        el.closest("[class*='userTag_'], [class*='userTagUsername'], [class*='userTag'], [class*='discriminator_'], [class*='userTagDiscriminator_'], [class*='subText_']")
    ) {
        return true;
    }

    // Disallow wrapper containers holding both username and discriminator directly
    if (el.querySelector("[class*='discriminator_'], [class*='userTagDiscriminator_']")) {
        return true;
    }

    const text = getElementRawText(el).toLowerCase();
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
    // If this element contains both a username and a discriminator (like in Friends List peopleListItem):
    // Target strictly the display name span!
    const usernameSpan = el.querySelector<HTMLElement>("[class*='username_']:not([class*='discriminator_'])");
    if (usernameSpan && el.querySelector("[class*='discriminator_'], [class*='userTagDiscriminator_']")) {
        return usernameSpan;
    }

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
    const safeText = text || "\u200B";
    for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i];
        if (node.nodeType === Node.TEXT_NODE) {
            node.nodeValue = safeText;
            return;
        }
    }
    if (el.children.length === 0) {
        el.textContent = safeText;
    } else {
        el.insertBefore(document.createTextNode(safeText), el.firstChild);
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
    } else {
        const originalText = nameEl.getAttribute("data-cpe-original-text");
        if (originalText) {
            updateElementText(nameEl, originalText);
            nameEl.removeAttribute("data-cpe-original-text");
        }
    }
}

export function applyNameEffectToElement(nameEl: HTMLElement, effectType: string, glowColor = "#a78bfa") {
    if (!effectType || effectType === "none" || isForbiddenElement(nameEl)) {
        removeNameEffectFromElement(nameEl);
        return;
    }

    const currentText = getElementRawText(nameEl);
    if (!currentText) {
        removeNameEffectFromElement(nameEl);
        return;
    }

    const alreadyApplied =
        nameEl.dataset.ncAppliedEffect === effectType &&
        nameEl.dataset.ncGlowColor === glowColor &&
        (effectType === "type"
            ? activeTypewriters.has(nameEl)
            : effectType === "glitch"
                ? nameEl.getAttribute("data-cpe-text") === currentText
                : true);
    if (alreadyApplied) {
        return;
    }

    if (effectType !== "type" && activeTypewriters.has(nameEl)) {
        const state = activeTypewriters.get(nameEl);
        if (state) {
            updateElementText(nameEl, state.fullText);
        }
        nameEl.removeAttribute("data-cpe-original-text");
        activeTypewriters.delete(nameEl);
        if (activeTypewriters.size === 0) {
            stopTypewriterLoop();
        }
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

const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Alex+Brush&family=Caveat:wght@600&family=JetBrains+Mono:wght@500;700&family=Orbitron:wght@600;800&family=Press+Start+2P&family=UnifrakturMaguntia&display=swap";

export function ensureProfileFontsLoaded() {
    if (typeof document === "undefined") return;
    if (document.getElementById("nightcord-custom-profile-fonts")) return;
    const link = document.createElement("link");
    link.id = "nightcord-custom-profile-fonts";
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    document.head.appendChild(link);
}

function applyProfileFont(el: HTMLElement, font: string) {
    const current = el.getAttribute("data-nc-profile-font") || "none";
    const target = (font && font !== "none") ? font : "none";
    if (current === target) return;

    if (target !== "none") {
        el.setAttribute("data-nc-profile-font", target);
        const inner = el.querySelector<HTMLElement>("[class*='profileContentInner_']");
        if (inner && inner !== el) inner.setAttribute("data-nc-profile-font", target);
        const outer = el.closest<HTMLElement>("[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout']");
        if (outer && outer !== el) outer.setAttribute("data-nc-profile-font", target);
    } else {
        el.removeAttribute("data-nc-profile-font");
        const inner = el.querySelector<HTMLElement>("[class*='profileContentInner_']");
        if (inner && inner !== el) inner.removeAttribute("data-nc-profile-font");
        const outer = el.closest<HTMLElement>("[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout']");
        if (outer && outer !== el) outer.removeAttribute("data-nc-profile-font");
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
    const selfEffectsActive = !!settings.profileEffectsEnabled ||
        (ownConfig.nameEffect && ownConfig.nameEffect !== "none") ||
        (ownConfig.profileFont && ownConfig.profileFont !== "none") ||
        !!ownConfig.showBanner;

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
        "[class*='displayNameContent_'], [class*='displayName_'], [class*='header__00de6'], [class*='heading-xxl'], [data-text-variant*='heading-xxl']"
    );
    for (const el of Array.from(allDisplayNames)) {
        if (isForbiddenElement(el)) {
            removeNameEffectFromElement(el);
            continue;
        }

        const authorId = getAuthorIdFromElement(el);
        const txt = getElementRawText(el).toLowerCase();
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

    // 2. Profile Popouts, Modals and Live Previews (Banners, Nicknames & Profile Fonts)
    const profileElements = document.querySelectorAll<HTMLElement>(
        "[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout'], [class*='profile_'], [class*='biteSize_'], [class*='fullSize_'], [class*='preview_'], [id='account'], [class*='accountProfile'], [class*='profileContentInner_']"
    );

    for (const el of Array.from(profileElements)) {
        const authorId = getAuthorIdFromElement(el);
        const nameEls = el.querySelectorAll<HTMLElement>(
            "[class*='header__00de6'], [class*='heading-xxl'], [data-text-variant*='heading-xxl'], [class*='displayNameContent_'], [class*='displayName_'], [class*='nickname'], [class*='globalName']"
        );

        let hasOwnName = false;
        for (const n of Array.from(nameEls)) {
            const txt = getElementRawText(n).toLowerCase();
            if (txt && userNames.has(txt)) {
                hasOwnName = true;
                break;
            }
        }

        const isSelf = (authorId && authorId === curUser.id) || hasOwnName || !!el.closest("[id='account'], [class*='accountProfile']");

        if (isSelf) {
            const targetFont = (selfEffectsActive && ownConfig.profileFont) ? ownConfig.profileFont : "none";
            applyProfileFont(el, targetFont);

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
                applyProfileFont(el, cached.data.effects.profileFont || "none");
                if (cached.data.effects.showBanner) void injectBackground(el, cached.data.effects);
                if (cached.data.effects.nameEffect && cached.data.effects.nameEffect !== "none") {
                    for (const n of Array.from(nameEls)) {
                        if (!isForbiddenElement(n)) {
                            applyNameEffectToElement(getTargetNameElement(n), cached.data.effects.nameEffect, cached.data.effects.glowColor);
                        }
                    }
                } else {
                    for (const n of Array.from(nameEls)) {
                        removeNameEffectFromElement(getTargetNameElement(n));
                    }
                }
            } else if (cached) {
                applyProfileFont(el, "none");
            } else if (!cached) {
                void readUserPremiumData(authorId).then(data => {
                    if (!data?.effects) {
                        applyProfileFont(el, "none");
                        return;
                    }
                    applyProfileFont(el, data.effects.profileFont || "none");
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
        if (el.closest("[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout'], [class*='biteSize_'], [class*='panels_'], [id='account'], [class*='accountProfile'], [class*='peopleListItem_'], [class*='member_'], [role='listitem']")) {
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
        const txt = getElementRawText(el).toLowerCase();
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

    // 5. Member List & Friends List
    const memberNames = document.querySelectorAll<HTMLElement>(
        "[class*='member_'] [class*='name_']:not([class*='nameTag_']), " +
        "[class*='member_'] [class*='username_']:not([class*='discriminator_']), " +
        "[class*='peopleListItem_'] [class*='username_']:not([class*='discriminator_']), " +
        "[role='listitem'] [class*='username_']:not([class*='discriminator_'])"
    );
    for (const el of Array.from(memberNames)) {
        if (isForbiddenElement(el)) {
            removeNameEffectFromElement(el);
            continue;
        }

        const memberItem = el.closest<HTMLElement>("[class*='member_'], [class*='peopleListItem_'], [role='listitem']") || el;
        const authorId = getAuthorIdFromElement(memberItem) || getAuthorIdFromElement(el);
        const txt = getElementRawText(el).toLowerCase();
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
    }, 35);
}

function onConnectionOpen() {
    triggerEffectsUpdate();
}

function onDocumentPointerDown(e: MouseEvent) {
    if (!active) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Check if clicked element relates to an avatar, username or member item to prefetch immediately
    const userEl = target.closest<HTMLElement>(
        "img[src*='/avatars/'], [class*='avatar'], [class*='username'], [class*='member_'], [class*='peopleListItem_'], [class*='message_'], [class*='wrapper_'][role='img'], [role='listitem']"
    );
    if (userEl) {
        const curUser = UserStore.getCurrentUser();
        const userId = getAuthorIdFromElement(userEl);
        if (userId && userId !== curUser?.id) {
            void readUserPremiumData(userId);
        }
    }

    // Trigger instant scanning
    requestAnimationFrame(() => scanAndApplyEffects());
    setTimeout(() => scanAndApplyEffects(), 20);
}

function onDocumentClick() {
    if (!active) return;
    requestAnimationFrame(() => scanAndApplyEffects());
    setTimeout(() => scanAndApplyEffects(), 16);
    setTimeout(() => scanAndApplyEffects(), 50);
}

function onUserProfileModalOpen(action: any) {
    if (!active) return;
    const curUser = UserStore.getCurrentUser();
    if (action?.userId && action.userId !== curUser?.id) {
        void readUserPremiumData(action.userId);
    }
    scanAndApplyEffects();
    requestAnimationFrame(() => scanAndApplyEffects());
    setTimeout(() => scanAndApplyEffects(), 25);
    setTimeout(() => scanAndApplyEffects(), 80);
}

function onModalPush() {
    if (!active) return;
    scanAndApplyEffects();
    requestAnimationFrame(() => scanAndApplyEffects());
    setTimeout(() => scanAndApplyEffects(), 25);
}

export function startProfileEffects() {
    if (active) return;
    active = true;

    ensureProfileFontsLoaded();

    observer = new MutationObserver(mutations => {
        let hasProfileMutation = false;
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            for (let j = 0; j < m.addedNodes.length; j++) {
                const node = m.addedNodes[j];
                if (node instanceof HTMLElement) {
                    if (
                        node.matches?.("[class*='userProfile'], [class*='userPopout'], [class*='profileContentInner'], [class*='modalRoot'], [role='dialog'], [class*='biteSize'], [class*='fullSize'], [class*='displayName']") ||
                        node.querySelector?.("[class*='userProfile'], [class*='userPopout'], [class*='profileContentInner'], [class*='biteSize'], [class*='fullSize'], [class*='displayName']")
                    ) {
                        hasProfileMutation = true;
                        break;
                    }
                }
            }
            if (hasProfileMutation) break;
        }

        if (hasProfileMutation) {
            scanAndApplyEffects();
            requestAnimationFrame(() => scanAndApplyEffects());
        } else {
            debouncedScan();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    try {
        FluxDispatcher.subscribe("CONNECTION_OPEN", onConnectionOpen);
        FluxDispatcher.subscribe("CURRENT_USER_UPDATE", onConnectionOpen);
        FluxDispatcher.subscribe("USER_PROFILE_MODAL_OPEN", onUserProfileModalOpen);
        FluxDispatcher.subscribe("USER_POPOUT_OPEN", onUserProfileModalOpen);
        FluxDispatcher.subscribe("MODAL_PUSH", onModalPush);
    } catch {}

    if (typeof document !== "undefined") {
        document.addEventListener("mousedown", onDocumentPointerDown, true);
        document.addEventListener("click", onDocumentClick, true);
    }

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
        FluxDispatcher.unsubscribe("USER_PROFILE_MODAL_OPEN", onUserProfileModalOpen);
        FluxDispatcher.unsubscribe("USER_POPOUT_OPEN", onUserProfileModalOpen);
        FluxDispatcher.unsubscribe("MODAL_PUSH", onModalPush);
    } catch {}

    if (typeof document !== "undefined") {
        document.removeEventListener("mousedown", onDocumentPointerDown, true);
        document.removeEventListener("click", onDocumentClick, true);
        document.querySelectorAll("[data-nc-profile-font]").forEach(el => {
            el.removeAttribute("data-nc-profile-font");
        });
    }

    document.querySelectorAll(".cpe-bg-layer").forEach(el => el.remove());
    document.querySelectorAll("[data-nc-applied-effect], .cpe-glow, .cpe-glitch, .cpe-rainbow-letter, .cpe-type-cursor").forEach(el => {
        removeNameEffectFromElement(el as HTMLElement);
    });
}
