/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { closeModal, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, FluxDispatcher, React } from "@webpack/common";

import { t } from "../autoTranslateNightcord";
import { GlobalDMSearchModal } from "./SearchModal";

function SearchIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
                clipRule="evenodd"
            />
        </svg>
    );
}

let activeModalKey: string | null = null;

export function openGlobalDMSearchModal(initialQuery = "") {
    if (activeModalKey) {
        closeModal(activeModalKey);
        activeModalKey = null;
    }
    activeModalKey = openModal((props) => (
        <GlobalDMSearchModal
            modalProps={props}
            initialQuery={initialQuery}
            onClose={() => {
                if (activeModalKey) {
                    closeModal(activeModalKey);
                    activeModalKey = null;
                }
            }}
        />
    ));
}

function applySearchExperiments(enable: boolean) {
    const bucket = enable ? 1 : 0;
    const experiments = [
        "2023-08_dms_search",
        "2023-09_search_all_dms",
        "2024-02_cross_dm_search",
        "2024-06_dm_search",
    ];

    for (const expId of experiments) {
        try {
            FluxDispatcher.dispatch({
                type: "EXPERIMENT_OVERRIDE_BUCKET",
                experimentId: expId,
                experimentBucket: bucket,
            });
        } catch {}
    }
}

export const settings = definePluginSettings({
    includeClosedDMs: {
        type: OptionType.BOOLEAN,
        description: "Include closed and past DMs in search",
        default: true,
    },
    includeGroupDMs: {
        type: OptionType.BOOLEAN,
        description: "Include Group DMs in search",
        default: true,
    },
    searchLimitPerDM: {
        type: OptionType.NUMBER,
        description: "Maximum matching messages to fetch per DM channel",
        default: 5,
    },
    overrideNativeExperiments: {
        type: OptionType.BOOLEAN,
        description: "Override Discord search experiments (Option A)",
        default: true,
        onChange: (val: boolean) => applySearchExperiments(val),
    },
    openSearchModal: {
        type: OptionType.COMPONENT,
        description: "Open Global DM Search",
        component: () => (
            <Button
                color={Button.Colors.BRAND}
                onClick={() => openGlobalDMSearchModal()}
            >
                {t("Open Global DM Search")}
            </Button>
        ),
    },
});

function GlobalDMSearchHeaderButton() {
    return (
        <HeaderBarButton
            icon={SearchIcon}
            tooltip={t("Global DM Search")}
            onClick={() => openGlobalDMSearchModal()}
        />
    );
}

let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

export default definePlugin({
    name: "GlobalDMSearch",
    description: "Search messages across all your Direct Messages and Group DMs on PC, with native Discord experiment support.",
    authors: [{ name: "Nightcord", id: 0n }],
    enabledByDefault: false,
    settings,

    start() {
        if (settings.store.overrideNativeExperiments) {
            applySearchExperiments(true);
        }

        // Add button to top header bar
        addHeaderBarButton("nightcord-global-dm-search", () => <GlobalDMSearchHeaderButton />, 8);

        // Shortcut: Ctrl + Shift + F (or Cmd + Shift + F)
        keydownHandler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
                const target = e.target as HTMLElement | null;
                const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
                // If not typing in a content input or if user explicitly presses the combo
                if (!isInput) {
                    e.preventDefault();
                    openGlobalDMSearchModal();
                }
            }
        };

        window.addEventListener("keydown", keydownHandler);
    },

    stop() {
        if (keydownHandler) {
            window.removeEventListener("keydown", keydownHandler);
            keydownHandler = null;
        }

        removeHeaderBarButton("nightcord-global-dm-search");

        if (settings.store.overrideNativeExperiments) {
            applySearchExperiments(false);
        }

        if (activeModalKey) {
            closeModal(activeModalKey);
            activeModalKey = null;
        }
    },
});
