/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy } from "@webpack";
import { settings } from "./settings";

const Transforms = findByPropsLazy("insertNodes", "textToText");
const Editor = findByPropsLazy("start", "end", "toSlateRange");

const wordCache = new Map<string, string>();
const recentlyReplaced = new Set<string>();
const pendingTranslations = new Map<string, Promise<string | null>>();

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

function addRecentlyReplaced(w: string) {
    recentlyReplaced.add(w.toLowerCase());
    if (recentlyReplaced.size > 500) {
        const oldest = recentlyReplaced.values().next().value;
        if (oldest) recentlyReplaced.delete(oldest);
    }
}

async function fetchWordTranslation(word: string, from: string, to: string): Promise<string | null> {
    const cacheKey = `${from}:${to}:${word.toLowerCase()}`;
    if (wordCache.has(cacheKey)) {
        return wordCache.get(cacheKey)!;
    }
    if (pendingTranslations.has(cacheKey)) {
        return await pendingTranslations.get(cacheKey)!;
    }

    const promise = (async () => {
        try {
            const sl = from === "auto" || !from ? "auto" : from;
            const tl = to || "en";
            const url = `https://clients5.google.com/translate_a/t?${new URLSearchParams({
                client: "dict-chrome-ex",
                sl,
                tl,
                q: word
            })}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                let text = "";
                if (Array.isArray(data)) {
                    text = data[0] || "";
                } else if (typeof data === "string") {
                    text = data;
                }
                if (text && typeof text === "string" && text.trim()) {
                    const clean = text.trim();
                    wordCache.set(cacheKey, clean);
                    return clean;
                }
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

function getSlateEditor(el: HTMLElement): any {
    const key = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (!key) return null;
    let fiber = (el as any)[key];
    while (fiber) {
        if (fiber.memoizedProps?.editor) return fiber.memoizedProps.editor;
        if (fiber.stateNode?.editor) return fiber.stateNode.editor;
        fiber = fiber.return;
    }
    return null;
}

function isWordEligible(word: string): boolean {
    if (!word || word.length < 1) return false;
    if (/^https?:\/\//i.test(word) || /^www\./i.test(word)) return false;
    if (word.startsWith("@") || word.startsWith("#") || word.startsWith("<@") || word.startsWith("<#")) return false;
    if (/^:[a-zA-Z0-9_+-]+:?$/.test(word)) return false;
    if (word.startsWith("/")) return false;
    if (!/[\p{L}\p{M}]/u.test(word)) return false;
    if (recentlyReplaced.has(word.toLowerCase())) return false;
    return true;
}

function handleSpaceOnSlate(slateEditor: any, e: KeyboardEvent, from: string, to: string): boolean {
    if (!slateEditor || !Transforms || !Editor) return false;
    const { selection } = slateEditor;
    if (!selection) return false;

    const isCollapsed =
        selection.anchor?.path?.join(",") === selection.focus?.path?.join(",") &&
        selection.anchor?.offset === selection.focus?.offset;
    if (!isCollapsed) return false;

    let node: any;
    try {
        const tuple = Editor.node(slateEditor, selection.anchor.path);
        node = tuple?.[0];
    } catch {
        return false;
    }
    if (!node || typeof node.text !== "string") return false;

    const offset = selection.anchor.offset;
    const textBefore = node.text.slice(0, offset);
    const match = textBefore.match(/([\p{L}\p{M}'-]+)$/u);
    if (!match) return false;

    const word = match[1];
    if (!isWordEligible(word)) return false;

    const wordStart = offset - word.length;
    const wordEnd = offset;
    const wordPath = [...selection.anchor.path];
    const wordRange = {
        anchor: { path: wordPath, offset: wordStart },
        focus: { path: wordPath, offset: wordEnd }
    };

    const cacheKey = `${from}:${to}:${word.toLowerCase()}`;
    const cached = wordCache.get(cacheKey);

    if (cached && cached.toLowerCase() !== word.toLowerCase()) {
        e.preventDefault();
        e.stopPropagation();
        const replacement = matchCasing(word, cached) + " ";
        Transforms.insertText(slateEditor, replacement, { at: wordRange });
        addRecentlyReplaced(cached);
        return true;
    }

    fetchWordTranslation(word, from, to).then(translated => {
        if (!translated || translated.toLowerCase() === word.toLowerCase()) {
            addRecentlyReplaced(word);
            return;
        }
        addRecentlyReplaced(translated);
        try {
            const [currentNode] = Editor.node(slateEditor, wordPath);
            if (currentNode && typeof currentNode.text === "string") {
                if (currentNode.text.slice(wordStart, wordEnd) === word) {
                    const replacement = matchCasing(word, translated);
                    Transforms.insertText(slateEditor, replacement, { at: wordRange });
                }
            }
        } catch {}
    });

    return false;
}

function handleSpaceOnInput(target: HTMLTextAreaElement | HTMLInputElement, e: KeyboardEvent, from: string, to: string): boolean {
    const val = target.value;
    const selStart = target.selectionStart ?? 0;
    const selEnd = target.selectionEnd ?? 0;
    if (selStart !== selEnd) return false;

    const textBefore = val.slice(0, selStart);
    const match = textBefore.match(/([\p{L}\p{M}'-]+)$/u);
    if (!match) return false;

    const word = match[1];
    if (!isWordEligible(word)) return false;

    const wordStart = selStart - word.length;
    const wordEnd = selStart;

    const cacheKey = `${from}:${to}:${word.toLowerCase()}`;
    const cached = wordCache.get(cacheKey);

    if (cached && cached.toLowerCase() !== word.toLowerCase()) {
        e.preventDefault();
        e.stopPropagation();
        const replacement = matchCasing(word, cached) + " ";
        target.setRangeText(replacement, wordStart, wordEnd, "end");
        target.dispatchEvent(new Event("input", { bubbles: true }));
        addRecentlyReplaced(cached);
        return true;
    }

    fetchWordTranslation(word, from, to).then(translated => {
        if (!translated || translated.toLowerCase() === word.toLowerCase()) {
            addRecentlyReplaced(word);
            return;
        }
        addRecentlyReplaced(translated);
        const currentVal = target.value;
        if (currentVal.slice(wordStart, wordEnd) === word) {
            const replacement = matchCasing(word, translated);
            const diff = replacement.length - word.length;
            const currentSel = target.selectionStart ?? 0;
            target.setRangeText(replacement, wordStart, wordEnd, "preserve");
            if (currentSel >= wordEnd) {
                target.setSelectionRange(currentSel + diff, currentSel + diff);
            }
            target.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });

    return false;
}

function handleSpaceOnDomContentEditable(target: HTMLElement, e: KeyboardEvent, from: string, to: string): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;

    const anchorNode = sel.anchorNode;
    if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE) return false;

    const textNode = anchorNode as Text;
    const offset = sel.anchorOffset;
    const textBefore = textNode.textContent?.slice(0, offset) || "";
    const match = textBefore.match(/([\p{L}\p{M}'-]+)$/u);
    if (!match) return false;

    const word = match[1];
    if (!isWordEligible(word)) return false;

    const wordStart = offset - word.length;
    const wordEnd = offset;

    const cacheKey = `${from}:${to}:${word.toLowerCase()}`;
    const cached = wordCache.get(cacheKey);

    if (cached && cached.toLowerCase() !== word.toLowerCase()) {
        e.preventDefault();
        e.stopPropagation();
        const replacement = matchCasing(word, cached) + " ";
        const range = document.createRange();
        range.setStart(textNode, wordStart);
        range.setEnd(textNode, wordEnd);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("insertText", false, replacement);
        addRecentlyReplaced(cached);
        return true;
    }

    fetchWordTranslation(word, from, to).then(translated => {
        if (!translated || translated.toLowerCase() === word.toLowerCase()) {
            addRecentlyReplaced(word);
            return;
        }
        addRecentlyReplaced(translated);
        if (textNode.textContent && textNode.textContent.slice(wordStart, wordEnd) === word) {
            const replacement = matchCasing(word, translated);
            const range = document.createRange();
            range.setStart(textNode, wordStart);
            range.setEnd(textNode, wordEnd);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("insertText", false, replacement);
        }
    });

    return false;
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key !== " " && e.code !== "Space") return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.repeat) return;
    if (!settings.store.translateOnSpace) return;

    const from = settings.store.sentInput || "auto";
    const to = settings.store.sentOutput || "en";
    if (from !== "auto" && from === to) return;

    const target = document.activeElement as HTMLElement | null;
    if (!target) return;

    const isTextbox =
        target.getAttribute("role") === "textbox" ||
        target.hasAttribute("data-slate-editor") ||
        target.closest('[role="textbox"]') != null ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement;
    if (!isTextbox) return;

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        handleSpaceOnInput(target, e, from, to);
        return;
    }

    const slateContainer = target.hasAttribute("data-slate-editor") ? target : target.closest('[data-slate-editor="true"]') as HTMLElement || target;
    const slateEditor = getSlateEditor(slateContainer);
    if (slateEditor) {
        const handled = handleSpaceOnSlate(slateEditor, e, from, to);
        if (handled) return;
    }

    handleSpaceOnDomContentEditable(target, e, from, to);
}

export function initTranslateOnSpace() {
    document.addEventListener("keydown", onKeyDown, true);
}

export function stopTranslateOnSpace() {
    document.removeEventListener("keydown", onKeyDown, true);
    wordCache.clear();
    recentlyReplaced.clear();
    pendingTranslations.clear();
}
