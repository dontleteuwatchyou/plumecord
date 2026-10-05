/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { React, showToast, Toasts, useEffect, useState } from "@webpack/common";

import { t } from "../autoTranslateNightcord";
import {
    clearAllSavedMessages,
    getSavedMessages,
    loadSavedMessages,
    Native,
    storeListeners
} from "./store";

function BookmarkIcon({ size = 22 }: { size?: number }) {
    return (
        <svg aria-hidden="true" role="img" width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path
                d="M19 21L12 16L5 21V5C5 3.89543 5.89543 3 7 3H17C18.1046 3 19 3.89543 19 5V21Z"
                fill="currentColor"
                opacity="0.15"
            />
            <path
                d="M19 21L12 16L5 21V5C5 3.89543 5.89543 3 7 3H17C18.1046 3 19 3.89543 19 5V21Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function FolderIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function TrashIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function SavedMessagesSettingsPanel() {
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        storeListeners.add(listener);
        loadSavedMessages();
        return () => { storeListeners.delete(listener); };
    }, []);

    const messagesCount = getSavedMessages().length;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 0" }}>
            {/* Header info banner */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "16px 20px",
                    background: "var(--background-secondary)",
                    borderRadius: 8,
                    border: "1px solid var(--background-tertiary)"
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        background: "rgba(88, 101, 242, 0.15)",
                        color: "var(--brand-500)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0
                    }}
                >
                    <BookmarkIcon size={24} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Heading level={3} style={{ margin: 0, color: "var(--header-primary)" }}>
                            {t("Saved Messages")}
                        </Heading>
                        <span
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                padding: "2px 8px",
                                borderRadius: 10,
                                background: "rgba(59, 165, 92, 0.2)",
                                color: "var(--text-positive, #23a55a)"
                            }}
                        >
                            {t("Active")}
                        </span>
                    </div>
                    <Paragraph size="sm" color="text-muted" style={{ margin: 0 }}>
                        {t("Telegram-style Saved Messages DM. All texts, links, and media files are stored locally on your PC. Zero server transit.")}
                    </Paragraph>
                </div>
            </div>

            {/* Storage management card */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    padding: "16px 20px",
                    background: "var(--background-secondary)",
                    borderRadius: 8,
                    border: "1px solid var(--background-tertiary)"
                }}
            >
                <div>
                    <BaseText size="sm" weight="semibold" color="header-primary">
                        {t("Local Storage Management")}
                    </BaseText>
                    <BaseText size="xs" color="text-muted" style={{ marginTop: 2 }}>
                        {t(`Currently holding ${messagesCount} saved message(s) locally on your disk.`)}
                    </BaseText>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={() => {
                            try { Native?.openStorageFolder?.(); } catch { }
                        }}
                    >
                        <FolderIcon />
                        {t("Open Storage Folder")}
                    </Button>

                    <Button
                        size="small"
                        variant="danger"
                        onClick={() => {
                            if (confirm(t("Are you sure you want to permanently clear all saved messages and media files?"))) {
                                clearAllSavedMessages();
                                showToast(t("All saved messages cleared."), Toasts.Type.SUCCESS);
                            }
                        }}
                    >
                        <TrashIcon />
                        {t("Clear All Saved Messages")}
                    </Button>
                </div>
            </div>
        </div>
    );
}
