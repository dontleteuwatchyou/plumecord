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
    getSavedMessages,
    isVaultPasswordSet,
    isVaultUnlocked,
    lockVault,
    Native,
    storeListeners
} from "./store";
import { openSavedMessagesUnlockModal } from "./UnlockModal";

function LockIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
    );
}

function UnlockIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
    );
}

function KeyIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <path d="M21 2l-2 2m-1.5 1.5L14 9a5 5 0 1 0-4 4l1.5-1.5m6.5-6.5l2 2m-2-2L15 7m2 2l-2-2" />
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

function ShieldCheckIcon({ size = 24 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
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

    const hasPassword = isVaultPasswordSet();
    const isUnlocked = isVaultUnlocked();
    const messagesCount = isUnlocked ? getSavedMessages().length : null;

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
                    <ShieldCheckIcon size={24} />
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
                                background: isUnlocked
                                    ? "rgba(59, 165, 92, 0.2)"
                                    : hasPassword
                                        ? "rgba(240, 178, 50, 0.2)"
                                        : "rgba(128, 132, 142, 0.2)",
                                color: isUnlocked
                                    ? "var(--text-positive, #23a55a)"
                                    : hasPassword
                                        ? "var(--text-warning, #f0b232)"
                                        : "var(--text-muted, #80848e)"
                            }}
                        >
                            {isUnlocked
                                ? t("Unlocked")
                                : hasPassword
                                    ? t("Locked")
                                    : t("Not Initialized")}
                        </span>
                    </div>
                    <Paragraph size="sm" color="text-muted" style={{ margin: 0 }}>
                        {t("Dual-layer military encryption (AES-256-GCM + ChaCha20-Poly1305) with PBKDF2/Argon2 key derivation. All texts and files stay 100% local on your PC disk.")}
                    </Paragraph>
                </div>
            </div>

            {/* Password & Security Actions */}
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
                    {isUnlocked ? (
                        <>
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => openSavedMessagesChangePasswordModal()}
                            >
                                <KeyIcon />
                                {t("Change Master Password")}
                            </Button>
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => {
                                    lockVault();
                                    showToast(t("Saved Messages vault locked."), Toasts.Type.INFO);
                                }}
                            >
                                <LockIcon />
                                {t("Lock Vault")}
                            </Button>
                        </>
                    ) : (
                        <Button
                            size="small"
                            variant="primary"
                            onClick={() => openSavedMessagesUnlockModal()}
                        >
                            <UnlockIcon />
                            {hasPassword ? t("Unlock Vault") : t("Set Master Password")}
                        </Button>
                    )}
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
                        {isUnlocked
                            ? t(`Currently holding ${messagesCount} saved message(s) locally on your disk.`)
                            : t("Unlock vault to view storage statistics and manage messages.")}
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

                    {isUnlocked && (
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
