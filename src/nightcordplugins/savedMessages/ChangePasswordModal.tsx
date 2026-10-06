/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { closeModal, openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { Button, Modal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, React, showToast, TextInput, Toasts, useState } from "@webpack/common";

import { t } from "../autoTranslateNightcord";
import { changeVaultPassword, isVaultPasswordSet } from "./store";

function KeyIcon() {
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M14 2a8 8 0 0 0-7.84 6.43L2 12.59V17h4v2h2v2h4v-3.41l1.57-1.57A8 8 0 1 0 14 2Zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
                fill="currentColor"
            />
        </svg>
    );
}

let activeChangePasswordModalKey: string | null = null;

export function closeSavedMessagesChangePasswordModal(): void {
    if (!activeChangePasswordModalKey) return;
    try { closeModal(activeChangePasswordModalKey); } catch { }
    activeChangePasswordModalKey = null;
}

interface ChangePasswordModalProps {
    modalProps: RenderModalProps;
    onSuccess?: () => void;
}

function ChangePasswordModalInner({ modalProps, onSuccess }: ChangePasswordModalProps) {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmNewPassword, setConfirmNewPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const hasPasswordSet = isVaultPasswordSet();

    const handleSubmit = async () => {
        if (hasPasswordSet && !currentPassword) {
            setError(t("Current password cannot be empty."));
            return;
        }

        if (!newPassword) {
            setError(t("New password cannot be empty."));
            return;
        }

        if (newPassword !== confirmNewPassword) {
            setError(t("New passwords do not match."));
            return;
        }

        if (hasPasswordSet && currentPassword === newPassword) {
            setError(t("New password must be different from current password."));
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await changeVaultPassword(currentPassword, newPassword);
            showToast(t("Master password successfully changed."), Toasts.Type.SUCCESS);
            closeSavedMessagesChangePasswordModal();
            if (onSuccess) onSuccess();
        } catch (e: any) {
            setError(e?.message || t("Incorrect current password or failed to change password."));
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !loading) {
            handleSubmit();
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
                        <KeyIcon />
                    </div>
                    <div>
                        <BaseText tag="h2" size="lg" weight="bold" color="header-primary">
                            {t("Change Master Password")}
                        </BaseText>
                        <BaseText size="sm" color="text-muted">
                            {t("Update the encryption key used for your Saved Messages vault.")}
                        </BaseText>
                    </div>
                </div>
                <ModalCloseButton onClick={closeSavedMessagesChangePasswordModal} />
            </ModalHeader>

            <ModalContent style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {hasPasswordSet && (
                        <div>
                            <BaseText size="xs" weight="bold" color="header-secondary" style={{ textTransform: "uppercase", marginBottom: 6 }}>
                                {t("Current Password")}
                            </BaseText>
                            <TextInput
                                value={currentPassword}
                                onChange={setCurrentPassword}
                                placeholder={t("Enter current password…")}
                                type="password"
                                autoFocus
                                onKeyDown={handleKeyDown}
                            />
                        </div>
                    )}

                    <div>
                        <BaseText size="xs" weight="bold" color="header-secondary" style={{ textTransform: "uppercase", marginBottom: 6 }}>
                            {t("New Password")}
                        </BaseText>
                        <TextInput
                            value={newPassword}
                            onChange={setNewPassword}
                            placeholder={t("Enter new password…")}
                            type="password"
                            autoFocus={!hasPasswordSet}
                            onKeyDown={handleKeyDown}
                        />
                    </div>

                    <div>
                        <BaseText size="xs" weight="bold" color="header-secondary" style={{ textTransform: "uppercase", marginBottom: 6 }}>
                            {t("Confirm New Password")}
                        </BaseText>
                        <TextInput
                            value={confirmNewPassword}
                            onChange={setConfirmNewPassword}
                            placeholder={t("Confirm new password…")}
                            type="password"
                            onKeyDown={handleKeyDown}
                        />
                    </div>

                    {error && (
                        <div style={{ padding: "8px 12px", background: "var(--status-danger-background)", borderRadius: 6 }}>
                            <BaseText size="sm" color="text-danger" weight="medium">
                                {error}
                            </BaseText>
                        </div>
                    )}

                    <div style={{ padding: "10px 14px", background: "var(--background-secondary)", borderRadius: 6, borderLeft: "3px solid var(--brand-500)" }}>
                        <BaseText size="xs" color="text-muted">
                            {t("Re-encrypts all locally stored messages and attachments with your new password using dual-layer AES-256-GCM + ChaCha20-Poly1305.")}
                        </BaseText>
                    </div>
                </div>
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", gap: 8 }}>
                    <Button
                        variant="secondary"
                        onClick={closeSavedMessagesChangePasswordModal}
                    >
                        {t("Cancel")}
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={!newPassword || !confirmNewPassword || (hasPasswordSet && !currentPassword) || loading}
                    >
                        {loading ? t("Re-encrypting…") : t("Change Password")}
                    </Button>
                </div>
            </ModalFooter>
        </Modal>
    );
}

const ChangePasswordModalComponent = ErrorBoundary.wrap(ChangePasswordModalInner, { noop: true });

export function openSavedMessagesChangePasswordModal(onSuccess?: () => void): void {
    closeSavedMessagesChangePasswordModal();
    const key = openModal(props => (
        <ChangePasswordModalComponent
            modalProps={{
                ...props,
                onClose: () => {
                    activeChangePasswordModalKey = null;
                    try { props.onClose(); } catch { }
                }
            }}
            onSuccess={() => {
                closeSavedMessagesChangePasswordModal();
                if (onSuccess) onSuccess();
            }}
        />
    ));
    activeChangePasswordModalKey = key;
}
