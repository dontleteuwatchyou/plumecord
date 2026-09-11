/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";

const wordCache = new Map<string, string>();
const pendingTranslations = new Map<string, Promise<string | null>>();
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchCasing(original: string, translated: string): string {
    if (!original || !translated) return translated;
    if (original === original.toUpperCase() && original !== original.toLowerCase())
        return translated.toUpperCase();
    const first = original.charAt(0);
    if (first === first.toUpperCase() && first !== first.toLowerCase())
        return translated.charAt(0).toUpperCase() + translated.slice(1);
    return translated;
}

function getDiscordLocale(): string {
    try {
        return (
            (window as any).Vencord?.Webpack?.findByProps?.("getLocale")?.getLocale?.() ||
            navigator.language ||
            "fr"
        );
    } catch {
        return navigator.language || "fr";
    }
}

function getEffectiveSourceLang(configured?: string, targetLang = "en"): string {
    if (configured && configured !== "auto") return configured;
    const locale = getDiscordLocale();
    const lang = locale.toLowerCase().split(/[-_]/)[0];
    if (lang && lang !== targetLang) return lang;
    return "auto";
}

function extractTranslation(data: unknown): string | null {
    if (!data) return null;
    if (typeof data === "string") return data.trim() || null;
    if (Array.isArray(data)) {
        const first = (data as unknown[])[0];
        if (typeof first === "string") return first.trim() || null;
        if (Array.isArray(first)) {
            const inner = (first as unknown[])[0];
            if (typeof inner === "string") return inner.trim() || null;
        }
    }
    return null;
}

async function queryGoogleTranslate(word: string, sl: string, tl: string): Promise<string | null> {
    try {
        const url = `https://clients5.google.com/translate_a/t?${new URLSearchParams({ client: "dict-chrome-ex", sl, tl, q: word })}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return extractTranslation(data);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Public: fetch a translation for a single word with caching
// ---------------------------------------------------------------------------

export async function fetchWordTranslation(word: string, from: string, to: string): Promise<string | null> {
    if (!word || word.trim().length === 0) return null;
    const cleanWord = word.trim();
    const cacheKey = `${from}:${to}:${cleanWord.toLowerCase()}`;

    if (wordCache.has(cacheKey)) return wordCache.get(cacheKey)!;
    if (pendingTranslations.has(cacheKey)) return pendingTranslations.get(cacheKey)!;

    const promise = (async () => {
        const sl = from || "auto";
        const tl = to || "en";
        let translated = await queryGoogleTranslate(cleanWord, sl, tl);

        if (!translated || translated.toLowerCase() === cleanWord.toLowerCase()) {
            const fallbackSl = getEffectiveSourceLang("auto", tl);
            if (fallbackSl !== "auto" && fallbackSl !== sl) {
                const retry = await queryGoogleTranslate(cleanWord, fallbackSl, tl);
                if (retry && retry.toLowerCase() !== cleanWord.toLowerCase()) translated = retry;
            }
        }

        if (translated && translated.trim() && translated.toLowerCase() !== cleanWord.toLowerCase()) {
            const result = translated.trim();
            wordCache.set(cacheKey, result);
            return result;
        }
        return null;
    })();

    pendingTranslations.set(cacheKey, promise);
    try {
        return await promise;
    } finally {
        pendingTranslations.delete(cacheKey);
    }
}

// ---------------------------------------------------------------------------
// Word detection
// ---------------------------------------------------------------------------

interface WordInfo {
    word: string;
    /** The text node where the word ends (for DOM range replacement) */
    textNode: Text;
    /** Character offset of the cursor in textNode */
    cursorOffset: number;
}

/**
 * Finds the word immediately before the cursor inside a contenteditable / Slate node.
 * Returns null if the cursor isn't in a text node or there's no word before it.
 */
function getWordBeforeCursor(): WordInfo | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

    let node: Node | null = sel.anchorNode;
    let offset = sel.anchorOffset;

    // If we landed on an element node, try to descend into its previous text child
    if (node && node.nodeType === Node.ELEMENT_NODE) {
        if (offset > 0 && node.childNodes[offset - 1]?.nodeType === Node.TEXT_NODE) {
            node = node.childNodes[offset - 1];
            offset = node.textContent?.length ?? 0;
        }
    }

    if (!node || node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.textContent ?? "";
    const textBefore = text.slice(0, offset);
    const match = textBefore.match(/([\p{L}\p{M}'-]+)$/u);
    if (!match) return null;

    return { word: match[1], textNode: node as Text, cursorOffset: offset };
}

function isWordEligible(word: string): boolean {
    if (!word || word.length < 1) return false;
    if (/^https?:\/\//i.test(word) || /^www\./i.test(word)) return false;
    if (word.startsWith("@") || word.startsWith("#")) return false;
    if (/^:[a-zA-Z0-9_+-]+:?$/.test(word)) return false;
    if (word.startsWith("/")) return false;
    if (!/[\p{L}\p{M}]/u.test(word)) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Text replacement — using a DOM Range + execCommand("insertText")
// This is the only reliable approach in Discord's Electron/Slate editor:
// selecting via Range and firing execCommand integrates with Slate's history.
// ---------------------------------------------------------------------------

function replaceWordInEditor(info: WordInfo, replacement: string): boolean {
    try {
        const { textNode, cursorOffset, word } = info;
        const wordStart = cursorOffset - word.length;
        if (wordStart < 0) return false;

        // Verify the text node still has the word at the expected position
        const currentText = textNode.textContent ?? "";
        if (currentText.slice(wordStart, cursorOffset) !== word) return false;

        const range = document.createRange();
        range.setStart(textNode, wordStart);
        range.setEnd(textNode, cursorOffset);

        const sel = window.getSelection();
        if (!sel) return false;
        sel.removeAllRanges();
        sel.addRange(range);

        // execCommand("insertText") fires the proper Slate onChange pipeline in Electron
        return document.execCommand("insertText", false, replacement);
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Space key handler
// ---------------------------------------------------------------------------

let isHandlingSpace = false;

async function onKeyDown(e: KeyboardEvent) {
    if (e.key !== " " && e.code !== "Space") return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.repeat) return;
    if (!settings.store.translateOnSpace) return;
    if (isHandlingSpace) return;

    // Only intercept inside Discord's chat input (contenteditable / Slate)
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const inChatbox =
        target.getAttribute?.("role") === "textbox" ||
        target.hasAttribute?.("data-slate-editor") ||
        !!target.closest?.('[role="textbox"]') ||
        !!target.closest?.('[data-slate-editor="true"]');
    if (!inChatbox) return;

    // Capture cursor state BEFORE any await
    const wordInfo = getWordBeforeCursor();
    if (!wordInfo || !isWordEligible(wordInfo.word)) return;

    const word = wordInfo.word;
    const from = getEffectiveSourceLang(settings.store.sentInput, settings.store.sentOutput || "en");
    const to = settings.store.sentOutput || "en";
    if (from !== "auto" && from === to) return;

    // --- Serve from cache instantly ---
    const cacheKey = `${from}:${to}:${word.toLowerCase()}`;
    const cached = wordCache.get(cacheKey);
    if (cached && cached.toLowerCase() !== word.toLowerCase()) {
        e.preventDefault();
        e.stopPropagation();
        const replacement = matchCasing(word, cached) + " ";
        replaceWordInEditor(wordInfo, replacement);
        return;
    }

    // --- Not cached: block space, wait for translation (max 400 ms) ---
    e.preventDefault();
    e.stopPropagation();
    isHandlingSpace = true;

    try {
        const translated = await Promise.race([
            fetchWordTranslation(word, from, to),
            new Promise<null>(resolve => setTimeout(() => resolve(null), 400)),
        ]);

        if (translated && translated.toLowerCase() !== word.toLowerCase()) {
            const replacement = matchCasing(word, translated) + " ";
            const ok = replaceWordInEditor(wordInfo, replacement);
            if (!ok) {
                // Fallback: just insert a space after the (untranslated) word
                document.execCommand("insertText", false, " ");
            }
        } else {
            // No translation found → insert a normal space
            document.execCommand("insertText", false, " ");
        }
    } catch {
        document.execCommand("insertText", false, " ");
    } finally {
        isHandlingSpace = false;
    }
}

// ---------------------------------------------------------------------------
// Pre-fetch as the user types (warms cache so space-key handler is instant)
// ---------------------------------------------------------------------------

function onInput(e: Event) {
    if (!settings.store.translateOnSpace) return;
    if (prefetchTimer !== null) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
        prefetchTimer = null;
        const wordInfo = getWordBeforeCursor();
        if (wordInfo && wordInfo.word.length >= 2 && isWordEligible(wordInfo.word)) {
            const from = getEffectiveSourceLang(settings.store.sentInput, settings.store.sentOutput || "en");
            const to = settings.store.sentOutput || "en";
            fetchWordTranslation(wordInfo.word, from, to).catch(() => {/* fire and forget */});
        }
    }, 75);
}

// ---------------------------------------------------------------------------
// Init / teardown
// ---------------------------------------------------------------------------

export function initTranslateOnSpace(): void {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("input", onInput, true);
}

export function stopTranslateOnSpace(): void {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("input", onInput, true);
    if (prefetchTimer !== null) {
        clearTimeout(prefetchTimer);
        prefetchTimer = null;
    }
    wordCache.clear();
    pendingTranslations.clear();
    isHandlingSpace = false;
}
