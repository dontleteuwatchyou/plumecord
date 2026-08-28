/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { Button, React, useEffect, useRef, useState } from "@webpack/common";

import { NotificationData } from "./Notifications";

export function NightcordLogoIcon(props: any) {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <rect width="24" height="24" rx="6" fill="var(--brand-500, #5865f2)" />
            <path
                d="M7.89 13.46a1 1 0 0 1-1.78-.9L7 13l-.9-.45.01-.01.01-.02a2.24 2.24 0 0 1 .14-.23c.1-.14.23-.31.4-.5.37-.36.98-.79 1.84-.79.86 0 1.47.43 1.83.8a3.28 3.28 0 0 1 .55.72v.02h.01v.01L10 13l.9-.45a1 1 0 0 1-1.79.9 1.28 1.28 0 0 0-.19-.25c-.14-.13-.28-.2-.42-.2-.14 0-.28.07-.42.2a1.28 1.28 0 0 0-.19.25ZM13.55 13.9a1 1 0 0 0 1.34-.44c0-.02.02-.04.04-.06.03-.05.08-.13.15-.2.14-.13.28-.2.42-.2.14 0 .28.07.42.2a1.28 1.28 0 0 1 .19.25 1 1 0 0 0 1.78-.9L17 13l.9-.45-.01-.01-.01-.02a2.1 2.1 0 0 0-.14-.23 3.28 3.28 0 0 0-.4-.5c-.37-.36-.98-.79-1.84-.79-.86 0-1.47.43-1.83.8a3.28 3.28 0 0 0-.55.72v.02h-.01v.01L14 13l-.9-.45a1 1 0 0 0 .45 1.34Z"
                fill="#ffffff"
            />
            <path
                fillRule="evenodd"
                d="M12 20c4.97 0 9-1.67 9-5.4 0-5.03-2.52-9.06-3.83-10.5a1 1 0 1 0-1.48 1.34 14.8 14.8 0 0 1 2.35 3.86A10.23 10.23 0 0 0 12 6.5C9.47 6.5 7.15 7.52 5.4 9.03a14.8 14.8 0 0 1 2.34-3.86 1 1 0 1 0-1.48-1.34A18.65 18.65 0 0 0 3 14.6c0 3.73 4.03 5.4 9 5.4Zm0-10.8c3.48 0 6.3 1.8 6.3 3.78S15.48 16.4 12 16.4s-6.3-1.44-6.3-3.42C5.7 11 8.52 9.2 12 9.2Z"
                clipRule="evenodd"
                fill="#ffffff"
            />
        </svg>
    );
}

function StatusIcon({ type }: { type?: "success" | "info" | "warning" | "error"; }) {
    switch (type) {
        case "success":
            return (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-positive, #23a55a)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="16 10 11 15 8 12" />
                </svg>
            );
        case "warning":
            return (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-warning, #f0b232)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
            );
        case "error":
            return (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-danger, #ed4245)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
            );
        case "info":
        default:
            return <NightcordLogoIcon />;
    }
}

export default ErrorBoundary.wrap(function NotificationComponent({
    title,
    body,
    richBody,
    type = "info",
    color,
    icon,
    onClick,
    onClose,
    image,
    permanent,
    actions = [],
    duration,
    className,
    dismissOnClick
}: NotificationData & { className?: string; }) {
    const { timeout: settingsTimeout } = useSettings(["notifications.timeout", "notifications.position"]).notifications;
    const effectiveTimeout = duration ?? (settingsTimeout > 0 ? settingsTimeout : 5000);

    const [isHover, setIsHover] = useState(false);
    const [elapsed, setElapsed] = useState(0);

    const start = useRef(Date.now());
    const pause = useRef<number | null>(null);

    useEffect(() => {
        if (effectiveTimeout === 0 || permanent) return;

        if (isHover) {
            if (pause.current === null) pause.current = Date.now();
            return;
        }

        if (pause.current !== null) {
            const pausedFor = Date.now() - pause.current;
            start.current += pausedFor;
            pause.current = null;
        }

        const intervalId = setInterval(() => {
            const elapsedNow = Date.now() - start.current;
            if (elapsedNow >= effectiveTimeout) {
                onClose?.();
            } else {
                setElapsed(elapsedNow);
            }
        }, 16);

        return () => clearInterval(intervalId);
    }, [effectiveTimeout, isHover, permanent]);

    const timeoutProgress = effectiveTimeout > 0 ? elapsed / effectiveTimeout : 0;

    const progressColor = color || (
        type === "success" ? "var(--status-positive, #23a55a)" :
        type === "warning" ? "var(--status-warning, #f0b232)" :
        type === "error" ? "var(--status-danger, #ed4245)" :
        "var(--brand-500, #5865f2)"
    );

    const renderCustomIcon = () => {
        if (icon === "nightcord" || !icon) return <NightcordLogoIcon />;
        if (typeof icon === "function") {
            const IconComponent = icon as React.ComponentType<any>;
            return <IconComponent />;
        }
        if (typeof icon === "string") {
            if (icon.startsWith("http") || icon.startsWith("data:")) {
                return <img className="nc-notif-custom-icon" src={icon} alt="icon" />;
            }
            return <span className="nc-notif-emoji-icon">{icon}</span>;
        }
        return <StatusIcon type={type} />;
    };

    return (
        <div
            className={classes("nc-notification-card", `nc-notification-${type}`, className)}
            onClick={() => {
                onClick?.();
                if (dismissOnClick !== false && actions.length === 0)
                    onClose?.();
            }}
            onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                onClose?.();
            }}
            onMouseEnter={() => setIsHover(true)}
            onMouseLeave={() => setIsHover(false)}
        >
            <div className="nc-notification-main">
                {/* Header */}
                <div className="nc-notification-header">
                    <div className="nc-notification-header-left">
                        <div className="nc-notification-icon-wrap">
                            {renderCustomIcon()}
                        </div>
                        {title && <span className="nc-notification-title">{title}</span>}
                    </div>
                    <button
                        className="nc-notification-close-btn"
                        onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            onClose?.();
                        }}
                        aria-label="Close"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="nc-notification-body">
                    {richBody ?? <div className="nc-notification-text">{body}</div>}
                </div>

                {/* Optional Media Image */}
                {image && <img className="nc-notification-image" src={image} alt="" />}

                {/* Optional Actions Buttons */}
                {actions.length > 0 && (
                    <div className="nc-notification-actions">
                        {actions.map((act, i) => (
                            <Button
                                key={i}
                                size={Button.Sizes.TINY}
                                color={act.color ?? (i === 0 ? Button.Colors.BRAND : Button.Colors.PRIMARY)}
                                look={act.look ?? Button.Looks.FILLED}
                                onClick={(e: any) => {
                                    e.stopPropagation();
                                    act.onClick?.(e);
                                    onClose?.();
                                }}
                                className="nc-notification-action-btn"
                            >
                                {act.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom Progress Bar */}
            {effectiveTimeout > 0 && !permanent && (
                <div className="nc-notification-progress-bg">
                    <div
                        className="nc-notification-progress-fill"
                        style={{
                            width: `${Math.max(0, (1 - timeoutProgress) * 100)}%`,
                            backgroundColor: progressColor
                        }}
                    />
                </div>
            )}
        </div>
    );
}, {
    onError: ({ props }) => props.onClose?.()
});
