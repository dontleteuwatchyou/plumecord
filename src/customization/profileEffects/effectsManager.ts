/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserStore } from "@webpack/common";
import { getLocalEffectsConfig, getPremiumSettings, readUserPremiumData } from "../sync";
import type { ProfileEffectsConfig } from "../types";

const PRESETS_BASE_URL = "https://raw.githubusercontent.com/holderikonik-prog/preset/main/presets/";
const presetCache = new Map<string, { html: string; css: string; js: string; }>();

let observer: MutationObserver | null = null;
let active = false;
let styleTag: HTMLStyleElement | null = null;

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

function applyNameEffectToElement(nameEl: HTMLElement, effectType: string, glowColor = "#a78bfa") {
    if (nameEl.dataset.ncAppliedEffect === effectType) return;
    nameEl.dataset.ncAppliedEffect = effectType;

    // Reset previous
    nameEl.classList.remove("cpe-glow", "cpe-glitch", "cpe-rainbow-letter", "cpe-type-cursor");
    nameEl.removeAttribute("data-cpe-text");
    nameEl.style.removeProperty("--cpe-glow-color");

    if (effectType === "glow") {
        nameEl.classList.add("cpe-glow");
        nameEl.style.setProperty("--cpe-glow-color", glowColor);
    } else if (effectType === "glitch") {
        nameEl.classList.add("cpe-glitch");
        nameEl.setAttribute("data-cpe-text", nameEl.textContent || "");
    } else if (effectType === "rainbow") {
        nameEl.classList.add("cpe-rainbow-letter");
    } else if (effectType === "type") {
        nameEl.classList.add("cpe-type-cursor");
    }
}

async function injectBackground(profileEl: HTMLElement, config: ProfileEffectsConfig) {
    if (profileEl.querySelector(".cpe-bg-layer")) return;
    if (!config.showBanner) return;

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

let scanTimer: ReturnType<typeof setTimeout> | null = null;

async function scanAndApplyEffects() {
    if (!active) return;
    if (scanTimer) clearTimeout(scanTimer);

    scanTimer = setTimeout(async () => {
        const settings = await getPremiumSettings();
        if (!settings.enabled || !settings.profileEffectsEnabled) return;

        const curUser = UserStore.getCurrentUser();
        if (!curUser?.id) return;

        const ownConfig = await getLocalEffectsConfig(curUser.id);

        // 1. Scan Profile Popouts and Modals
        const profileElements = document.querySelectorAll<HTMLElement>(
            "[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout']"
        );

        for (const el of Array.from(profileElements)) {
            void injectBackground(el, ownConfig);

            const nameEl = el.querySelector<HTMLElement>("[class*='userTagUsername'], [class*='nickname'], h1, h2");
            if (nameEl && ownConfig.nameEffect && ownConfig.nameEffect !== "none") {
                applyNameEffectToElement(nameEl, ownConfig.nameEffect, ownConfig.glowColor);
            }
        }

        // 2. Scan Chat Usernames
        if (ownConfig.chatUsernameEffect && ownConfig.chatUsernameEffect !== "none") {
            const chatNames = document.querySelectorAll<HTMLElement>("[class*='username_']");
            for (const el of Array.from(chatNames)) {
                if (el.textContent?.trim() === curUser.username || el.dataset.authorId === curUser.id) {
                    applyNameEffectToElement(el, ownConfig.chatUsernameEffect, ownConfig.glowColor);
                }
            }
        }

        // 3. Scan Member List
        if (ownConfig.memberListEffect && ownConfig.memberListEffect !== "none") {
            const memberNames = document.querySelectorAll<HTMLElement>("[class*='member_'] [class*='name_']");
            for (const el of Array.from(memberNames)) {
                if (el.textContent?.trim() === curUser.username) {
                    applyNameEffectToElement(el, ownConfig.memberListEffect, ownConfig.glowColor);
                }
            }
        }
    }, 150);
}

export function startProfileEffects() {
    if (active) return;
    active = true;

    observer = new MutationObserver(() => {
        void scanAndApplyEffects();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    void scanAndApplyEffects();
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
    document.querySelectorAll(".cpe-bg-layer").forEach(el => el.remove());
    document.querySelectorAll("[data-nc-applied-effect]").forEach(el => {
        el.classList.remove("cpe-glow", "cpe-glitch", "cpe-rainbow-letter", "cpe-type-cursor");
        el.removeAttribute("data-cpe-text");
        el.removeAttribute("data-nc-applied-effect");
        (el as HTMLElement).style.removeProperty("--cpe-glow-color");
    });
}
