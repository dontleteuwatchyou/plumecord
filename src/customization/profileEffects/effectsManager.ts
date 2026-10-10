/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, GuildMemberStore, SelectedGuildStore, UserStore } from "@webpack/common";
import { getLocalEffectsConfig, getPremiumSettings, readUserPremiumData } from "../sync";
import type { ProfileEffectsConfig } from "../types";

const PRESETS_BASE_URL = "https://raw.githubusercontent.com/holderikonik-prog/preset/main/presets/";
const presetCache = new Map<string, { html: string; css: string; js: string; }>();

let observer: MutationObserver | null = null;
let active = false;
let scanTimer: ReturnType<typeof setTimeout> | null = null;

async function fetchPreset(name: string): Promise<{ html: string; css: string; js: string; } | null> {
    if (presetCache.has(name)) return presetCache.get(name)!;
    try {
        const res = await fetch(`${PRESETS_BASE_URL}${name}.html`);
        if (!res.ok) return null;
        const raw = await res.text();
        if (!raw || raw.trim().length < 5) return null;

        const doc = new DOMParser().parseFromString(raw, "text/html");
        const cssBlocks: string[] = [];
        doc.querySelectorAll("style").forEach(el => { cssBlocks.push(el.textContent ?? ""); el.remove(); });
        const jsBlocks: string[] = [];
        doc.querySelectorAll("script").forEach(el => {
            const s = el as HTMLScriptElement;
            if (!s.src) jsBlocks.push(s.textContent ?? "");
            s.remove();
        });

        const parsed = {
            html: doc.body?.innerHTML ?? "",
            css: cssBlocks.join("\n"),
            js: jsBlocks.join("\n")
        };
        presetCache.set(name, parsed);
        return parsed;
    } catch {
        return null;
    }
}

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
}

export function applyNameEffectToElement(nameEl: HTMLElement, effectType: string, glowColor = "#a78bfa") {
    if (!effectType || effectType === "none") {
        removeNameEffectFromElement(nameEl);
        return;
    }

    const currentText = nameEl.textContent?.trim() || "";
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
    }
}

async function injectBackground(profileEl: HTMLElement, config: ProfileEffectsConfig) {
    if (!config.showBanner) {
        profileEl.querySelector(".cpe-bg-layer")?.remove();
        return;
    }
    if (profileEl.querySelector(".cpe-bg-layer")) return;

    const layer = document.createElement("div");
    layer.className = "cpe-bg-layer";

    if (config.mode === "preset" && config.presetName) {
        const preset = await fetchPreset(config.presetName);
        if (preset) {
            const container = document.createElement("div");
            container.style.cssText = "width:100%;height:100%;position:absolute;top:0;left:0;";
            container.innerHTML = preset.html;

            const style = document.createElement("style");
            style.textContent = preset.css;
            layer.appendChild(style);
            layer.appendChild(container);
        }
    } else if (config.mode === "gif" && config.gifUrl) {
        const img = document.createElement("img");
        img.className = "cpe-gif-bg";
        img.src = config.gifUrl;
        img.style.objectFit = config.gifFit;
        img.style.opacity = String(config.gifOpacity ?? 0.6);
        img.style.mixBlendMode = config.gifBlendMode ?? "normal";
        img.style.backgroundColor = config.gifBgColor ?? "transparent";
        layer.appendChild(img);
    }

    profileEl.style.position = "relative";
    profileEl.insertBefore(layer, profileEl.firstChild);
}

export async function scanAndApplyEffects() {
    if (!active) return;

    const settings = await getPremiumSettings();
    if (!settings.enabled || !settings.profileEffectsEnabled) return;

    const curUser = UserStore.getCurrentUser();
    if (!curUser?.id) return;

    const ownConfig = await getLocalEffectsConfig(curUser.id);

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

    // 1. Scan Profile Popouts and Modals
    const profileElements = document.querySelectorAll<HTMLElement>(
        "[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout'], [class*='profile_'], [class*='biteSize_'], [class*='fullSize_']"
    );

    for (const el of Array.from(profileElements)) {
        const authorId = getAuthorIdFromElement(el);
        const nameEls = el.querySelectorAll<HTMLElement>(
            "[class*='userTagUsername'], [class*='nickname'], [class*='globalName'], [class*='username_'], h1, h2"
        );
        let hasOwnName = false;
        for (const n of Array.from(nameEls)) {
            const txt = n.textContent?.trim().toLowerCase();
            if (txt && userNames.has(txt)) {
                hasOwnName = true;
                break;
            }
        }

        const isSelf = (authorId && authorId === curUser.id) || hasOwnName;

        if (isSelf) {
            void injectBackground(el, ownConfig);
            for (const n of Array.from(nameEls)) {
                if (ownConfig.nameEffect && ownConfig.nameEffect !== "none") {
                    applyNameEffectToElement(n, ownConfig.nameEffect, ownConfig.glowColor);
                } else {
                    removeNameEffectFromElement(n);
                }
            }
        } else if (authorId) {
            void readUserPremiumData(authorId).then(data => {
                if (!data?.effects) return;
                if (data.effects.showBanner) void injectBackground(el, data.effects);
                if (data.effects.nameEffect && data.effects.nameEffect !== "none") {
                    for (const n of Array.from(nameEls)) {
                        applyNameEffectToElement(n, data.effects.nameEffect, data.effects.glowColor);
                    }
                }
            });
        }
    }

    // 2. Scan Chat Usernames
    const chatNames = document.querySelectorAll<HTMLElement>(
        "[class*='username_'], [class*='header_'] [class*='username'], [id^='message-username-']"
    );
    for (const el of Array.from(chatNames)) {
        if (el.closest("[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout'], [class*='biteSize_']")) {
            continue;
        }

        const authorId = getAuthorIdFromElement(el);
        const txt = el.textContent?.trim().toLowerCase() || "";
        const isSelf = (authorId && authorId === curUser.id) || (txt && userNames.has(txt));

        if (isSelf) {
            if (ownConfig.chatUsernameEffect && ownConfig.chatUsernameEffect !== "none") {
                applyNameEffectToElement(el, ownConfig.chatUsernameEffect, ownConfig.glowColor);
            } else {
                removeNameEffectFromElement(el);
            }
        }
    }

    // 3. Scan Member List
    const memberNames = document.querySelectorAll<HTMLElement>(
        "[class*='member_'] [class*='name_'], [class*='member_'] [class*='username_'], [role='listitem'] [class*='name_']"
    );
    for (const el of Array.from(memberNames)) {
        const memberItem = el.closest<HTMLElement>("[class*='member_'], [role='listitem']") || el;
        const authorId = getAuthorIdFromElement(memberItem);
        const txt = el.textContent?.trim().toLowerCase() || "";
        const isSelf = (authorId && authorId === curUser.id) || (txt && userNames.has(txt));

        if (isSelf) {
            if (ownConfig.memberListEffect && ownConfig.memberListEffect !== "none") {
                applyNameEffectToElement(el, ownConfig.memberListEffect, ownConfig.glowColor);
            } else {
                removeNameEffectFromElement(el);
            }
        }
    }

    // 4. Scan Bottom-Left Current User Bar
    const currentUserBar = document.querySelectorAll<HTMLElement>(
        "[class*='panels_'] [class*='nameTag_'] [class*='title_'], [class*='panels_'] [class*='nameTag_'] [class*='subtext_'], [class*='panels_'] [class*='username_']"
    );
    for (const el of Array.from(currentUserBar)) {
        if (ownConfig.nameEffect && ownConfig.nameEffect !== "none") {
            applyNameEffectToElement(el, ownConfig.nameEffect, ownConfig.glowColor);
        } else {
            removeNameEffectFromElement(el);
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
    void scanAndApplyEffects();
}

function debouncedScan() {
    if (!active) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
        void scanAndApplyEffects();
    }, 120);
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
    try {
        FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnectionOpen);
        FluxDispatcher.unsubscribe("CURRENT_USER_UPDATE", onConnectionOpen);
    } catch {}

    document.querySelectorAll(".cpe-bg-layer").forEach(el => el.remove());
    document.querySelectorAll("[data-nc-applied-effect], .cpe-glow, .cpe-glitch, .cpe-rainbow-letter, .cpe-type-cursor").forEach(el => {
        removeNameEffectFromElement(el as HTMLElement);
    });
}
