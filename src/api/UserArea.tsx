/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { findComponentByCodeLazy } from "@webpack";
import { useEffect, useState } from "@webpack/common";
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

function UserAreaButtons({ props }: { props: UserAreaRenderProps; }) {
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        addStealthListener(listener);
        window.addEventListener("nightcord-stealth-change", listener);
        return () => {
            removeStealthListener(listener);
            window.removeEventListener("nightcord-stealth-change", listener);
        };
    }, []);

    if (isStealthModeEnabled()) return null;

    return (
        <>
            <style>{`
                /* ── Clean UserArea layout ──
                   Ensure all buttons (AntiMove, FakeVoice, Ghost, Mute, Deafen, Settings)
                   stay cleanly aligned on a single row without wrapping, double-decking, or inflating container height.
                   Nametag truncates gracefully when the sidebar is narrowed. */

                /* 1. Account popout wrapper and nametag shrinking */
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

                /* 2. User area buttons container stays strictly on one row */
                div[class*="buttons_"]:has(> .vc-user-area-btns) {
                    display: flex !important;
                    flex-wrap: nowrap !important;
                    flex-shrink: 0 !important;
                    align-items: center !important;
                }

                /* 3. Ensure audio button parents and individual buttons never shrink */
                div[class*="buttons_"]:has(> .vc-user-area-btns) [class*="audioButtonParent_"],
                div[class*="buttons_"]:has(> .vc-user-area-btns) > button,
                div[class*="buttons_"]:has(> .vc-user-area-btns) > div,
                .vc-user-area-btns > button,
                .vc-user-area-btns > div {
                    flex-shrink: 0 !important;
                }

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
        </>
    );
}

export function _renderButtons(props: UserAreaRenderProps) {
    return [<UserAreaButtons key="vc-user-area-buttons" props={props} />];
}
