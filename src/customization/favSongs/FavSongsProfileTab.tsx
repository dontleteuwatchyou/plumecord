/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@api/i18n";
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

const PlayIcon = ({ size = 16, style }: { size?: number; style?: React.CSSProperties; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
        <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
);

const PauseIcon = ({ size = 16, style }: { size?: number; style?: React.CSSProperties; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
        <rect x="6" y="4" width="4" height="16" rx="1.5" />
        <rect x="14" y="4" width="4" height="16" rx="1.5" />
    </svg>
);

const PrevTrackIcon = ({ size = 14 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <polygon points="19 20 9 12 19 4 19 20" />
        <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
);

const NextTrackIcon = ({ size = 14 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 4 15 12 5 20 5 4" />
        <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
);

const VolumeIcon = ({ size = 16 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
);

const VolumeMuteIcon = ({ size = 16 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
);

const CloseIcon = ({ size = 14 }: { size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
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
    const [isMuted, setIsMuted] = useState(false);
    const [prevVolume, setPrevVolume] = useState(0.5);
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
            audioRef.current.volume = isMuted ? 0 : volume;
            audioRef.current.play().catch(() => {
                setIsPlaying(false);
            });
        }
    };

    const handlePrevSong = () => {
        if (!currentSong) return;
        const idx = songs.findIndex(s => s.id === currentSong.id);
        if (idx > 0) {
            void handlePlaySong(songs[idx - 1]);
        } else if (audioRef.current) {
            audioRef.current.currentTime = 0;
            setCurrentTime(0);
        }
    };

    const handleNextSong = () => {
        if (!currentSong) return;
        const idx = songs.findIndex(s => s.id === currentSong.id);
        if (idx >= 0 && idx < songs.length - 1) {
            void handlePlaySong(songs[idx + 1]);
        } else if (songs.length > 0) {
            void handlePlaySong(songs[0]);
        }
    };

    const toggleMute = () => {
        if (isMuted) {
            setIsMuted(false);
            const restore = prevVolume || 0.5;
            setVolume(restore);
            if (audioRef.current) audioRef.current.volume = restore;
        } else {
            setPrevVolume(volume || 0.5);
            setIsMuted(true);
            setVolume(0);
            if (audioRef.current) audioRef.current.volume = 0;
        }
    };

    const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, clickX / rect.width));
        const newTime = ratio * (duration || 0);
        setCurrentTime(newTime);
        if (audioRef.current) audioRef.current.currentTime = newTime;
    };

    const handleVolumeScrub = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, clickX / rect.width));
        setVolume(ratio);
        setIsMuted(ratio === 0);
        if (audioRef.current) audioRef.current.volume = ratio;
    };

    const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

    if (isSelf && !isAuthenticated) {
        return (
            <div className="ncp-profile-empty-state">
                <div className="ncp-profile-empty-inner" style={{ gap: 16 }}>
                    <div className="ncp-profile-empty-icon" style={{ color: "var(--brand-500, #5865f2)", opacity: 1 }}>
                        <MusicIcon size={36} />
                    </div>
                    <div>
                        <h3 className="ncp-profile-empty-title" style={{ margin: "0 0 6px 0", fontSize: 18 }}>
                            {t("Nightcord Authentication Required")}
                        </h3>
                        <p className="ncp-profile-empty-desc" style={{ margin: "0 auto" }}>
                            {t("Connect your Discord account via OAuth2 to display and sync your favorite songs on your profile.")}
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
                        {t("Authenticate with Discord")}
                    </Button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="ncp-profile-empty-state">
                <div className="ncp-profile-empty-inner">
                    <div className="ncp-profile-empty-title" style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted, #949ba4)" }}>
                        {t("Loading songs...")}
                    </div>
                </div>
            </div>
        );
    }

    if (songs.length === 0) {
        return (
            <div className="ncp-profile-empty-state">
                <div className="ncp-profile-empty-inner">
                    <div className="ncp-profile-empty-icon">
                        <MusicIcon size={36} />
                    </div>
                    <div className="ncp-profile-empty-title">
                        {t("No favorite songs")}
                    </div>
                    <div className="ncp-profile-empty-desc">
                        {isSelf
                            ? t("Add your favorite songs from Nightcord Customization settings.")
                            : t("This user hasn't configured any favorite songs yet.")}
                    </div>
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
                    const idx = songs.findIndex(s => s.id === currentSong?.id);
                    if (idx >= 0 && idx < songs.length - 1) {
                        void handlePlaySong(songs[idx + 1]);
                    } else {
                        setIsPlaying(false);
                        setCurrentTime(0);
                    }
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

                            {active && isPlaying && (
                                <div className="ncp-equalizer">
                                    <span />
                                    <span />
                                    <span />
                                </div>
                            )}

                            <button
                                className="ncp-song-item-btn"
                                title={active && isPlaying ? t("Pause") : t("Play")}
                                onClick={e => {
                                    e.stopPropagation();
                                    handlePlaySong(song);
                                }}
                            >
                                {active && isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} style={{ marginLeft: 2 }} />}
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Sleek Now Playing Bar */}
            {currentSong && (
                <div className="ncp-player-bar">
                    <div className="ncp-player-top">
                        <div className="ncp-player-track">
                            <div className="ncp-player-artwork">
                                {currentSong.artworkUrl ? (
                                    <img src={currentSong.artworkUrl} alt="" />
                                ) : (
                                    <MusicIcon size={18} />
                                )}
                            </div>
                            <div className="ncp-player-meta">
                                <span className="ncp-player-title" title={currentSong.title}>
                                    {currentSong.title}
                                </span>
                                <span className="ncp-player-artist" title={currentSong.artist}>
                                    {currentSong.artist}
                                </span>
                            </div>
                        </div>

                        <div className="ncp-player-controls">
                            <button
                                className="ncp-control-btn"
                                title={t("Previous")}
                                onClick={handlePrevSong}
                            >
                                <PrevTrackIcon size={14} />
                            </button>
                            <button
                                className="ncp-play-btn"
                                title={isPlaying ? t("Pause") : t("Play")}
                                onClick={() => handlePlaySong(currentSong)}
                            >
                                {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} style={{ marginLeft: 2 }} />}
                            </button>
                            <button
                                className="ncp-control-btn"
                                title={t("Next")}
                                onClick={handleNextSong}
                            >
                                <NextTrackIcon size={14} />
                            </button>
                        </div>

                        <div className="ncp-player-actions">
                            <button
                                className="ncp-action-btn"
                                title={isMuted || volume === 0 ? t("Unmute") : t("Mute")}
                                onClick={toggleMute}
                            >
                                {isMuted || volume === 0 ? <VolumeMuteIcon size={16} /> : <VolumeIcon size={16} />}
                            </button>
                            <div
                                className="ncp-volume-scrubber"
                                onClick={handleVolumeScrub}
                                title={`${Math.round((isMuted ? 0 : volume) * 100)}%`}
                            >
                                <div className="ncp-volume-track">
                                    <div
                                        className="ncp-volume-fill"
                                        style={{ width: `${Math.round((isMuted ? 0 : volume) * 100)}%` }}
                                    />
                                </div>
                            </div>
                            <button
                                className="ncp-action-btn ncp-close-btn"
                                title={t("Close Player")}
                                onClick={() => {
                                    audioRef.current?.pause();
                                    setIsPlaying(false);
                                    setCurrentSong(null);
                                }}
                            >
                                <CloseIcon size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="ncp-player-bottom">
                        <span className="ncp-time-text">{fmtTime(currentTime)}</span>
                        <div
                            className="ncp-scrubber"
                            onClick={handleScrub}
                        >
                            <div className="ncp-scrubber-track">
                                <div
                                    className="ncp-scrubber-fill"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <div
                                className="ncp-scrubber-thumb"
                                style={{ left: `${progressPercent}%` }}
                            />
                        </div>
                        <span className="ncp-time-text">{fmtTime(duration)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
