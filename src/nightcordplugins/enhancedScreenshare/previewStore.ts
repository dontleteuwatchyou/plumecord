/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";

export const DATASTORE_KEY_PROFILES = "EnhancedScreenshare_Profiles_V1";
export const DATASTORE_KEY_ACTIVE_PROFILE = "EnhancedScreenshare_ActiveProfile";
export const DATASTORE_KEY_INDICES = "EnhancedScreenshare_SlideIndices";
export const MAX_IMAGES_PER_PROFILE = 50;
export const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
export const DEFAULT_PROFILE_ID = "default";

export interface MediaItem {
    blob: Blob;
    dataUri: string;
    type: "image";
    name: string;
    size: number;
}

export interface Profile {
    id: string;
    name: string;
    items: MediaItem[];
    currentIndex: number;
}

interface StoredProfile {
    id: string;
    name: string;
    items: Array<{
        type: "image";
        mime: string;
        name: string;
        dataUri: string;
    }>;
}

export let profiles: Map<string, Profile> = new Map();
export let activeProfileId: string = DEFAULT_PROFILE_ID;
export let isStreamActive = false;
export let lastSlideChangeTime = 0;
export let actualStreamImageUri: string | null = null;
let shuffleBag: number[] = [];

const listeners = new Set<() => void>();

export function subscribePreviewChanges(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function notifyPreviewChanges() {
    listeners.forEach(fn => fn());
}

export function setActiveProfileId(id: string) {
    activeProfileId = id;
}

export function getActiveProfile(): Profile {
    let p = profiles.get(activeProfileId);
    if (!p) {
        p = {
            id: DEFAULT_PROFILE_ID,
            name: "Default",
            items: [],
            currentIndex: 0
        };
        profiles.set(DEFAULT_PROFILE_ID, p);
    }
    return p;
}

export async function loadProfiles(): Promise<void> {
    try {
        const stored = await DataStore.get<{ profiles: StoredProfile[]; }>(DATASTORE_KEY_PROFILES);
        const storedActiveId = await DataStore.get<string>(DATASTORE_KEY_ACTIVE_PROFILE);
        const storedIndices = await DataStore.get<Record<string, number>>(DATASTORE_KEY_INDICES) ?? {};

        profiles.clear();

        if (stored?.profiles?.length) {
            for (const sp of stored.profiles) {
                const items: MediaItem[] = [];
                for (const item of sp.items) {
                    try {
                        const res = await fetch(item.dataUri);
                        const blob = await res.blob();
                        items.push({
                            blob,
                            dataUri: item.dataUri,
                            type: "image",
                            name: item.name,
                            size: blob.size
                        });
                    } catch {
                        // skip invalid
                    }
                }
                const savedIndex = storedIndices[sp.id] ?? 0;
                profiles.set(sp.id, {
                    id: sp.id,
                    name: sp.name,
                    items,
                    currentIndex: savedIndex < items.length ? savedIndex : 0
                });
            }
        }

        activeProfileId = storedActiveId && profiles.has(storedActiveId) ? storedActiveId : DEFAULT_PROFILE_ID;
        getActiveProfile();
        notifyPreviewChanges();
    } catch (err) {
        console.error("[EnhancedScreenshare] Failed to load preview profiles:", err);
    }
}

export async function saveProfiles(): Promise<void> {
    try {
        const stored: StoredProfile[] = [];
        const indices: Record<string, number> = {};

        for (const [, p] of profiles) {
            stored.push({
                id: p.id,
                name: p.name,
                items: p.items.map(it => ({
                    type: "image",
                    mime: it.blob.type || "image/jpeg",
                    name: it.name,
                    dataUri: it.dataUri
                }))
            });
            indices[p.id] = p.currentIndex;
        }

        await DataStore.set(DATASTORE_KEY_PROFILES, { profiles: stored });
        await DataStore.set(DATASTORE_KEY_ACTIVE_PROFILE, activeProfileId);
        await DataStore.set(DATASTORE_KEY_INDICES, indices);
        notifyPreviewChanges();
    } catch (err) {
        console.error("[EnhancedScreenshare] Failed to save preview profiles:", err);
    }
}

export async function processFile(file: File): Promise<MediaItem> {
    const convertedBlob = await processImageBlob(file);
    const dataUri = await fileToDataUri(convertedBlob);
    return {
        blob: convertedBlob,
        dataUri,
        type: "image",
        name: file.name,
        size: convertedBlob.size
    };
}

function fileToDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function processImageBlob(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            URL.revokeObjectURL(url);
            const targetWidth = 1280;
            const targetHeight = 720;

            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("Canvas context failed"));

            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, targetWidth, targetHeight);

            const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (targetWidth - scaledWidth) / 2;
            const y = (targetHeight - scaledHeight) / 2;

            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

            canvas.toBlob((newBlob) => {
                if (newBlob) resolve(newBlob);
                else reject(new Error("Blob creation failed"));
            }, "image/jpeg", 0.85);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image"));
        };

        img.src = url;
    });
}

export function getCustomStreamThumbnail(originalThumbnail: string, replaceEnabled: boolean, slideshowEnabled: boolean, slideshowRandom: boolean): string {
    isStreamActive = true;
    const profile = getActiveProfile();

    if (!replaceEnabled || profile.items.length === 0) {
        actualStreamImageUri = null;
        notifyPreviewChanges();
        return originalThumbnail;
    }

    if (profile.items.length === 1 || !slideshowEnabled) {
        const idx = profile.currentIndex < profile.items.length ? profile.currentIndex : 0;
        lastSlideChangeTime = Date.now();
        actualStreamImageUri = profile.items[idx].dataUri;
        notifyPreviewChanges();
        return profile.items[idx].dataUri;
    }

    let nextIndex: number;
    if (slideshowRandom) {
        shuffleBag = shuffleBag.filter(i => i < profile.items.length);
        if (shuffleBag.length === 0) {
            shuffleBag = Array.from({ length: profile.items.length }, (_, i) => i);
            for (let i = shuffleBag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffleBag[i], shuffleBag[j]] = [shuffleBag[j], shuffleBag[i]];
            }
        }
        nextIndex = shuffleBag.shift() ?? 0;
    } else {
        nextIndex = (profile.currentIndex + 1) % profile.items.length;
    }

    profile.currentIndex = nextIndex;
    lastSlideChangeTime = Date.now();
    actualStreamImageUri = profile.items[nextIndex].dataUri;
    void saveProfiles();
    notifyPreviewChanges();
    return profile.items[nextIndex].dataUri;
}
