/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ChatButton.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { IconComponent } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Clickable, Tooltip, useEffect, useState, Popout, useRef, React } from "@webpack/common";
import type { HTMLProps, JSX, MouseEventHandler, ReactNode } from "react";

import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import plugins from "~plugins";

import { addCompactListener, addStealthListener, isCompactModeEnabled, isStealthModeEnabled, removeCompactListener, removeStealthListener, toggleCompactMode } from "./HeaderBar";
import { useSettings } from "./Settings";

export const CurrentChatPluginContext = React.createContext<string | null>(null);

function resolvePlugin(id?: string | null) {
    if (!id) return null;
    return (
        plugins[id] ??
        plugins[id.toLowerCase()] ??
        plugins[id.charAt(0).toUpperCase() + id.slice(1)] ??
        Object.values(plugins).find(p => p.name.toLowerCase() === id.toLowerCase())
    );
}

const ButtonWrapperClasses = findCssClassesLazy("button", "buttonWrapper", "notificationDot");
const ChannelTextAreaClasses = findCssClassesLazy("buttonContainer", "channelTextArea", "button");

export interface ChatBarProps {
    channel: Channel;
    disabled: boolean;
    isEmpty: boolean;
    type: {
        analyticsName: string;
        attachments: boolean;
        autocomplete: {
            addReactionShortcut: boolean,
            forceChatLayer: boolean,
            reactions: boolean;
        },
        commands: {
            enabled: boolean;
        },
        drafts: {
            type: number,
            commandType: number,
            autoSave: boolean;
        },
        emojis: {
            button: boolean;
        },
        gifs: {
            button: boolean,
            allowSending: boolean;
        },
        gifts: {
            button: boolean;
        },
        permissions: {
            requireSendMessages: boolean;
        },
        showThreadPromptOnReply: boolean,
        stickers: {
            button: boolean,
            allowSending: boolean,
            autoSuggest: boolean;
        },
        users: {
            allowMentioning: boolean;
        },
        submit: {
            button: boolean,
            ignorePreference: boolean,
            disableEnterToSubmit: boolean,
            clearOnSubmit: boolean,
            useDisabledStylesOnSubmit: boolean;
        },
        uploadLongMessages: boolean,
        upsellLongMessages: {
            iconOnly: boolean;
        },
        showCharacterCount: boolean,
        sedReplace: boolean;
    };
}

export type ChatBarButtonFactory = (props: ChatBarProps & { isMainChat: boolean; isAnyChat: boolean; }) => JSX.Element | null;
export type ChatBarButtonData = {
    render: ChatBarButtonFactory;
    /**
     * This icon is used only for Settings UI. Your render function must still render an icon,
     * and it can be different from this one.
     */
    icon: IconComponent;
};

/**
 * Don't use this directly, use {@link addChatBarButton} and {@link removeChatBarButton} instead.
 */
export const ChatBarButtonMap = new Map<string, ChatBarButtonData>();
const logger = new Logger("ChatButtons");

/**
 * Set of button IDs hidden by the Backpack plugin.
 * Buttons in this set are rendered inside the Backpack popout instead of the main bar.
 */
export const BackpackedButtons = new Set<string>();
export const backpackListeners = new Set<() => void>();
export function notifyBackpackChange() { backpackListeners.forEach(l => l()); }

function VencordChatBarButtons(props: ChatBarProps) {
    const { chatBarButtons } = useSettings(["uiElements.chatBarButtons.*"]).uiElements;
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        addStealthListener(listener);
        addCompactListener(listener);
        window.addEventListener("nightcord-stealth-change", listener);
        window.addEventListener("nightcord-compact-change", listener);
        backpackListeners.add(listener);
        return () => {
            removeStealthListener(listener);
            removeCompactListener(listener);
            window.removeEventListener("nightcord-stealth-change", listener);
            window.removeEventListener("nightcord-compact-change", listener);
            backpackListeners.delete(listener);
        };
    }, []);

    if (isStealthModeEnabled()) return null;

    if (isCompactModeEnabled()) {
        return (
            <div className="vc-chat-bar-btns" style={{ display: "contents" }}>
                <CompactChatBarToggle chatBarProps={props} />
            </div>
        );
    }

    const { analyticsName } = props.type;
    return (
        <div className="vc-chat-bar-btns" style={{ display: "contents" }}>
            {Array.from(ChatBarButtonMap)
                .filter(([key]) => chatBarButtons[key]?.enabled !== false && !BackpackedButtons.has(key))
                .sort(([a], [b]) => (a === "Backpack" ? -1 : b === "Backpack" ? 1 : 0))
                .map(([key, { render: Button }]) => (
                    <CurrentChatPluginContext.Provider value={key} key={key}>
                        <div
                            style={{ display: "contents" }}
                            onContextMenu={e => {
                                if (e.defaultPrevented) return;
                                const plugin = resolvePlugin(key);
                                if (plugin) {
                                    e.preventDefault();
                                    openPluginModal(plugin);
                                }
                            }}
                        >
                            <ErrorBoundary noop onError={e => logger.error(`Failed to render ${key}`, e.error)}>
                                <Button {...props} isMainChat={analyticsName === "normal"} isAnyChat={["normal", "sidebar"].includes(analyticsName)} />
                            </ErrorBoundary>
                        </div>
                    </CurrentChatPluginContext.Provider>
                ))}
        </div>
    );
}

export function _injectButtons(buttons: ReactNode[], props: ChatBarProps) {
    if (props.disabled || buttons.length === 0) return;
    // Guard: don't inject if already present (patch may fire in multiple bundle modules)
    if ((buttons as any[]).some((b: any) => b?.key === "vencord-chat-buttons")) return;

    buttons.unshift(<VencordChatBarButtons key="vencord-chat-buttons" {...props} />);
}

/**
 * The icon argument is used only for Settings UI. Your render function must still render an icon,
 * and it can be different from this one.
 */
export const addChatBarButton = (id: string, render: ChatBarButtonFactory, icon: IconComponent) => ChatBarButtonMap.set(id, { render, icon });
export const removeChatBarButton = (id: string) => ChatBarButtonMap.delete(id);

export interface ChatBarButtonProps {
    children: ReactNode;
    tooltip: string;
    onClick: MouseEventHandler;
    onContextMenu?: MouseEventHandler;
    onAuxClick?: MouseEventHandler;
    buttonProps?: Omit<HTMLProps<HTMLDivElement>, "size" | "onClick" | "onContextMenu" | "onAuxClick">;
}

export const ChatBarButton = ErrorBoundary.wrap((props: ChatBarButtonProps) => {
    const pluginKey = React.useContext(CurrentChatPluginContext);

    const handleContextMenu = (e: React.MouseEvent) => {
        if (props.onContextMenu) {
            props.onContextMenu(e);
        }
        if (!e.defaultPrevented && pluginKey) {
            const plugin = resolvePlugin(pluginKey);
            if (plugin) {
                e.preventDefault();
                openPluginModal(plugin);
            }
        }
    };

    return (
        <Tooltip text={props.tooltip}>
            {({ onMouseEnter, onMouseLeave }) => (
                <div className={`expression-picker-chat-input-button ${ChannelTextAreaClasses?.buttonContainer ?? ""}`}>
                    <Clickable
                        aria-label={props.tooltip}
                        onMouseEnter={onMouseEnter}
                        onMouseLeave={onMouseLeave}
                        className={classes(ButtonWrapperClasses.button, ChannelTextAreaClasses?.button)}
                        onClick={props.onClick}
                        onContextMenu={handleContextMenu}
                        onAuxClick={props.onAuxClick}
                        {...props.buttonProps}
                    >
                        <div className={ButtonWrapperClasses.buttonWrapper}>
                            {props.children}
                        </div>
                    </Clickable>
                </div>
            )}
        </Tooltip>
    );
}, { noop: true });

/* Vencord Buttons context menu removed — managed by Backpack plugin */

export type ChatBarButtonWrapper = (buttons: ReactNode) => ReactNode;

export interface ChatBarButtonWrapperData {
    wrapper: ChatBarButtonWrapper;
    priority: number;
}

/**
 * Registry for plugins that need to wrap the entire chat bar button container.
 * Wrappers are applied in ascending priority order (lower number = outermost wrapper).
 */
export const ChatBarButtonWrappers = new Map<string, ChatBarButtonWrapperData>();

export const addChatBarButtonWrapper = (id: string, wrapper: ChatBarButtonWrapper, priority: number = 0) => ChatBarButtonWrappers.set(id, { wrapper, priority });
export const removeChatBarButtonWrapper = (id: string) => ChatBarButtonWrappers.delete(id);

export function _wrapButtons(buttons: ReactNode) {
    if (!buttons) return buttons;
    const sorted = [...ChatBarButtonWrappers.values()]
        .sort((a, b) => a.priority - b.priority);

    let wrapped = buttons;
    for (const { wrapper } of sorted) {
        wrapped = wrapper(wrapped);
    }
    return wrapped;
}

function CompactChatPopout({ chatBarProps, closePopout }: any) {
    const { chatBarButtons } = useSettings(["uiElements.chatBarButtons.*"]).uiElements;
    const { analyticsName } = chatBarProps.type;
    return (
        <div className="compact-popout-container">
            <div className="compact-popout-grid">
                {Array.from(ChatBarButtonMap)
                    .filter(([key]) => key !== "Backpack" && chatBarButtons[key]?.enabled !== false)
                    .map(([key, { render: Button }]) => (
                        <CurrentChatPluginContext.Provider value={key} key={key}>
                            <div
                                style={{ display: "contents" }}
                                onClick={closePopout}
                                onContextMenu={e => {
                                    if (e.defaultPrevented) return;
                                    const plugin = resolvePlugin(key);
                                    if (plugin) {
                                        e.preventDefault();
                                        openPluginModal(plugin);
                                    }
                                }}
                            >
                                <ErrorBoundary noop>
                                    <Button {...chatBarProps} isMainChat={analyticsName === "normal"} isAnyChat={["normal", "sidebar"].includes(analyticsName)} />
                                </ErrorBoundary>
                            </div>
                        </CurrentChatPluginContext.Provider>
                    ))}
            </div>
            <div className="compact-popout-divider" />
            <div className="compact-popout-disable" onClick={() => { toggleCompactMode(); closePopout(); }}>
                Disable Compact Mode
            </div>
        </div>
    );
}

function CompactChatBarToggle({ chatBarProps }: any) {
    const [, forceUpdate] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const popoutRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        addCompactListener(listener);
        window.addEventListener("nightcord-compact-change", listener);
        return () => {
            removeCompactListener(listener);
            window.removeEventListener("nightcord-compact-change", listener);
        };
    }, []);

    const GridIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 3h7v7H3V3zm0 11h7v7H3v-7zm11-11h7v7h-7V3zm0 11h7v7h-7v-7z" />
        </svg>
    );

    return (
        <Popout
            targetElementRef={popoutRef}
            renderPopout={() => <CompactChatPopout chatBarProps={chatBarProps} closePopout={() => setIsOpen(false)} />}
            shouldShow={isOpen}
            onRequestClose={() => setIsOpen(false)}
            position="top"
            align="right"
            spacing={8}
        >
            {() => (
                <div ref={popoutRef as any} style={{ display: "flex", alignItems: "center" }}>
                    <ChatBarButton
                        tooltip="Compact Mode"
                        onClick={() => setIsOpen(v => !v)}
                    >
                        <GridIcon />
                    </ChatBarButton>
                </div>
            )}
        </Popout>
    );
}
