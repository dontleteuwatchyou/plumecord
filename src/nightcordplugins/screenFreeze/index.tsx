/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, ReactDOM } from "@webpack/common";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { screenFreezeEngine } from "./engine";
import { ScreenFreezeFloatingIndicator } from "./indicator";
import { ScreenFreezeState } from "./types";
import { t } from "../autoTranslateNightcord";

const validKeycodes = [
    "Backspace", "Tab", "Enter", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "Pause", "CapsLock",
    "Escape", "Space", "PageUp", "PageDown", "End", "Home", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "PrintScreen", "Insert",
    "Delete", "Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "KeyA", "KeyB", "KeyC",
    "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ", "KeyK", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR", "KeyS", "KeyT",
    "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"
];

const settings = definePluginSettings({
    keyBind: {
        description: "The key code to toggle screenshare freeze when pressed.",
        type: OptionType.STRING,
        default: "KeyF",
        isValid: (value: string) => validKeycodes.includes(value),
        restartNeeded: false
    },
    reqCtrl: {
        description: "Require Control (Ctrl) key to be held.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    },
    reqShift: {
        description: "Require Shift key to be held.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    },
    reqAlt: {
        description: "Require Alt key to be held.",
        type: OptionType.BOOLEAN,
        default: false,
        restartNeeded: false
    },
    showFloatingIndicator: {
        description: "Display a floating alert banner on screen while frozen.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    }
});

function getKeyComboString(): string {
    const parts: string[] = [];
    if (settings.store.reqCtrl) parts.push("Ctrl");
    if (settings.store.reqShift) parts.push("Shift");
    if (settings.store.reqAlt) parts.push("Alt");
    const rawKey = settings.store.keyBind || "KeyF";
    const cleanKey = rawKey.replace(/^Key|^Digit/, "");
    parts.push(cleanKey);
    return parts.join(" + ");
}

let indicatorContainer: HTMLDivElement | null = null;

function mountIndicator() {
    if (indicatorContainer || typeof document === "undefined") return;
    indicatorContainer = document.createElement("div");
    indicatorContainer.id = "nc-screen-freeze-indicator-root";
    document.body.appendChild(indicatorContainer);
    ReactDOM.render(<ScreenFreezeFloatingIndicator keyComboText={getKeyComboString()} />, indicatorContainer);
}

function unmountIndicator() {
    if (indicatorContainer) {
        ReactDOM.unmountComponentAtNode(indicatorContainer);
        indicatorContainer.remove();
        indicatorContainer = null;
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (settings.store.reqCtrl && !e.ctrlKey) return;
    if (settings.store.reqShift && !e.shiftKey) return;
    if (settings.store.reqAlt && !e.altKey) return;

    if (e.code === (settings.store.keyBind || "KeyF")) {
        e.preventDefault();
        e.stopPropagation();
        screenFreezeEngine.toggleFreeze();
    }
}

function ScreenFreezeSettingsComponent() {
    const [state, setState] = React.useState<ScreenFreezeState>(() => screenFreezeEngine.getState());

    React.useEffect(() => {
        const unsub = screenFreezeEngine.subscribe(setState);
        return () => unsub();
    }, []);

    const keyText = getKeyComboString();

    return (
        <div style={{ width: "100%", marginTop: "10px" }}>
            <Card
                variant="primary"
                outline
                style={{
                    padding: "16px",
                    background: state.isFrozen ? "rgba(240, 71, 71, 0.15)" : "var(--background-secondary, #2b2d31)",
                    borderRadius: "8px",
                    border: state.isFrozen ? "1px solid rgba(240, 71, 71, 0.5)" : undefined,
                    marginBottom: "16px"
                }}
            >
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <div>
                        <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "14px", display: "block" }}>
                            {t("Emergency Screen Freeze")}
                        </span>
                        <span style={{ color: state.isFrozen ? "var(--status-danger, #f04747)" : "var(--text-muted, #949ba4)", fontSize: "12px", fontWeight: state.isFrozen ? 600 : 400 }}>
                            {state.isFrozen
                                ? `● ${t("FROZEN ON STATIC FRAME")} (${t("Viewers cannot see your live screen")})`
                                : `○ ${t("LIVE STREAMING READY")} (${t("Shortcut:")} ${keyText})`}
                        </span>
                    </div>
                    <Button
                        variant={state.isFrozen ? "positive" : "dangerPrimary"}
                        onClick={() => screenFreezeEngine.toggleFreeze()}
                    >
                        {state.isFrozen ? t("Unfreeze Stream") : t("Freeze Screen Now")}
                    </Button>
                </Flex>
            </Card>
        </div>
    );
}

export default definePlugin({
    name: "ScreenFreeze",
    description: "Emergency panic shortcut that instantly freezes your Discord screenshare on a static image until pressed again.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: ScreenFreezeSettingsComponent,

    start() {
        screenFreezeEngine.startPatch();
        document.addEventListener("keydown", handleKeydown, true);
        if (settings.store.showFloatingIndicator !== false) {
            mountIndicator();
        }
    },

    stop() {
        screenFreezeEngine.stopPatch();
        document.removeEventListener("keydown", handleKeydown, true);
        unmountIndicator();
    }
});
