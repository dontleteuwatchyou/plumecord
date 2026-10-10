/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, React, showToast, TextInput, Toasts, useEffect, useState } from "@webpack/common";
import { getLocalFavSongs, saveLocalFavSongs, syncOwnDataToCloud } from "../sync";
import type { PremiumFavSong } from "../types";

const TrashIcon = () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

const MusicIcon = () => (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
    </svg>
);

export function FavSongsSettingsSection() {
    const [songs, setSongs] = useState<PremiumFavSong[]>([]);
    const [title, setTitle] = useState("");
    const [artist, setArtist] = useState("");
    const [url, setUrl] = useState("");
    const [artworkUrl, setArtworkUrl] = useState("");

    const load = async () => {
        const list = await getLocalFavSongs();
        setSongs(list);
    };

    useEffect(() => {
        void load();
    }, []);

    const persist = async (updated: PremiumFavSong[]) => {
        setSongs(updated);
        await saveLocalFavSongs(updated);
        void syncOwnDataToCloud();
    };

    const handleAddSong = async () => {
        const cleanTitle = title.trim();
        const cleanUrl = url.trim();
        if (!cleanTitle || !cleanUrl) {
            showToast("Le titre et l'URL du morceau sont obligatoires.", Toasts.Type.WARNING);
            return;
        }

        const newSong: PremiumFavSong = {
            id: `song-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: cleanTitle,
            artist: artist.trim() || "Artiste inconnu",
            url: cleanUrl,
            artworkUrl: artworkUrl.trim(),
            type: cleanUrl.includes("soundcloud.com") ? "soundcloud" : "local"
        };

        const updated = [...songs, newSong];
        setTitle("");
        setArtist("");
        setUrl("");
        setArtworkUrl("");
        await persist(updated);
        showToast("Morceau ajouté avec succès", Toasts.Type.SUCCESS);
    };

    const handleDelete = async (id: string) => {
        const updated = songs.filter(s => s.id !== id);
        await persist(updated);
        showToast("Morceau retiré", Toasts.Type.INFO);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Add Song Form */}
            <div style={{
                background: "var(--background-secondary-alt, #1e1f22)",
                padding: "16px 20px",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 12
            }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                    Ajouter une musique favorite
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Titre *</div>
                        <TextInput
                            placeholder="Ex: Starboy"
                            value={title}
                            onChange={(val: string) => setTitle(val)}
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Artiste</div>
                        <TextInput
                            placeholder="Ex: The Weeknd"
                            value={artist}
                            onChange={(val: string) => setArtist(val)}
                        />
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>URL Audio (.mp3, SoundCloud stream...) *</div>
                        <TextInput
                            placeholder="https://..."
                            value={url}
                            onChange={(val: string) => setUrl(val)}
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Pochette d'album (URL Image)</div>
                        <TextInput
                            placeholder="https://... (facultatif)"
                            value={artworkUrl}
                            onChange={(val: string) => setArtworkUrl(val)}
                        />
                    </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                    <Button
                        color={Button.Colors.BRAND}
                        onClick={handleAddSong}
                        disabled={!title.trim() || !url.trim()}
                    >
                        Ajouter au profil
                    </Button>
                </div>
            </div>

            {/* Song List */}
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--header-secondary, #b5bac1)" }}>
                Musiques configurées ({songs.length})
            </div>

            {songs.length === 0 ? (
                <div style={{
                    padding: 32,
                    textAlign: "center",
                    color: "var(--text-muted, #949ba4)",
                    background: "var(--background-secondary, #2b2d31)",
                    borderRadius: 8
                }}>
                    Aucune musique favorite enregistrée pour votre profil.
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {songs.map(song => (
                        <div
                            key={song.id}
                            style={{
                                background: "var(--background-secondary, #2b2d31)",
                                borderRadius: 8,
                                padding: "10px 14px",
                                display: "flex",
                                alignItems: "center",
                                gap: 12
                            }}
                        >
                            <div style={{
                                width: 40,
                                height: 40,
                                borderRadius: 6,
                                overflow: "hidden",
                                background: "#18191c",
                                flexShrink: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--text-muted, #949ba4)"
                            }}>
                                {song.artworkUrl ? (
                                    <img src={song.artworkUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                                ) : (
                                    <MusicIcon />
                                )}
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--header-primary, #ffffff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {song.title}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--text-muted, #949ba4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {song.artist}
                                </div>
                            </div>

                            <Button
                                color={Button.Colors.RED}
                                size={Button.Sizes.SMALL}
                                onClick={() => handleDelete(song.id)}
                            >
                                <TrashIcon />
                                Retirer
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
