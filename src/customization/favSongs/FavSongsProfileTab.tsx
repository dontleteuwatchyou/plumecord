/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, React, useEffect, useRef, useState, UserStore } from "@webpack/common";
import { isOAuthAuthenticated, promptDiscordOAuth, readUserPremiumData } from "../sync";
import type { PremiumFavSong } from "../types";

const MusicIcon = ({ size = 22 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
    </svg>
);

const PlayIcon = ({ size = 18 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
);

const PauseIcon = ({ size = 18 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" rx="1" />
        <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
);

const VolumeIcon = ({ size = 16 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
);

const DiscordIcon = () => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 8 }}>
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128c.126-.093.252-.19.372-.287a.075.075 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.075.075 0 0 1 .079.01c.12.098.245.195.372.288a.077.077 0 0 1-.006.127c-.598.35-1.22.652-1.873.894a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
);

function fmtTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function FavSongsProfileTab({ user }: { user: any; }) {
    const [songs, setSongs] = useState<PremiumFavSong[]>([]);
    const [currentSong, setCurrentSong] = useState<PremiumFavSong | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.5);
    const [loading, setLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(true);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const currentUserId = UserStore.getCurrentUser()?.id;
    const isSelf = user?.id && String(user.id) === String(currentUserId);

    const loadData = async () => {
        setLoading(true);
        if (isSelf) {
            const auth = await isOAuthAuthenticated();
            setIsAuthenticated(auth);
        }

        const data = await readUserPremiumData(user.id);
        if (data && data.favSongsEnabled !== false && Array.isArray(data.favSongs)) {
            setSongs(data.favSongs);
        } else {
            setSongs([]);
        }
        setLoading(false);
    };

    useEffect(() => {
        void loadData();
    }, [user?.id]);

    const handlePlaySong = async (song: PremiumFavSong) => {
        if (currentSong?.id === song.id) {
            if (isPlaying) {
                audioRef.current?.pause();
                setIsPlaying(false);
            } else {
                audioRef.current?.play().catch(() => {});
                setIsPlaying(true);
            }
            return;
        }

        setCurrentSong(song);
        setIsPlaying(true);
        if (audioRef.current) {
            let playUrl = song.url;
            if (song.type === "soundcloud" && song.streamUrl) {
                try {
                    const { resolveSoundCordStream } = await import("../soundcordHelper");
                    const resolved = await resolveSoundCordStream(song.streamUrl);
                    if (resolved) playUrl = resolved;
                } catch {}
            }
            audioRef.current.src = playUrl;
            audioRef.current.currentTime = 0;
            audioRef.current.volume = volume;
            audioRef.current.play().catch(() => {
                setIsPlaying(false);
            });
        }
    };

    if (isSelf && !isAuthenticated) {
        return (
            <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "48px 20px",
                textAlign: "center",
                gap: 16
            }}>
                <div style={{ color: "var(--brand-500, #5865f2)" }}>
                    <MusicIcon size={36} />
                </div>
                <div>
                    <h3 style={{ margin: "0 0 6px 0", fontSize: 18, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                        Identification Nightcord requise
                    </h3>
                    <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted, #949ba4)", maxWidth: 360, lineHeight: 1.5 }}>
                        Connectez votre compte Discord via OAuth2 pour afficher et synchroniser vos musiques favorites sur votre profil.
                    </p>
                </div>
                <Button
                    color={Button.Colors.BRAND}
                    onClick={async () => {
                        const tok = await promptDiscordOAuth();
                        if (tok) void loadData();
                    }}
                >
                    <DiscordIcon />
                    S'identifier avec Discord
                </Button>
            </div>
        );
    }

    if (loading) {
        return (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted, #949ba4)" }}>
                Chargement des musiques...
            </div>
        );
    }

    if (songs.length === 0) {
        return (
            <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "48px 20px",
                textAlign: "center",
                color: "var(--text-muted, #949ba4)"
            }}>
                <div style={{ opacity: 0.5, marginBottom: 12 }}>
                    <MusicIcon size={36} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, color: "var(--header-primary, #ffffff)" }}>
                    Aucune musique favorite
                </div>
                <div style={{ fontSize: 13, marginTop: 4, color: "var(--text-muted, #949ba4)" }}>
                    {isSelf ? "Ajoutez vos morceaux favoris depuis les paramètres Nightcord Premium." : "Cet utilisateur n'a pas encore configuré de musique favorite."}
                </div>
            </div>
        );
    }

    return (
        <div className="ncp-fav-songs-container">
            <audio
                ref={audioRef}
                onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                onEnded={() => {
                    setIsPlaying(false);
                    setCurrentTime(0);
                }}
            />

            {/* Song List */}
            <div className="ncp-song-list">
                {songs.map(song => {
                    const active = currentSong?.id === song.id;
                    return (
                        <div
                            key={song.id}
                            className={`ncp-song-item${active ? " active" : ""}`}
                            onClick={() => handlePlaySong(song)}
                        >
                            <div className="ncp-song-artwork-container">
                                {song.artworkUrl ? (
                                    <img src={song.artworkUrl} className="ncp-song-artwork" alt="" />
                                ) : (
                                    <MusicIcon size={20} />
                                )}
                            </div>

                            <div className="ncp-song-info">
                                <span className="ncp-song-title">{song.title}</span>
                                <span className="ncp-song-artist">{song.artist}</span>
                            </div>

                            <button
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: active && isPlaying ? "var(--brand-500, #5865f2)" : "var(--interactive-normal, #b5bac1)",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    padding: 4
                                }}
                            >
                                {active && isPlaying ? <PauseIcon /> : <PlayIcon />}
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Now Playing Bar */}
            {currentSong && (
                <div style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    background: "var(--background-secondary-alt, #1e1f22)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginTop: "auto"
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                                {currentSong.title}
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-muted, #949ba4)", marginLeft: 6 }}>
                                • {currentSong.artist}
                            </span>
                        </div>
                        <span style={{ fontSize: 11, color: "var(--text-muted, #949ba4)", fontVariantNumeric: "tabular-nums" }}>
                            {fmtTime(currentTime)} / {fmtTime(duration)}
                        </span>
                    </div>

                    <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        value={currentTime}
                        onChange={e => {
                            const t = parseFloat(e.target.value);
                            setCurrentTime(t);
                            if (audioRef.current) audioRef.current.currentTime = t;
                        }}
                        style={{ width: "100%", accentColor: "var(--brand-500, #5865f2)", cursor: "pointer" }}
                    />

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <button
                            onClick={() => handlePlaySong(currentSong)}
                            style={{
                                background: "var(--brand-500, #5865f2)",
                                border: "none",
                                borderRadius: 6,
                                padding: "6px 12px",
                                color: "#ffffff",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 13,
                                fontWeight: 500
                            }}
                        >
                            {isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                            {isPlaying ? "Pause" : "Play"}
                        </button>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted, #949ba4)" }}>
                            <VolumeIcon />
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={volume}
                                onChange={e => {
                                    const v = parseFloat(e.target.value);
                                    setVolume(v);
                                    if (audioRef.current) audioRef.current.volume = v;
                                }}
                                style={{ width: 64, accentColor: "var(--brand-500, #5865f2)", cursor: "pointer" }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
