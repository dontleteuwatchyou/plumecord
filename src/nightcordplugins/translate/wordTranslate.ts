/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";

const wordCache = new Map<string, string>();
const pendingTranslations = new Map<string, Promise<string | null>>();
let prefetchTimer: any = null;

function matchCasing(original: string, translated: string): string {
    if (!original || !translated) return translated;
    if (original === original.toUpperCase() && original !== original.toLowerCase()) {
        return translated.toUpperCase();
    }
    const firstChar = original.charAt(0);
    if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
        return translated.charAt(0).toUpperCase() + translated.slice(1);
    }
    return translated;
}

function getDiscordLocale(): string {
    try {
        return (window as any).Vencord?.Webpack?.findByProps?.("getLocale")?.getLocale?.() || navigator.language || "fr";
    } catch {
        return navigator.language || "fr";
    }
}

function getEffectiveSourceLang(configured?: string, targetLang = "en"): string {
    if (configured && configured !== "auto") return configured;
    const locale = getDiscordLocale();
    const lang = locale.toLowerCase().split(/[-_]/)[0];
    if (lang && lang !== targetLang) {
        return lang;
    }
    return "auto";
}

function extractTranslation(data: any): string | null {
    if (!data) return null;
    if (typeof data === "string") return data.trim() || null;
    if (Array.isArray(data)) {
        const first = data[0];
        if (typeof first === "string") return first.trim() || null;
        if (Array.isArray(first)) {
            const inner = first[0];
            if (typeof inner === "string") return inner.trim() || null;
        }
    }
    return null;
}

async function queryGoogleTranslate(word: string, sl: string, tl: string): Promise<string | null> {
    try {
        const url = `https://clients5.google.com/translate_a/t?${new URLSearchParams({
            client: "dict-chrome-ex",
            sl,
            tl,
            q: word
        })}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return extractTranslation(data);
    } catch {
        return null;
    }
}

export async function fetchWordTranslation(word: string, from: string, to: string): Promise<string | null> {
    if (!word || word.trim().length === 0) return null;
    const cleanWord = word.trim();
    const cacheKey = `${from}:${to}:${cleanWord.toLowerCase()}`;

    if (wordCache.has(cacheKey)) {
        return wordCache.get(cacheKey)!;
    }
    if (pendingTranslations.has(cacheKey)) {
        return await pendingTranslations.get(cacheKey)!;
    }

    const promise = (async () => {
        try {
            const sl = from || "auto";
            const tl = to || "en";
            let translated = await queryGoogleTranslate(cleanWord, sl, tl);

            // If auto was used and translation is identical or null, try effective locale
            if (!translated || translated.toLowerCase() === cleanWord.toLowerCase()) {
                const fallbackSl = getEffectiveSourceLang("auto", tl);
                if (fallbackSl !== "auto" && fallbackSl !== sl) {
                    const retry = await queryGoogleTranslate(cleanWord, fallbackSl, tl);
                    if (retry && retry.toLowerCase() !== cleanWord.toLowerCase()) {
                        translated = retry;
                    }
                }
            }

            if (translated && translated.trim() && translated.toLowerCase() !== cleanWord.toLowerCase()) {
                const result = translated.trim();
                wordCache.set(cacheKey, result);
                return result;
            }
        } catch {}
        return null;
    })();

    pendingTranslations.set(cacheKey, promise);
    try {
        return await promise;
    } finally {
        pendingTranslations.delete(cacheKey);
    }
}

function getSlateEditorFromElement(el: HTMLElement | null): any {
    let curr: HTMLElement | null = el;
    while (curr) {
        const key = Object.keys(curr).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
        if (key) {
            let fiber = (curr as any)[key];
            let depth = 0;
            while (fiber && depth < 30) {
                depth++;
                if (fiber.memoizedProps?.editor) return fiber.memoizedProps.editor;
                if (fiber.stateNode?.editor) return fiber.stateNode.editor;
                if (typeof fiber.stateNode?.getSlateEditor === "function") return fiber.stateNode.getSlateEditor();
                if (typeof fiber.memoizedProps?.getSlateEditor === "function") return fiber.memoizedProps.getSlateEditor();
                if (typeof fiber.ref?.current?.getSlateEditor === "function") return fiber.ref.current.getSlateEditor();

                let hook = fiber.memoizedState;
                while (hook) {
                    if (hook.memoizedState?.editor) return hook.memoizedState.editor;
                    if (hook.baseState?.editor) return hook.baseState.editor;
                    hook = hook.next;
                }
                fiber = fiber.return;
            }
        }
        curr = curr.parentElement;
    }
    return null;
}

interface WordInfo {
    word: string;
    node?: Text;
    offset?: number;
    isInput?: boolean;
}

function getWordBeforeCursor(target: HTMLElement): WordInfo | null {
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const val = target.value;
        const selStart = target.selectionStart ?? 0;
        const selEnd = target.selectionEnd ?? 0;
        if (selStart !== selEnd) return null;
        const textBefore = val.slice(0, selStart);
        const match = textBefore.match(/([\p{L}\p{M}'-]+)$/u);
        if (!match) return null;
        return { word: match[1], isInput: true, offset: selStart };
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

    let node: Node | null = sel.anchorNode;
    let offset = sel.anchorOffset;

    if (node && node.nodeType === Node.ELEMENT_NODE) {
        if (offset > 0 && node.childNodes[offset - 1]?.nodeType === Node.TEXT_NODE) {
            node = node.childNodes[offset - 1];
            offset = node.textContent?.length || 0;
        }
    }

    if (!node || node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.textContent || "";
    const textBefore = text.slice(0, offset);
    const match = textBefore.match(/([\p{L}\p{M}'-]+)$/u);
    if (!match) return null;

    return { word: match[1], node: node as Text, offset, isInput: false };
}

function isWordEligible(word: string): boolean {
    if (!word || word.length < 1) return false;
    if (/^https?:\/\//i.test(word) || /^www\./i.test(word)) return false;
    if (word.startsWith("@") || word.startsWith("#") || word.startsWith("<@") || word.startsWith("<#")) return false;
    if (/^:[a-zA-Z0-9_+-]+:?$/.test(word)) return false;
    if (word.startsWith("/")) return false;
    if (!/[\p{L}\p{M}]/u.test(word)) return false;
    return true;
}

function replaceWordAtCursor(target: HTMLElement, word: string, replacement: string, wordInfo?: WordInfo | null): boolean {
    // 1. Textarea or Input
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || wordInfo?.isInput) {
        const input = target as HTMLTextAreaElement | HTMLInputElement;
        const selStart = input.selectionStart ?? (wordInfo?.offset ?? 0);
        const wordStart = selStart - word.length;
        if (wordStart >= 0) {
            input.setRangeText(replacement, wordStart, selStart, "end");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        }
    }

    // 2. Slate Editor via React Fiber
    const slateContainer = target.hasAttribute("data-slate-editor") ? target : target.closest('[data-slate-editor="true"]') as HTMLElement || target;
    const slateEditor = getSlateEditorFromElement(slateContainer);

    if (slateEditor && typeof slateEditor.deleteBackward === "function" && typeof slateEditor.insertText === "function") {
        try {
            for (let i = 0; i < word.length; i++) {
                slateEditor.deleteBackward("character");
            }
            slateEditor.insertText(replacement);
            return true;
        } catch {}
    }

    // 3. Selection.modify + execCommand
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        try {
            for (let i = 0; i < word.length; i++) {
                sel.modify("extend", "backward", "character");
            }
            document.execCommand("insertText", false, replacement);
            return true;
        } catch {}
    }

    // 4. Fallback DOM Range
    if (wordInfo?.node && wordInfo.offset !== undefined) {
        try {
            const node = wordInfo.node;
            const wordStart = wordInfo.offset - word.length;
            if (wordStart >= 0 && node.textContent && node.textContent.slice(wordStart, wordInfo.offset) === word) {
                const range = document.createRange();
                range.setStart(node, wordStart);
                range.setEnd(node, wordInfo.offset);
                if (sel) {
                    sel.removeAllRanges();
                    sel.addRange(range);
                    document.execCommand("insertText", false, replacement);
                    return true;
                }
            }
        } catch {}
    }

    return false;
}

function insertPlainSpace(target: HTMLElement) {
    const slateContainer = target.hasAttribute("data-slate-editor") ? target : target.closest('[data-slate-editor="true"]') as HTMLElement || target;
    const slateEditor = getSlateEditorFromElement(slateContainer);
    if (slateEditor && typeof slateEditor.insertText === "function") {
        try {
            slateEditor.insertText(" ");
            return;
        } catch {}
    }
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const start = target.selectionStart ?? 0;
        target.setRangeText(" ", start, start, "end");
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
    }
    document.execCommand("insertText", false, " ");
}

let isHandlingSpace = false;

async function onKeyDown(e: KeyboardEvent) {
    if (e.key !== " " && e.code !== "Space") return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.repeat) return;
    if (!settings.store.translateOnSpace) return;
    if (isHandlingSpace) return;

    const target = (e.target as HTMLElement) || (document.activeElement as HTMLElement | null);
    if (!target) return;

    const isTextbox =
        target.getAttribute?.("role") === "textbox" ||
        target.hasAttribute?.("data-slate-editor") ||
        target.closest?.('[role="textbox"]') != null ||
        target.closest?.('[data-slate-editor="true"]') != null ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement;
    if (!isTextbox) return;

    const wordInfo = getWordBeforeCursor(target);
    if (!wordInfo || !isWordEligible(wordInfo.word)) return;

    const word = wordInfo.word;
    const from = getEffectiveSourceLang(settings.store.sentInput, settings.store.sentOutput || "en");
    const to = settings.store.sentOutput || "en";
    if (from !== "auto" && from === to) return;

    // Prevent default Space insertion while we replace with translated word + space
    e.preventDefault();
    e.stopPropagation();

    const cacheKey = `${from}:${to}:${word.toLowerCase()}`;
    const cached = wordCache.get(cacheKey);

    if (cached && cached.toLowerCase() !== word.toLowerCase()) {
        const replacement = matchCasing(word, cached) + " ";
        replaceWordAtCursor(target, word, replacement, wordInfo);
        return;
    }

    isHandlingSpace = true;
    try {
        const translated = await Promise.race([
            fetchWordTranslation(word, from, to),
            new Promise<null>(r => setTimeout(() => r(null), 350))
        ]);

        if (translated && translated.toLowerCase() !== word.toLowerCase()) {
            const replacement = matchCasing(word, translated) + " ";
            replaceWordAtCursor(target, word, replacement, wordInfo);
        } else {
            insertPlainSpace(target);
        }
    } catch {
        insertPlainSpace(target);
    } finally {
        isHandlingSpace = false;
    }
}

function onInput(e: Event) {
    if (!settings.store.translateOnSpace) return;
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
        const target = (e.target as HTMLElement) || (document.activeElement as HTMLElement | null);
        if (!target) return;
        const wordInfo = getWordBeforeCursor(target);
        if (wordInfo && wordInfo.word.length >= 2 && isWordEligible(wordInfo.word)) {
            const from = getEffectiveSourceLang(settings.store.sentInput, settings.store.sentOutput || "en");
            const to = settings.store.sentOutput || "en";
            fetchWordTranslation(wordInfo.word, from, to);
        }
    }, 75);
}

export function initTranslateOnSpace() {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("input", onInput, true);
}

export function stopTranslateOnSpace() {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("input", onInput, true);
    clearTimeout(prefetchTimer);
    wordCache.clear();
    pendingTranslations.clear();
}
