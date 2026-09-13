/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
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
                /* ── Auto-adaptive UserArea layout ──
                   Ensure all buttons (AntiMove, FakeVoice, Ghost, Mute, Deafen, Settings)
                   ALWAYS stay strictly inside the panel container, regardless of width or resizing/deforming.
                   Buttons keep their exact size and spacing without being cut off. */

                /* 1. Container wrapping and fluid auto-height */
                section[class*="panels_"] > div[class*="container_"],
                div[class*="container_"]:has(> div[class*="buttons_"]),
                div[class*="containerRtcOpened_"] {
                    flex-wrap: wrap !important;
                    height: auto !important;
                    min-height: 52px !important;
                    padding-top: 4px !important;
                    padding-bottom: 4px !important;
                    row-gap: 4px !important;
                    box-sizing: border-box !important;
                    overflow: visible !important;
                }

                /* Ensure section panels doesn't clip when container expands */
                section[class*="panels_"] {
                    height: auto !important;
                    overflow: visible !important;
                }

                /* 2. Account popout wrapper and nametag shrinking */
                section[class*="panels_"] div[class*="accountPopoutButtonWrapper_"] {
                    min-width: 0 !important;
                    flex: 1 1 auto !important;
                    flex-shrink: 1 !important;
                }

                section[class*="panels_"] div[class*="nameTag_"],
                div[class*="nameTag_"] {
                    min-width: 0 !important;
                    flex-shrink: 1 !important;
                }

                section[class*="panels_"] div[class*="nameTag_"] *,
                div[class*="nameTag_"] > * {
                    min-width: 0 !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                }

                /* 3. Buttons container wraps cleanly when space is tight */
                section[class*="panels_"] div[class*="buttons_"],
                div[class*="buttons_"]:has(> .vc-user-area-btns) {
                    display: flex !important;
                    flex-wrap: wrap !important;
                    flex: 0 0 auto !important;
                    max-width: 100% !important;
                    align-items: center !important;
                    row-gap: 2px !important;
                }

                /* 4. Ensure audio button parents and individual buttons never shrink or change spacing */
                section[class*="panels_"] div[class*="audioButtonParent_"] {
                    display: flex !important;
                    flex-shrink: 0 !important;
                    white-space: nowrap !important;
                }

                section[class*="panels_"] div[class*="buttons_"] > button,
                section[class*="panels_"] div[class*="buttons_"] > div,
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
