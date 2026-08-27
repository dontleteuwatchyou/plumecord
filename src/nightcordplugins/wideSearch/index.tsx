/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React } from "@webpack/common";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { t } from "../autoTranslateNightcord";
import "./styles.css";

const settings = definePluginSettings({
    searchWidth: {
        description: "Custom width for the search results panel (in pixels).",
        type: OptionType.SLIDER,
        markers: [600, 750, 960, 1150, 1300],
        default: 960,
        restartNeeded: false,
        onChange: (val) => {
            document.documentElement.style.setProperty("--nc-wide-search-width", `${val}px`);
        }
    },
    popoutMode: {
        description: "Display search results as a large centered popout modal over chat instead of a sidebar.",
        type: OptionType.BOOLEAN,
        default: false,
        restartNeeded: false,
        onChange: (val) => {
            updateClasses(val);
        }
    },
    enlargeMedia: {
        description: "Automatically expand videos and images in search results to full size.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    }
});

function updateClasses(popoutMode?: boolean) {
    if (typeof document === "undefined") return;

    document.documentElement.classList.add("nc-wide-search");
    document.documentElement.style.setProperty("--nc-wide-search-width", `${settings.store.searchWidth || 960}px`);

    const isPopout = popoutMode !== undefined ? popoutMode : settings.store.popoutMode;
    if (isPopout) {
        document.documentElement.classList.add("nc-wide-search-popout");
    } else {
        document.documentElement.classList.remove("nc-wide-search-popout");
    }
}

function WideSearchSettingsComponent() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const isPopout = settings.store.popoutMode;
    const width = settings.store.searchWidth || 960;

    return (
        <div style={{ width: "100%", marginTop: "10px" }}>
            <Card variant="primary" outline style={{ padding: "16px", background: "var(--background-secondary, #2b2d31)", borderRadius: "8px", marginBottom: "16px" }}>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <div>
                        <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "14px", display: "block" }}>
                            {t("Wide Search Panel Mode")}
                        </span>
                        <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px" }}>
                            {isPopout
                                ? t("Centered Popout Modal (Overlay Mode)")
                                : `${t("Expanded Wide Sidebar")} (${width}px)`}
                        </span>
                    </div>
                    <Button
                        variant={isPopout ? "primary" : "secondary"}
                        onClick={() => {
                            const next = !settings.store.popoutMode;
                            settings.store.popoutMode = next;
                            updateClasses(next);
                            forceUpdate();
                        }}
                    >
                        {isPopout ? t("Switch to Wide Sidebar") : t("Switch to Centered Popout")}
                    </Button>
                </Flex>
            </Card>
        </div>
    );
}

export default definePlugin({
    name: "WideSearch",
    description: "Transforms the cramped Discord search panel into a spacious, wide popout view to easily browse videos, images, links, and messages.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: WideSearchSettingsComponent,

    start() {
        updateClasses();
    },

    stop() {
        if (typeof document !== "undefined") {
            document.documentElement.classList.remove("nc-wide-search");
            document.documentElement.classList.remove("nc-wide-search-popout");
            document.documentElement.style.removeProperty("--nc-wide-search-width");
        }
    }
});
