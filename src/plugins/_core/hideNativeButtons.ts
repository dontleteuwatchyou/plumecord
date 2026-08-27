/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Settings } from "@api/Settings";

const ALWAYS_HIDE_STYLE_ID = "nightcord-always-hide-native-buttons";
const INBOX_HIDE_STYLE_ID = "nightcord-hide-inbox-button";

const ALWAYS_HIDE_CSS = `
/* ── Nightcord : suppression permanente des boutons natifs superflus ── */
[aria-label="Open Logs"],
[aria-label="Help"],
[aria-label="Aide"],
[aria-label="DevTools"],
[aria-label="Last Meadow Online"],
div[role="button"][aria-label="Help"],
div[role="button"][aria-label="Aide"],
div[role="button"][aria-label="Open Logs"],
div[role="button"][aria-label="DevTools"] {
    display: none !important;
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    flex: none !important;
}
`;

const INBOX_HIDE_CSS = `
/* ── Nightcord : masquage optionnel du bouton Boîte de réception ── */
div[role="button"][aria-label="Inbox"],
div[role="button"][aria-label="Boîte de réception"],
div[role="button"][aria-label="Bandeja de entrada"],
div[role="button"][aria-label="Posteingang"],
div[role="button"][aria-label="Входящие"],
div[role="button"][aria-label*="Inbox" i],
div[role="button"][aria-label*="réception" i] {
    display: none !important;
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    flex: none !important;
}
`;

function ensureAlwaysHidden() {
    if (typeof document === "undefined") return;
    if (!document.getElementById(ALWAYS_HIDE_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = ALWAYS_HIDE_STYLE_ID;
        style.textContent = ALWAYS_HIDE_CSS;
        document.head.appendChild(style);
    }
}

export function updateNativeButtonsVisibility(hide?: boolean) {
    ensureAlwaysHidden();
    const shouldHide = hide ?? (Settings.hideNativeHeaderButtons ?? true);
    const existing = document.getElementById(INBOX_HIDE_STYLE_ID);
    if (shouldHide) {
        if (!existing) {
            const style = document.createElement("style");
            style.id = INBOX_HIDE_STYLE_ID;
            style.textContent = INBOX_HIDE_CSS;
            document.head.appendChild(style);
        }
    } else {
        existing?.remove();
    }
}

export default definePlugin({
    name: "HideNativeButtons",
    description: "Hides unwanted native Discord buttons (Inbox, Help, Logs)",
    authors: [Devs.Ven],
    required: true,
    patches: [],

    start() {
        ensureAlwaysHidden();
        updateNativeButtonsVisibility();
    },

    stop() {
        document.getElementById(ALWAYS_HIDE_STYLE_ID)?.remove();
        document.getElementById(INBOX_HIDE_STYLE_ID)?.remove();
    },
});
