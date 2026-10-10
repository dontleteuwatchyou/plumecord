/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, FormSwitch, React, showToast, TextInput, Toasts, useEffect, useState } from "@webpack/common";
import { getLocalStories, saveLocalStories, syncOwnDataToCloud, uploadToImgur } from "../sync";
import type { PremiumStory } from "../types";

const TrashIcon = () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

const UploadIcon = () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
);

const StarIcon = () => (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
);

export function StoriesSettingsSection() {
    const [stories, setStories] = useState<PremiumStory[]>([]);
    const [uploading, setUploading] = useState(false);
    const [directUrl, setDirectUrl] = useState("");

    const load = async () => {
        const list = await getLocalStories();
        setStories(list);
    };

    useEffect(() => {
        void load();
    }, []);

    const persist = async (nextStories: PremiumStory[]) => {
        setStories(nextStories);
        await saveLocalStories(nextStories);
        void syncOwnDataToCloud();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setUploading(true);
        const added: PremiumStory[] = [];
        for (const file of files) {
            const url = await uploadToImgur(file);
            if (url) {
                added.push({
                    id: `story-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    url,
                    type: "image",
                    timestamp: Date.now(),
                    isHighlight: false,
                });
            }
        }
        setUploading(false);
        e.target.value = "";

        if (added.length > 0) {
            const updated = [...stories, ...added];
            await persist(updated);
            showToast("Story ajoutée avec succès", Toasts.Type.SUCCESS);
        } else {
            showToast("Échec du téléversement de l'image", Toasts.Type.DANGER);
        }
    };

    const handleAddDirectUrl = async () => {
        const trimmed = directUrl.trim();
        if (!trimmed) return;
        const isVideo = trimmed.endsWith(".mp4") || trimmed.endsWith(".webm");
        const newStory: PremiumStory = {
            id: `story-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            url: trimmed,
            type: isVideo ? "video" : "image",
            timestamp: Date.now(),
            isHighlight: false,
        };
        const updated = [...stories, newStory];
        setDirectUrl("");
        await persist(updated);
        showToast("Story ajoutée", Toasts.Type.SUCCESS);
    };

    const handleDelete = async (id: string) => {
        const updated = stories.filter(s => s.id !== id);
        await persist(updated);
        showToast("Story supprimée", Toasts.Type.INFO);
    };

    const handleToggleHighlight = async (id: string) => {
        const updated = stories.map(s => s.id === id ? { ...s, isHighlight: !s.isHighlight } : s);
        await persist(updated);
    };

    const handleUpdateSoundcloud = async (id: string, url: string, startTime = 0) => {
        const updated = stories.map(s => s.id === id ? { ...s, soundcloudUrl: url, startTime } : s);
        await persist(updated);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Upload & Add Bar */}
            <div style={{
                background: "var(--background-secondary-alt, #1e1f22)",
                padding: "16px 20px",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 12
            }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                    Ajouter une story
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <label style={{
                        background: "var(--brand-500, #5865f2)",
                        color: "#ffffff",
                        padding: "8px 16px",
                        borderRadius: 4,
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: uploading ? "wait" : "pointer",
                        display: "inline-flex",
                        alignItems: "center"
                    }}>
                        <UploadIcon />
                        {uploading ? "Téléversement..." : "Téléverser une image"}
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: "none" }}
                            onChange={handleFileUpload}
                            disabled={uploading}
                        />
                    </label>

                    <div style={{ display: "flex", flex: 1, minWidth: 260, gap: 8 }}>
                        <TextInput
                            placeholder="Ou entrez une URL directe (image ou vidéo .mp4)..."
                            value={directUrl}
                            onChange={(val: string) => setDirectUrl(val)}
                        />
                        <Button
                            color={Button.Colors.PRIMARY}
                            onClick={handleAddDirectUrl}
                            disabled={!directUrl.trim()}
                        >
                            Ajouter
                        </Button>
                    </div>
                </div>
            </div>

            {/* Stories Grid */}
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--header-secondary, #b5bac1)" }}>
                Stories actives ({stories.length})
            </div>

            {stories.length === 0 ? (
                <div style={{
                    padding: 32,
                    textAlign: "center",
                    color: "var(--text-muted, #949ba4)",
                    background: "var(--background-secondary, #2b2d31)",
                    borderRadius: 8
                }}>
                    Aucune story configurée pour votre profil.
                </div>
            ) : (
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                    gap: 12
                }}>
                    {stories.map(story => (
                        <div
                            key={story.id}
                            style={{
                                background: "var(--background-secondary, #2b2d31)",
                                borderRadius: 8,
                                overflow: "hidden",
                                display: "flex",
                                flexDirection: "column",
                                border: story.isHighlight ? "1px solid var(--brand-500, #5865f2)" : "1px solid rgba(255,255,255,0.06)"
                            }}
                        >
                            <div style={{ position: "relative", width: "100%", height: 160, background: "#000" }}>
                                {story.type === "video" ? (
                                    <video src={story.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                    <img src={story.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                                )}
                                {story.isHighlight && (
                                    <div style={{
                                        position: "absolute",
                                        top: 6,
                                        left: 6,
                                        background: "rgba(0,0,0,0.6)",
                                        borderRadius: 4,
                                        padding: "2px 6px",
                                        color: "#f0b429",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        fontSize: 11
                                    }}>
                                        <StarIcon /> Highlight
                                    </div>
                                )}
                            </div>

                            <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                                <FormSwitch
                                    value={story.isHighlight}
                                    onChange={() => handleToggleHighlight(story.id)}
                                    note="Mettre à la une"
                                    hideBorder
                                >
                                    Highlight
                                </FormSwitch>

                                <TextInput
                                    placeholder="SoundCloud URL..."
                                    value={story.soundcloudUrl || ""}
                                    onChange={(val: string) => handleUpdateSoundcloud(story.id, val, story.startTime || 0)}
                                />

                                <Button
                                    color={Button.Colors.RED}
                                    size={Button.Sizes.SMALL}
                                    onClick={() => handleDelete(story.id)}
                                    style={{ marginTop: 4 }}
                                >
                                    <TrashIcon />
                                    Supprimer
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
