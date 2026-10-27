/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { updateMessage } from "@api/MessageUpdater";
import { definePluginSettings } from "@api/Settings";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { React, RestAPI, UserStore } from "@webpack/common";
import plugins from "~plugins";
import { t } from "../autoTranslateNightcord";

// ── Settings ───────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "SelfDestruct active (toggle in chat bar)",
        default: false,
        restartNeeded: false,
    },
    delay: {
        type: OptionType.SLIDER,
        description: "Delay before deletion (seconds)",
        markers: [5, 10, 15, 30, 60, 120, 300, 600],
        default: 30,
        stickToMarkers: false,
        restartNeeded: false,
    },
});

// ── Timer tracking ─────────────────────────────────────────────────────────────

interface TimerEntry {
    channelId: string;
    messageId: string;
    expiresAt: number;
    timerId: ReturnType<typeof setTimeout>;
}

const activeTimers = new Map<string, TimerEntry>();
const timerListeners = new Set<() => void>();

function notifyListeners() {
    for (const fn of timerListeners) {
        try { fn(); } catch { }
    }
}

async function doDeleteMessage(channelId: string, messageId: string) {
    // 1. Direct Discord REST API deletion (most robust, works in all versions)
    try {
        const res = await RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` });
        if (res?.ok || res?.status === 204 || res?.status === 200 || res?.status === 404) {
            return;
        }
    } catch (err: any) {
        if (err?.status === 404 || err?.statusCode === 404) return;
        console.warn("[SelfDestruct] RestAPI.del encountered error, trying MessageActions fallback:", err);
    }

    // 2. Discord internal MessageActions fallback
    try {
        const actions = (findByProps("deleteMessage", "sendMessage") || findByProps("deleteMessage")) as any;
        if (typeof actions?.deleteMessage === "function") {
            await actions.deleteMessage(channelId, messageId);
        }
    } catch (e) {
        console.error("[SelfDestruct] MessageActions.deleteMessage failed:", e);
    }
}

function scheduleDelete(channelId: string, messageId: string, delaySec: number) {
    if (activeTimers.has(messageId)) return;

    const expiresAt = Date.now() + delaySec * 1000;

    const timerId = setTimeout(async () => {
        try {
            await doDeleteMessage(channelId, messageId);
        } catch (e) {
            console.error("[SelfDestruct] Delete failed:", e);
        }
        activeTimers.delete(messageId);
        notifyListeners();
        try {
            updateMessage(channelId, messageId);
        } catch { }
    }, delaySec * 1000);

    activeTimers.set(messageId, { channelId, messageId, expiresAt, timerId });
    notifyListeners();

    // Trigger re-render of message so TimerBadge appears immediately
    try {
        updateMessage(channelId, messageId);
    } catch { }
}

function cancelTimer(messageId: string) {
    const entry = activeTimers.get(messageId);
    if (entry) {
        clearTimeout(entry.timerId);
        activeTimers.delete(messageId);
        notifyListeners();
        try {
            updateMessage(entry.channelId, messageId);
        } catch { }
    }
}

function cleanup() {
    for (const [, entry] of activeTimers) {
        clearTimeout(entry.timerId);
    }
    activeTimers.clear();
    timerListeners.clear();
}

// ── Timer Badge Component (rendered on messages) ───────────────────────────────

function TimerBadge({ messageId }: { messageId: string; }) {
    const [remaining, setRemaining] = React.useState<number | null>(() => {
        const entry = activeTimers.get(messageId);
        if (!entry) return null;
        return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    });

    React.useEffect(() => {
        function update() {
            const entry = activeTimers.get(messageId);
            if (!entry) {
                setRemaining(null);
                return;
            }
            const left = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
            setRemaining(left);
        }

        update();
        const interval = setInterval(update, 500);

        const listener = () => update();
        timerListeners.add(listener);

        return () => {
            clearInterval(interval);
            timerListeners.delete(listener);
        };
    }, [messageId]);

    if (remaining === null) return null;

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const timeStr = minutes > 0
        ? `${minutes}:${seconds.toString().padStart(2, "0")}`
        : `${seconds}s`;

    return (
        <div
            className="nc-selfdestruct-timer"
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                marginTop: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                backgroundColor: "rgba(237, 66, 69, 0.12)",
                color: "#ed4245",
                fontSize: "12px",
                fontWeight: 600,
                fontFamily: "var(--font-primary)",
                lineHeight: "18px",
                userSelect: "none",
                width: "fit-content",
            }}
            title={t("SelfDestruct — this message will be deleted automatically")}
        >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" stroke="#ed4245" strokeWidth="2" fill="none" />
                <path d="M12 6v6l4 2" stroke="#ed4245" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>{timeStr}</span>
        </div>
    );
}

// ── Chat Bar Icon ──────────────────────────────────────────────────────────────

function SelfDestructIcon({ active, width = 20, height = 20 }: { active?: boolean; width?: number; height?: number; }) {
    return (
        <svg
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
            style={{ color: active ? "#ed4245" : "currentColor" }}
        >
            <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M12 9v4l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 5V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M10 3h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            {!active && (
                <path
                    fill="var(--status-danger)"
                    d="M21.178 1.707 22.592 3.12 4.12 21.593l-1.414-1.415L21.178 1.707Z"
                />
            )}
        </svg>
    );
}

// ── Chat Bar Button ────────────────────────────────────────────────────────────

const SelfDestructButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [active, setActive] = React.useState(settings.store.active);

    if (!isMainChat) return null;

    function toggle() {
        settings.store.active = !settings.store.active;
        setActive(settings.store.active);
    }

    const delaySec = settings.store.delay ?? 30;
    const delayStr = delaySec >= 60 ? `${Math.floor(delaySec / 60)}m${delaySec % 60 ? (delaySec % 60) + "s" : ""}` : `${delaySec}s`;

    const tooltip = active
        ? t("SelfDestruct: ON") + ` (${delayStr}) — ` + t("click to disable")
        : t("SelfDestruct: OFF — click to enable");

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={toggle}
            onContextMenu={e => {
                e.preventDefault();
                openPluginModal(plugins["SelfDestruct"] ?? plugins["selfDestruct"]);
            }}
        >
            <SelfDestructIcon active={active} />
        </ChatBarButton>
    );
};

// ── Message Handlers ───────────────────────────────────────────────────────────

function handleIncomingMessage(event: any) {
    if (event?.optimistic) return;
    if (!settings.store.active) return;

    const message = event?.message;
    const channelId = event?.channelId || message?.channel_id || message?.channelId;
    const messageId = event?.messageId || message?.id;

    if (!channelId || !messageId) return;
    if (activeTimers.has(messageId)) return;

    const currentUserId = UserStore?.getCurrentUser?.()?.id;
    if (!currentUserId) return;

    const authorId = message?.author?.id ?? message?.authorId;
    if (authorId && authorId !== currentUserId) return;

    const delaySec = settings.store.delay ?? 30;
    scheduleDelete(channelId, messageId, delaySec);
}

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "SelfDestruct",
    enabledByDefault: true,
    description: "Sends messages that are automatically deleted after a configurable delay. Red timer visible on each message.",
    authors: [{
        name: "Nightcord",
        id: 0n
    }],
    dependencies: ["ChatInputButtonAPI", "MessageAccessoriesAPI", "MessageUpdaterAPI"],
    settings,

    chatBarButton: {
        icon: () => <SelfDestructIcon active={settings.store.active} />,
        render: SelfDestructButton,
    },

    renderMessageAccessory(props: Record<string, any>) {
        const message = props?.message;
        if (!message?.id || !activeTimers.has(message.id)) return null;
        return <TimerBadge messageId={message.id} />;
    },

    flux: {
        MESSAGE_CREATE(event: any) {
            handleIncomingMessage(event);
        },
        MESSAGE_SEND_SUCCESS(event: any) {
            handleIncomingMessage(event);
        },
        MESSAGE_DELETE(event: any) {
            const id = event?.id || event?.message?.id;
            if (id) cancelTimer(id);
        }
    },

    start() {
        // Clean start - timers are runtime session based
    },

    stop() {
        cleanup();
    },
});
