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
import { openSavedMessagesChangePasswordModal } from "./ChangePasswordModal";
import {
    checkVaultStatus,
    clearAllSavedMessages,
    getDecryptedMessages,
    isVaultPasswordSet,
    isVaultUnlocked,
    lockVault,
    Native,
    storeListeners
} from "./store";
import { openSavedMessagesUnlockModal } from "./UnlockModal";

function LockShieldIcon({ size = 22 }: { size?: number }) {
    return (
        <svg aria-hidden="true" role="img" width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path
                d="M12 2L4 5V11.09C4 16.14 7.41 20.85 12 22C16.59 20.85 20 16.14 20 11.09V5L12 2Z"
                fill="currentColor"
                opacity="0.15"
            />
            <path
                d="M12 2L4 5V11.09C4 16.14 7.41 20.85 12 22C16.59 20.85 20 16.14 20 11.09V5L12 2Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M12 8V12M12 16H12.01"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}

function KeyIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <path d="M21 2l-2 2m-1.5 1.5L14 9a5 5 0 1 0 4 4l3.5-3.5a1 1 0 0 0 0-1.41l-2.09-2.09a1 1 0 0 0-1.41 0L17 7m-3.5 3.5l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
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
        checkVaultStatus();
        return () => { storeListeners.delete(listener); };
    }, []);

    const unlocked = isVaultUnlocked();
    const hasPassword = isVaultPasswordSet();
    const messagesCount = unlocked ? getDecryptedMessages().length : 0;

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
                        background: unlocked ? "rgba(88, 101, 242, 0.15)" : "rgba(237, 66, 69, 0.15)",
                        color: unlocked ? "var(--brand-500)" : "var(--text-danger)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0
                    }}
                >
                    <LockShieldIcon size={24} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Heading level={3} style={{ margin: 0, color: "var(--header-primary)" }}>
                            {t("Saved Messages Vault")}
                        </Heading>
                        <span
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                padding: "2px 8px",
                                borderRadius: 10,
                                background: unlocked ? "rgba(59, 165, 92, 0.2)" : "rgba(237, 66, 69, 0.2)",
                                color: unlocked ? "var(--text-positive, #23a55a)" : "var(--text-danger, #ed4245)"
                            }}
                        >
                            {unlocked ? t("Unlocked") : (hasPassword ? t("Locked") : t("Not Initialized"))}
                        </span>
                    </div>
                    <Paragraph size="sm" color="text-muted" style={{ margin: 0 }}>
                        {t("Dual-layer military encryption (AES-256-GCM + ChaCha20-Poly1305) with PBKDF2/Argon2 key derivation. All texts and files stay 100% local on your PC disk.")}
                    </Paragraph>
                </div>
            </div>

            {/* Quick security settings */}
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
                        {t("Master Password & Encryption")}
                    </BaseText>
                    <BaseText size="xs" color="text-muted" style={{ marginTop: 2 }}>
                        {hasPassword
                            ? t("You can change your master password at any time. All stored messages and media files will be automatically re-encrypted with your new key.")
                            : t("No master password set yet. Click below or open the Saved Messages DM to set your master password.")}
                    </BaseText>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
                    <Button
                        size="small"
                        variant="primary"
                        onClick={() => openSavedMessagesChangePasswordModal()}
                    >
                        <KeyIcon />
                        {hasPassword ? t("Change Master Password") : t("Set Master Password")}
                    </Button>

                    {hasPassword && (
                        unlocked ? (
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => {
                                    lockVault();
                                    showToast(t("Saved Messages vault locked."), Toasts.Type.INFO);
                                }}
                            >
                                {t("Lock Vault")}
                            </Button>
                        ) : (
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => openSavedMessagesUnlockModal()}
                            >
                                {t("Unlock Vault")}
                            </Button>
                        )
                    )}

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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                        <BaseText size="sm" weight="semibold" color="header-primary">
                            {t("Local Storage Management")}
                        </BaseText>
                        <BaseText size="xs" color="text-muted" style={{ marginTop: 2 }}>
                            {unlocked
                                ? t(`Currently holding ${messagesCount} saved message(s) locally.`)
                                : t("Unlock vault to view storage statistics and manage messages.")}
                        </BaseText>
                    </div>

                    {unlocked && (
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
                    )}
                </div>
            </div>
        </div>
    );
}
