/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useRef, useState } from "@webpack/common";
import type { PremiumStory } from "../types";

const CloseIcon = () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const VolumeHighIcon = () => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
);

const VolumeMuteIcon = () => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
);

const IMAGE_DURATION_MS = 12000;

export function StoryViewer({
    stories,
    onClose,
    user
}: {
    stories: PremiumStory[];
    onClose: () => void;
    user: any;
}) {
    const [index, setIndex] = useState(0);
    const [progress, setProgress] = useState(0);
    const [volume, setVolume] = useState(0.5);

    const timerRef = useRef<any>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const scAudioRef = useRef<HTMLIFrameElement | null>(null);
    const progressIntervalRef = useRef<any>(null);

    const currentStory = stories[index];
    const avatarUrl = user?.getAvatarURL?.() ?? `https://cdn.discordapp.com/avatars/${user?.id}/avatar.png`;
    const username = user?.username ?? user?.id ?? "";

    const clearTimers = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };

    const goNext = () => {
        clearTimers();
        if (index < stories.length - 1) {
            setIndex(i => i + 1);
        } else {
            onClose();
        }
    };

    const goPrev = () => {
        clearTimers();
        if (index > 0) setIndex(i => i - 1);
    };

    const startImageTimer = () => {
        clearTimers();
        setProgress(0);
        const startTime = Date.now();
        progressIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const p = Math.min((elapsed / IMAGE_DURATION_MS) * 100, 100);
            setProgress(p);
            if (p >= 100) {
                clearTimers();
                goNext();
            }
        }, 30);
    };

    const startVideoProgress = (video: HTMLVideoElement) => {
        clearTimers();
        setProgress(0);

        const onTimeUpdate = () => {
            if (video.duration) {
                setProgress((video.currentTime / video.duration) * 100);
            }
        };
        const onEnded = () => {
            setProgress(100);
            goNext();
        };

        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("ended", onEnded);

        (video as any)._ncpCleanup = () => {
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("ended", onEnded);
        };
    };

    const updateAllVolumes = (v: number) => {
        if (videoRef.current) {
            videoRef.current.volume = v;
        }
        if (scAudioRef.current?.contentWindow) {
            try {
                scAudioRef.current.contentWindow.postMessage(JSON.stringify({
                    method: "setVolume",
                    value: v * 100
                }), "*");
            } catch {}
        }
    };

    useEffect(() => {
        if (!currentStory) return;
        setProgress(0);
        clearTimers();

        if (currentStory.type === "image") {
            startImageTimer();
        }

        const t = setTimeout(() => {
            updateAllVolumes(volume);
            if (currentStory.startTime && scAudioRef.current?.contentWindow) {
                try {
                    scAudioRef.current.contentWindow.postMessage(JSON.stringify({
                        method: "seekTo",
                        value: currentStory.startTime * 1000
                    }), "*");
                } catch {}
            }
        }, 100);

        return () => {
            clearTimers();
            clearTimeout(t);
        };
    }, [index]);

    useEffect(() => {
        updateAllVolumes(volume);
    }, [volume]);

    useEffect(() => {
        return () => {
            if (videoRef.current && (videoRef.current as any)._ncpCleanup) {
                (videoRef.current as any)._ncpCleanup();
            }
        };
    }, [index]);

    if (!currentStory) return null;

    const hasSoundCloud = !!currentStory.soundcloudUrl;
    const scEmbedUrl = hasSoundCloud
        ? `https://w.soundcloud.com/player/?url=${encodeURIComponent(currentStory.soundcloudUrl!)}&auto_play=true&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false&color=%235865f2#t=${currentStory.startTime || 0}`
        : null;

    return (
        <div className="ncp-story-viewer-overlay" onClick={onClose}>
            <div className="ncp-story-viewer-content" onClick={e => e.stopPropagation()}>
                {/* Progress bars */}
                <div className="ncp-story-progress-bars">
                    {stories.map((_, i) => (
                        <div key={i} className="ncp-story-progress-bar">
                            <div
                                className="ncp-story-progress-fill"
                                style={{ width: i < index ? "100%" : (i === index ? `${progress}%` : "0%") }}
                            />
                        </div>
                    ))}
                </div>

                {/* Header */}
                <div className="ncp-story-header">
                    <img
                        src={avatarUrl}
                        className="ncp-story-avatar"
                        alt=""
                        onError={e => (e.currentTarget.style.display = "none")}
                    />
                    <span className="ncp-story-username">{username}</span>
                    <button className="ncp-story-close-btn" onClick={onClose} aria-label="Close">
                        <CloseIcon />
                    </button>
                </div>

                {/* Media */}
                <div className="ncp-story-media">
                    {currentStory.type === "video" ? (
                        <video
                            key={currentStory.id}
                            src={currentStory.url}
                            autoPlay
                            playsInline
                            ref={el => {
                                if (el && el !== videoRef.current) {
                                    videoRef.current = el;
                                    el.volume = volume;
                                    startVideoProgress(el);
                                }
                            }}
                            onLoadedMetadata={e => {
                                e.currentTarget.volume = volume;
                            }}
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                    ) : (
                        <img src={currentStory.url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    )}
                </div>

                {/* SoundCloud widget (audio only) */}
                {hasSoundCloud && scEmbedUrl && (
                    <iframe
                        ref={scAudioRef}
                        src={scEmbedUrl}
                        style={{ position: "absolute", bottom: "60px", left: 0, right: 0, width: "100%", height: 0, border: "none", opacity: 0 }}
                        allow="autoplay"
                    />
                )}

                {/* Tap navigation */}
                <div className="ncp-story-controls">
                    <div className="ncp-story-control-prev" onClick={e => { e.stopPropagation(); goPrev(); }} />
                    <div className="ncp-story-control-next" onClick={e => { e.stopPropagation(); goNext(); }} />
                </div>

                {/* Volume slider */}
                <div className="ncp-story-volume-control" onClick={e => e.stopPropagation()}>
                    <span style={{ display: "flex", alignItems: "center", color: "#ffffff" }}>
                        {volume === 0 ? <VolumeMuteIcon /> : <VolumeHighIcon />}
                    </span>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={volume}
                        onChange={e => setVolume(parseFloat(e.target.value))}
                        className="ncp-story-volume-slider"
                    />
                </div>
            </div>
        </div>
    );
}
