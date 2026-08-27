/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Settings } from "@api/Settings";

const STYLE_ID = "nightcord-hide-native-buttons";

const CSS = `
/* ── Nightcord : suppression boutons natifs Discord non désirés ── */
[aria-label="Open Logs"],
[aria-label="Help"],
[aria-label="Aide"],
[aria-label="DevTools"],
[aria-label="Last Meadow Online"],
[aria-label="Inbox"],
[aria-label="Boîte de réception"],
[aria-label="Bandeja de entrada"],
[aria-label="Posteingang"],
[aria-label="Входящие"] {
    display: none !important;
    width: 0 !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    flex: none !important;
}
`;

export function updateNativeButtonsVisibility(hide?: boolean) {
    const shouldHide = hide ?? (Settings.hideNativeHeaderButtons ?? true);
    const existing = document.getElementById(STYLE_ID);
    if (shouldHide) {
        if (!existing) {
            const style = document.createElement("style");
            style.id = STYLE_ID;
            style.textContent = CSS;
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
        updateNativeButtonsVisibility();
    },

    stop() {
        document.getElementById(STYLE_ID)?.remove();
    },
});
