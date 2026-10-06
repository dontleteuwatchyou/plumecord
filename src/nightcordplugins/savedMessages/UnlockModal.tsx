/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { closeModal, openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { Button, Modal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, React, TextInput, useState } from "@webpack/common";

import { t } from "../autoTranslateNightcord";
import { checkVaultStatus, isVaultPasswordSet, Native, unlockVault } from "./store";

function LockIcon() {
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M17 9V7a5 5 0 0 0-10 0v2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2Zm-8-2a3 3 0 1 1 6 0v2H9V7Zm3 6a1.5 1.5 0 0 0-.75 2.8v2.4a.75.75 0 0 0 1.5 0v-2.4A1.5 1.5 0 0 0 12 13Z"
            />
        </svg>
    );
}

let activeModalKey: string | null = null;

export function closeSavedMessagesUnlockModal(): void {
    if (activeModalKey) {
        try { closeModal(activeModalKey); } catch { }
        activeModalKey = null;
    }
}

interface UnlockModalProps {
    modalProps: RenderModalProps;
    onSuccess?: () => void;
}

function UnlockModalInner({ modalProps, onSuccess }: UnlockModalProps) {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const isFirstTime = !isVaultPasswordSet();

    const handleUnlock = async () => {
        if (!password) {
            setError(t("Password cannot be empty."));
            return;
        }

        if (isFirstTime && password !== confirmPassword) {
            setError(t("Passwords do not match."));
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await unlockVault(password);
            closeSavedMessagesUnlockModal();
            if (onSuccess) onSuccess();
        } catch (e: any) {
            setError(e?.message || t("Incorrect password or corrupted vault."));
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !loading) {
            handleUnlock();
        }
    };

    return (
        <Modal
            {...modalProps}
            className="nc-saved-messages-modal"
        >
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ color: "var(--brand-500)", display: "flex", alignItems: "center" }}>
                        <LockIcon />
                    </div>
                    <div>
                        <BaseText tag="h2" size="lg" weight="bold" color="header-primary">
                            {isFirstTime ? t("Set Master Password") : t("Unlock Saved Messages")}
                        </BaseText>
                        <BaseText size="sm" color="text-muted">
                            {isFirstTime
                                ? t("Create a master password to encrypt your local messages.")
                                : t("Enter your master password to decrypt your saved messages.")}
                        </BaseText>
                    </div>
                </div>
                <ModalCloseButton onClick={closeSavedMessagesUnlockModal} />
            </ModalHeader>

            <ModalContent style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                        <BaseText size="xs" weight="bold" color="header-secondary" style={{ textTransform: "uppercase", marginBottom: 6 }}>
                            {t("Master Password")}
                        </BaseText>
                        <TextInput
                            value={password}
                            onChange={setPassword}
                            placeholder={t("Enter your password…")}
                            type="password"
                            autoFocus
                            onKeyDown={handleKeyDown}
                        />
                    </div>

                    {isFirstTime && (
                        <div>
                            <BaseText size="xs" weight="bold" color="header-secondary" style={{ textTransform: "uppercase", marginBottom: 6 }}>
                                {t("Confirm Password")}
                            </BaseText>
                            <TextInput
                                value={confirmPassword}
                                onChange={setConfirmPassword}
                                placeholder={t("Confirm your password…")}
                                type="password"
                                onKeyDown={handleKeyDown}
                            />
                        </div>
                    )}

                    {error && (
                        <div style={{ padding: "8px 12px", background: "var(--status-danger-background)", borderRadius: 6 }}>
                            <BaseText size="sm" color="text-danger" weight="medium">
                                {error}
                            </BaseText>
                        </div>
                    )}

                    <div style={{ padding: "10px 14px", background: "var(--background-secondary)", borderRadius: 6, borderLeft: "3px solid var(--brand-500)" }}>
                        <BaseText size="xs" color="text-muted">
                            {t("All messages and files are encrypted with AES-256-GCM + ChaCha20-Poly1305 and stored exclusively on your PC disk. Nothing is ever sent to Discord.")}
                        </BaseText>
                    </div>
                </div>
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <Button
                        variant="secondary"
                        size="small"
                        onClick={() => {
                            try { Native?.openStorageFolder?.(); } catch { }
                        }}
                    >
                        {t("Open Folder")}
                    </Button>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Button
                            variant="secondary"
                            onClick={closeSavedMessagesUnlockModal}
                        >
                            {t("Cancel")}
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleUnlock}
                            disabled={!password || loading}
                        >
                            {loading ? t("Decrypting…") : (isFirstTime ? t("Save Password") : t("Unlock"))}
                        </Button>
                    </div>
                </div>
            </ModalFooter>
        </Modal>
    );
}

const UnlockModalComponent = ErrorBoundary.wrap(UnlockModalInner, { noop: true });

export function openSavedMessagesUnlockModal(onSuccess?: () => void): void {
    closeSavedMessagesUnlockModal();
    checkVaultStatus().then(() => {
        const key = openModal(props => (
            <UnlockModalComponent
                modalProps={{
                    ...props,
                    onClose: () => {
                        activeModalKey = null;
                        try { props.onClose(); } catch { }
                    }
                }}
                onSuccess={() => {
                    closeSavedMessagesUnlockModal();
                    if (onSuccess) onSuccess();
                }}
            />
        ));
        activeModalKey = key;
    });
}
