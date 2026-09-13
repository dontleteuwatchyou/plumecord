/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { _getBadges } from "@api/Badges";
import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { fetchUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { findComponentByCodeLazy } from "@webpack";
import { ReactDOM, Tooltip, useEffect, useState, UserProfileStore, UserStore } from "@webpack/common";
import type { ComponentType, MouseEventHandler, ReactNode } from "react";

import { addStealthListener, isStealthModeEnabled, removeStealthListener } from "./HeaderBar";

const PanelButton = findComponentByCodeLazy("tooltipPositionKey", "positionKeyStemOverride") as ComponentType<UserAreaButtonProps>;

export interface UserAreaButtonProps {
    icon: ReactNode;
    tooltipText?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
    onContextMenu?: MouseEventHandler<HTMLDivElement>;
    className?: string;
    role?: string;
    "aria-label"?: string;
    "aria-checked"?: boolean;
    disabled?: boolean;
    plated?: boolean;
    redGlow?: boolean;
    orangeGlow?: boolean;
}

export interface UserAreaRenderProps {
    nameplate?: any;
    iconForeground?: string;
    hideTooltips?: boolean;
}

export type UserAreaButtonFactory = (props: UserAreaRenderProps) => ReactNode;

export interface UserAreaButtonData {
    render: UserAreaButtonFactory;
    icon: ComponentType<{ className?: string; }>;
    priority?: number;
}

interface ButtonEntry {
    render: UserAreaButtonFactory;
    priority: number;
}

export const UserAreaButton = PanelButton;

const logger = new Logger("UserArea");

export const buttons = new Map<string, ButtonEntry>();

export function addUserAreaButton(id: string, render: UserAreaButtonFactory, priority = 0) {
    buttons.set(id, { render, priority });
}

export function removeUserAreaButton(id: string) {
    buttons.delete(id);
}

interface BadgeItem {
    id: string;
    description: string;
    iconSrc: string;
    round?: boolean;
}

function useUserBadges(userId: string): BadgeItem[] {
    const [badges, setBadges] = useState<BadgeItem[]>([]);

    useEffect(() => {
        if (!userId) return;

        let active = true;

        const collectBadges = async () => {
            const list: BadgeItem[] = [];
            const seenKeys = new Set<string>();

            const add = (b: { id?: string; description?: string; iconSrc: string; round?: boolean; }) => {
                if (!b.iconSrc) return;
                const key = b.iconSrc.split("?")[0].toLowerCase();
                if (seenKeys.has(key)) return;
                seenKeys.add(key);
                list.push({
                    id: b.id || key,
                    description: b.description || "Badge",
                    iconSrc: b.iconSrc,
                    round: b.round
                });
            };

            const user = UserStore.getUser(userId) || UserStore.getCurrentUser();

            // 1. Official Discord badges from publicFlags & flags
            if (user) {
                const flags = (user.flags || 0) | (user.publicFlags || 0);
                const DISCORD_BADGE_FLAGS: Array<[number, string, string]> = [
                    [0, "Discord Staff", "5e74e9b61934fc1f67c65515d1f7e60d"],
                    [1, "Partnered Server Owner", "3f9748e53446a137a052f3454e2de41e"],
                    [2, "HypeSquad Events", "bf01d1073931f921909045f3a39fd264"],
                    [6, "HypeSquad Bravery", "8a88d63823d8a71cd5e390baa45efa02"],
                    [7, "HypeSquad Brilliance", "011940fd013da3f7fb926e4a1cd2e618"],
                    [8, "HypeSquad Balance", "3aa41de486fa12454c3761e8e223442e"],
                    [3, "Bug Hunter", "2717692c7dca7289b35297368a940dd0"],
                    [14, "Bug Hunter Level 2", "848f79194d4be5ff5f81505cbd0ce1e6"],
                    [17, "Early Verified Bot Developer", "6df5892e0f35b051f8b61eace34f4967"],
                    [9, "Early Supporter", "7060786766c9c840eb3019e725d2b358"],
                    [18, "Moderator Programs Alumni", "fee1624003e2fee35cb398e125dc479b"],
                    [22, "Active Developer", "6bdc42827b30493cdc32f5cc60489c49"]
                ];

                for (const [bit, name, hash] of DISCORD_BADGE_FLAGS) {
                    if ((flags & (1 << bit)) !== 0) {
                        add({
                            id: hash,
                            description: name,
                            iconSrc: `https://cdn.discordapp.com/badge-icons/${hash}.png`
                        });
                    }
                }

                if ((user.premiumType ?? 0) > 0) {
                    add({
                        id: "nitro",
                        description: "Discord Nitro",
                        iconSrc: "https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png"
                    });
                }
            }

            // 2. Official Discord UserProfileStore profile badges
            let profile = UserProfileStore.getUserProfile(userId);
            if (!profile) {
                try {
                    profile = await fetchUserProfile(userId, undefined, false);
                } catch { }
            }

            if (profile?.badges && Array.isArray(profile.badges)) {
                for (const b of profile.badges) {
                    if (b?.icon) {
                        const iconSrc = b.icon.startsWith("http")
                            ? b.icon
                            : `https://cdn.discordapp.com/badge-icons/${b.icon}.png`;
                        add({
                            id: b.id || b.icon,
                            description: b.description || "Badge",
                            iconSrc
                        });
                    }
                }
            }

            // 3. Client mod badges (_getBadges)
            try {
                const modBadges = _getBadges({ userId });
                if (Array.isArray(modBadges)) {
                    for (const b of modBadges) {
                        if (b?.iconSrc) {
                            add({
                                id: b.key || b.description || b.iconSrc,
                                description: b.description || "Badge",
                                iconSrc: b.iconSrc,
                                round: true
                            });
                        }
                    }
                }
            } catch { }

            if (active) setBadges(list);
        };

        collectBadges();
        return () => { active = false; };
    }, [userId]);

    return badges;
}

function UserAreaBadges({ userId }: { userId: string; }) {
    const badges = useUserBadges(userId);
    if (!badges.length) return null;

    return (
        <span
            className="nc-userarea-badges"
            onClick={e => { e.stopPropagation(); }}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                marginLeft: "6px",
                verticalAlign: "middle",
                flexShrink: 0
            }}
        >
            {badges.map(b => (
                <Tooltip text={b.description} key={b.id}>
                    {(tooltipProps: any) => (
                        <img
                            {...tooltipProps}
                            src={b.iconSrc}
                            alt={b.description}
                            style={{
                                width: "16px",
                                height: "16px",
                                objectFit: "contain",
                                borderRadius: b.round ? "50%" : "0",
                                display: "block",
                                flexShrink: 0
                            }}
                        />
                    )}
                </Tooltip>
            ))}
        </span>
    );
}

function UserAreaButtons({ props }: { props: UserAreaRenderProps; }) {
    const [, forceUpdate] = useState(0);
    const settings = useSettings(["betterUserArea"]);
    const [nameTagTarget, setNameTagTarget] = useState<Element | null>(null);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        addStealthListener(listener);
        window.addEventListener("nightcord-stealth-change", listener);
        return () => {
            removeStealthListener(listener);
            window.removeEventListener("nightcord-stealth-change", listener);
        };
    }, []);

    useEffect(() => {
        if (!settings.betterUserArea) {
            setNameTagTarget(null);
            return;
        }

        const findTarget = () => {
            const target =
                document.querySelector('div[class*="accountPopoutButtonWrapper_"] div[class*="nameTag_"] > div:first-child') ||
                document.querySelector('div[class*="nameTag_"] > div:first-child');
            setNameTagTarget(prev => (prev !== target ? target : prev));
        };

        findTarget();
        const obs = new MutationObserver(findTarget);
        const panels = document.querySelector('section[class*="panels_"]');
        if (panels) {
            obs.observe(panels, { childList: true, subtree: true });
        }
        return () => obs.disconnect();
    }, [settings.betterUserArea]);

    if (isStealthModeEnabled()) return null;

    const currentUser = UserStore.getCurrentUser();

    return (
        <>
            <style>{`
                ${settings.betterUserArea ? `
                /* ── Better User Area (2-Row Layout) ── */
                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) {
                    display: flex !important;
                    flex-direction: column !important;
                    height: auto !important;
                    min-height: 84px !important;
                    padding: 6px 8px !important;
                    gap: 6px !important;
                    box-sizing: border-box !important;
                }

                /* Row 1: Profile Info & Badges */
                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) > div[class*="accountPopoutButtonWrapper_"] {
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 0 !important;
                    display: flex !important;
                    align-items: center !important;
                    padding: 2px 4px !important;
                    margin: 0 !important;
                    border-radius: 4px !important;
                }

                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) div[class*="nameTag_"] {
                    min-width: 0 !important;
                    flex: 1 1 auto !important;
                    flex-shrink: 1 !important;
                }

                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) div[class*="nameTag_"] > div:first-child {
                    display: flex !important;
                    align-items: center !important;
                    flex-wrap: nowrap !important;
                    gap: 4px !important;
                    min-width: 0 !important;
                }

                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) div[class*="nameTag_"] > div:first-child > * {
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                }

                /* Row 2: Action Buttons */
                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) > div[class*="buttons_"] {
                    width: 100% !important;
                    max-width: 100% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    gap: 2px !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    box-sizing: border-box !important;
                }

                /* Proportional flex distribution on all buttons in Row 2 to eliminate empty space on the right */
                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) > div[class*="buttons_"] > button,
                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) > div[class*="buttons_"] > div,
                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) .vc-user-area-btns > button,
                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) .vc-user-area-btns > div,
                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) [class*="audioButtonParent_"] {
                    flex: 1 1 0 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    max-width: 40px !important;
                    min-width: 26px !important;
                    height: 32px !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }

                div[class*="container_"]:has(> div[class*="buttons_"]:has(> .vc-user-area-btns)) [class*="audioButtonParent_"] > button {
                    width: 100% !important;
                    height: 100% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    margin: 0 !important;
                }
                ` : `
                /* ── Standard 1-Row UserArea layout ── */
                div[class*="accountPopoutButtonWrapper_"],
                div[class*="nameTag_"] {
                    min-width: 0 !important;
                    flex-shrink: 1 !important;
                }

                div[class*="nameTag_"] > * {
                    min-width: 0 !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                }

                div[class*="buttons_"]:has(> .vc-user-area-btns) {
                    display: flex !important;
                    flex-wrap: nowrap !important;
                    flex-shrink: 0 !important;
                    align-items: center !important;
                }

                div[class*="buttons_"]:has(> .vc-user-area-btns) [class*="audioButtonParent_"],
                div[class*="buttons_"]:has(> .vc-user-area-btns) > button,
                div[class*="buttons_"]:has(> .vc-user-area-btns) > div,
                .vc-user-area-btns > button,
                .vc-user-area-btns > div {
                    flex-shrink: 0 !important;
                }
                `}

                /* ── Nightcord UserArea Bottom-Left Buttons Hover Spring Animation ── */
                .vc-user-area-btns button svg,
                .vc-user-area-btns [role="button"] svg,
                .vc-user-area-btns svg {
                    transform-origin: 50% 50%;
                    will-change: transform;
                    backface-visibility: hidden;
                    -webkit-backface-visibility: hidden;
                }

                .vc-user-area-btns button:hover svg:not(.nc-no-anim),
                .vc-user-area-btns [role="button"]:hover svg:not(.nc-no-anim),
                .vc-user-area-btns > div:hover svg:not(.nc-no-anim),
                .vc-user-area-btns svg:hover:not(.nc-no-anim) {
                    animation: nc-user-btn-spring 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) 1;
                }

                @keyframes nc-user-btn-spring {
                    0% {
                        transform: translate3d(0, 0, 0) scale(1);
                    }
                    35% {
                        transform: translate3d(0, 0, 0) scale(1.18);
                    }
                    70% {
                        transform: translate3d(0, 0, 0) scale(0.96);
                    }
                    100% {
                        transform: translate3d(0, 0, 0) scale(1);
                    }
                }
            `}</style>
            <div className="vc-user-area-btns" style={{ display: "contents" }}>
                {Array.from(buttons)
                    .sort(([, a], [, b]) => a.priority - b.priority)
                    .map(([id, { render: Button }]) => (
                        <ErrorBoundary noop key={id} onError={e => logger.error(`Failed to render ${id}`, e.error)}>
                            <Button {...props} />
                        </ErrorBoundary>
                    ))}
            </div>
            {settings.betterUserArea && nameTagTarget && currentUser?.id && (
                (ReactDOM as any).createPortal(<UserAreaBadges userId={currentUser.id} />, nameTagTarget)
            )}
        </>
    );
}

export function _renderButtons(props: UserAreaRenderProps) {
    return [<UserAreaButtons key="vc-user-area-buttons" props={props} />];
}
