/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@api/i18n";
import { Button, React, useEffect, useState, UserStore } from "@webpack/common";
import { isOAuthAuthenticated, promptDiscordOAuth, readUserPremiumData } from "../sync";
import type { PremiumStory } from "../types";
import { StoryViewer } from "./StoryViewer";

const CameraIcon = () => (
    <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
    </svg>
);

const DiscordIcon = () => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 8 }}>
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128c.126-.093.252-.19.372-.287a.075.075 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.075.075 0 0 1 .079.01c.12.098.245.195.372.288a.077.077 0 0 1-.006.127c-.598.35-1.22.652-1.873.894a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
);

export function StoryGallery({ user }: { user: any }) {
    const [stories, setStories] = useState<PremiumStory[]>([]);
    const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(true);
    const [loading, setLoading] = useState(true);

    const currentUserId = UserStore.getCurrentUser()?.id;
    const isSelf = user?.id && String(user.id) === String(currentUserId);

    const loadData = async () => {
        setLoading(true);
        if (isSelf) {
            const auth = await isOAuthAuthenticated();
            setIsAuthenticated(auth);
        }

        const data = await readUserPremiumData(user.id);
        if (data && data.storiesEnabled !== false && Array.isArray(data.stories)) {
            setStories(data.stories);
        } else {
            setStories([]);
        }
        setLoading(false);
    };

    useEffect(() => {
        void loadData();
    }, [user?.id]);

    if (isSelf && !isAuthenticated) {
        return (
            <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 340,
                height: "100%",
                padding: "48px 20px",
                textAlign: "center",
                gap: 16
            }}>
                <div style={{ color: "var(--brand-500, #5865f2)" }}>
                    <CameraIcon />
                </div>
                <div>
                    <h3 style={{ margin: "0 0 6px 0", fontSize: 18, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                        {t("Nightcord Authentication Required")}
                    </h3>
                    <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted, #949ba4)", maxWidth: 360, lineHeight: 1.5 }}>
                        {t("Connect your Discord account via OAuth2 to sync Stories on your profile.")}
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
        );
    }

    if (loading) {
        return (
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 340,
                height: "100%",
                textAlign: "center",
                padding: "40px 20px",
                color: "var(--text-muted, #949ba4)"
            }}>
                {t("Loading stories...")}
            </div>
        );
    }

    if (stories.length === 0) {
        return (
            <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 340,
                height: "100%",
                padding: "32px 20px",
                textAlign: "center",
                color: "var(--text-muted, #949ba4)"
            }}>
                <div style={{ opacity: 0.5, marginBottom: 12 }}>
                    <CameraIcon />
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, color: "var(--header-primary, #ffffff)" }}>
                    {t("No stories yet")}
                </div>
                <div style={{ fontSize: 13, marginTop: 4, color: "var(--text-muted, #949ba4)" }}>
                    {isSelf
                        ? t("Add stories from Nightcord Customization settings.")
                        : t("This user hasn't shared any stories yet.")}
                </div>
            </div>
        );
    }

    return (
        <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div className="ncp-story-gallery">
                {stories.map((story, i) => (
                    <div
                        key={story.id}
                        className="ncp-story-gallery-item"
                        onClick={() => setSelectedStoryIndex(i)}
                    >
                        {story.type === "video" ? (
                            <video src={story.url} muted />
                        ) : (
                            <img src={story.url} alt="" />
                        )}
                    </div>
                ))}
            </div>

            {selectedStoryIndex !== null && (
                <StoryViewer
                    stories={stories.slice(selectedStoryIndex)}
                    user={user}
                    onClose={() => setSelectedStoryIndex(null)}
                />
            )}
        </div>
    );
}
