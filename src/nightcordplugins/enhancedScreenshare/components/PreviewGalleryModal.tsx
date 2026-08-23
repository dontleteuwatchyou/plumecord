/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { classNameFactory } from "@utils/css";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize } from "@utils/modal";
import { RenderModalProps } from "@vencord/discord-types";
import { closeModal, openModal, React, Select, Text, TextInput, useEffect, useRef, useState } from "@webpack/common";

import {
    activeProfileId,
    actualStreamImageUri,
    DEFAULT_PROFILE_ID,
    getActiveProfile,
    MAX_FILE_SIZE,
    MediaItem,
    notifyPreviewChanges,
    processFile,
    profiles,
    saveProfiles,
    setActiveProfileId,
    subscribePreviewChanges
} from "../previewStore";

const cl = classNameFactory("nc-stream-preview-");

export interface PreviewSettingsState {
    replaceEnabled: boolean;
    slideshowEnabled: boolean;
    slideshowRandom: boolean;
}

export const previewSettingsState: PreviewSettingsState = {
    replaceEnabled: true,
    slideshowEnabled: false,
    slideshowRandom: false
};

function PreviewGalleryModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [, setTick] = useState(0);
    const [replaceOn, setReplaceOn] = useState(previewSettingsState.replaceEnabled);
    const [slideshowOn, setSlideshowOn] = useState(previewSettingsState.slideshowEnabled);
    const [randomOn, setRandomOn] = useState(previewSettingsState.slideshowRandom);
    const [isCreatingProfile, setIsCreatingProfile] = useState(false);
    const [newProfileName, setNewProfileName] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        return subscribePreviewChanges(() => setTick(t => t + 1));
    }, []);

    const activeProfile = getActiveProfile();

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setIsProcessing(true);
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.size > MAX_FILE_SIZE) continue;
                const item = await processFile(file);
                activeProfile.items.push(item);
            }
            activeProfile.currentIndex = Math.max(0, activeProfile.items.length - 1);
            await saveProfiles();
            notifyPreviewChanges();
        } catch (e) {
            console.error("[EnhancedScreenshare] Error adding preview:", e);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSelectProfile = (profileId: string) => {
        const p = profiles.get(profileId);
        if (p) {
            setActiveProfileId(profileId);
            void saveProfiles();
            notifyPreviewChanges();
            setTick(t => t + 1);
        }
    };

    const handleCreateProfile = async () => {
        if (!newProfileName.trim()) return;
        const newId = `profile_${Date.now()}`;
        profiles.set(newId, {
            id: newId,
            name: newProfileName.trim(),
            items: [],
            currentIndex: 0
        });
        setActiveProfileId(newId);
        setIsCreatingProfile(false);
        setNewProfileName("");
        await saveProfiles();
        notifyPreviewChanges();
    };

    const handleDeleteItem = async (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        activeProfile.items.splice(index, 1);
        if (activeProfile.currentIndex >= activeProfile.items.length) {
            activeProfile.currentIndex = Math.max(0, activeProfile.items.length - 1);
        }
        await saveProfiles();
        notifyPreviewChanges();
    };

    const handleSelectItem = async (index: number) => {
        activeProfile.currentIndex = index;
        await saveProfiles();
        notifyPreviewChanges();
    };

    const profileOptions = Array.from(profiles.values()).map(p => ({
        label: p.name,
        value: p.id
    }));

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE} className={cl("modal-root")}>
            <ModalHeader separator={false} className={cl("header")}>
                <div className={cl("header-text")}>
                    <Text variant="heading-lg/bold" className={cl("title")}>
                        Custom Stream Preview Gallery
                    </Text>
                    <Text variant="text-sm/normal" className={cl("description")}>
                        Upload custom images to broadcast as your stream preview thumbnail.
                    </Text>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent className={cl("content")}>
                <div className={cl("profile-bar")}>
                    <div className={cl("profile-select")}>
                        <Text variant="text-sm/semibold" style={{ color: "var(--header-primary, #ffffff)" }}>
                            Active Profile:
                        </Text>
                        <Select
                            options={profileOptions}
                            serialize={v => v}
                            select={handleSelectProfile}
                            isSelected={v => v === activeProfile.id}
                            closeOnSelect={true}
                        />
                    </div>
                    {!isCreatingProfile ? (
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => setIsCreatingProfile(true)}
                        >
                            New Profile
                        </Button>
                    ) : (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <TextInput
                                value={newProfileName}
                                placeholder="Profile Name"
                                onChange={v => setNewProfileName(v)}
                                size="small"
                            />
                            <Button
                                variant="primary"
                                size="small"
                                onClick={handleCreateProfile}
                            >
                                Save
                            </Button>
                            <Button
                                variant="secondary"
                                size="small"
                                onClick={() => setIsCreatingProfile(false)}
                            >
                                Cancel
                            </Button>
                        </div>
                    )}
                </div>

                <div
                    className={cl("upload-zone")}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                        e.preventDefault();
                        void handleFiles(e.dataTransfer.files);
                    }}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        style={{ display: "none" }}
                        onChange={e => void handleFiles(e.target.files)}
                    />
                    <span className={cl("upload-title")}>
                        {isProcessing ? "Processing images..." : "Click or drag & drop images here"}
                    </span>
                    <span className={cl("upload-sub")}>
                        Supports PNG, JPG, WEBP (Max 15MB)
                    </span>
                </div>

                {activeProfile.items.length > 0 ? (
                    <div className={cl("grid")}>
                        {activeProfile.items.map((item, idx) => (
                            <div
                                key={idx}
                                className={`${cl("card")} ${activeProfile.currentIndex === idx ? "selected" : ""}`}
                                onClick={() => void handleSelectItem(idx)}
                            >
                                <img src={item.dataUri} alt={item.name} className={cl("thumbnail")} />
                                <button
                                    className={cl("card-delete")}
                                    onClick={e => void handleDeleteItem(e, idx)}
                                    title="Delete image"
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ textAlign: "center", padding: "24px 0" }}>
                        <Text variant="text-sm/normal" style={{ color: "var(--text-muted, #949ba4)" }}>
                            No preview images in this profile. Upload an image above.
                        </Text>
                    </div>
                )}
            </ModalContent>

            <ModalFooter className={cl("footer")}>
                <div className={cl("toggles")}>
                    <FormSwitch
                        title="Enable Custom Preview"
                        hideBorder
                        value={replaceOn}
                        onChange={v => {
                            setReplaceOn(v);
                            previewSettingsState.replaceEnabled = v;
                        }}
                    />
                    <FormSwitch
                        title="Slideshow"
                        hideBorder
                        value={slideshowOn}
                        onChange={v => {
                            setSlideshowOn(v);
                            previewSettingsState.slideshowEnabled = v;
                        }}
                    />
                    <FormSwitch
                        title="Random Order"
                        hideBorder
                        value={randomOn}
                        disabled={!slideshowOn}
                        onChange={v => {
                            setRandomOn(v);
                            previewSettingsState.slideshowRandom = v;
                        }}
                    />
                </div>

                <Button
                    variant="primary"
                    size="small"
                    onClick={modalProps.onClose}
                >
                    Done
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openPreviewGalleryModal() {
    openModal(modalProps => (
        <PreviewGalleryModal modalProps={modalProps} />
    ));
}
