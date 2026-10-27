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
        description: "Delay before deletion (up to 3 hours)",
        markers: [5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200, 10800],
        default: 30,
        stickToMarkers: false,
        restartNeeded: false,
    },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDelayReadable(sec: number): string {
    if (sec >= 3600) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    return `${sec}s`;
}

function formatCountdown(remainingSec: number): string {
    if (remainingSec <= 0) return "0s";
    const h = Math.floor(remainingSec / 3600);
    const m = Math.floor((remainingSec % 3600) / 60);
    const s = remainingSec % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    if (m > 0) {
        return `${m}:${s.toString().padStart(2, "0")}`;
    }
    return `${s}s`;
}

// ── Timer tracking ─────────────────────────────────────────────────────────────

interface TimerEntry {
    channelId: string;
    messageId: string;
    expiresAt: number;
    timerId: ReturnType<typeof setTimeout>;
}

const activeTimers = new Map<string, TimerEntry>();
const nonceToRealId = new Map<string, string>();
const timerListeners = new Set<() => void>();

function notifyListeners() {
    for (const fn of timerListeners) {
        try { fn(); } catch { }
    }
}

function getTimer(id?: string): TimerEntry | undefined {
    if (!id) return undefined;
    if (activeTimers.has(id)) return activeTimers.get(id);
    const realId = nonceToRealId.get(id);
    if (realId && activeTimers.has(realId)) return activeTimers.get(realId);
    return undefined;
}

function transferTimer(oldId: string, newId: string) {
    if (!oldId || !newId || oldId === newId) return;
    nonceToRealId.set(oldId, newId);
    const existing = activeTimers.get(oldId);
    if (existing) {
        existing.messageId = newId;
        activeTimers.delete(oldId);
        activeTimers.set(newId, existing);
        notifyListeners();
    }
}

async function doDeleteMessage(channelId: string, messageId: string) {
    const realId = nonceToRealId.get(messageId) ?? messageId;

    // 1. Local optimistic deletion in client
    try {
        const actions = (findByProps("deleteMessage", "sendMessage") || findByProps("deleteMessage")) as any;
        if (typeof actions?.deleteMessage === "function") {
            actions.deleteMessage(channelId, realId);
        }
    } catch { }

    // 2. Authoritative Discord REST API deletion
    try {
        const res = await RestAPI.del({ url: `/channels/${channelId}/messages/${realId}` });
        if (res?.ok || res?.status === 204 || res?.status === 200 || res?.status === 404) {
            return;
        }
    } catch (err: any) {
        const status = err?.status || err?.statusCode;
        if (status === 404 || err?.body?.code === 10008) return; // already deleted
        if (status === 429) {
            const retryAfter = (err?.body?.retry_after ?? 1) * 1000;
            setTimeout(() => {
                RestAPI.del({ url: `/channels/${channelId}/messages/${realId}` }).catch(() => { });
            }, retryAfter);
            return;
        }
        console.warn("[SelfDestruct] RestAPI.del encountered error:", err);
    }
}

function scheduleDelete(channelId: string, messageId: string, delaySec: number) {
    if (getTimer(messageId)) return;

    const expiresAt = Date.now() + delaySec * 1000;

    const timerId = setTimeout(async () => {
        const realId = nonceToRealId.get(messageId) ?? messageId;
        activeTimers.delete(messageId);
        activeTimers.delete(realId);
        notifyListeners();

        try {
            await doDeleteMessage(channelId, realId);
        } catch (e) {
            console.error("[SelfDestruct] Delete failed:", e);
        }

        try {
            updateMessage(channelId, realId);
        } catch { }
    }, delaySec * 1000);

    activeTimers.set(messageId, { channelId, messageId, expiresAt, timerId });
    notifyListeners();

    // Trigger re-render of message so TimerBadge appears immediately
    try {
        updateMessage(channelId, messageId);
    } catch { }
    setTimeout(() => {
        try {
            const realId = nonceToRealId.get(messageId) ?? messageId;
            updateMessage(channelId, realId);
        } catch { }
    }, 150);
}

function cancelTimer(id: string) {
    const realId = nonceToRealId.get(id) ?? id;
    const entry = activeTimers.get(id) || activeTimers.get(realId);
    if (entry) {
        clearTimeout(entry.timerId);
        activeTimers.delete(entry.messageId);
        activeTimers.delete(id);
        activeTimers.delete(realId);
        notifyListeners();
        try {
            updateMessage(entry.channelId, entry.messageId);
        } catch { }
    }
}

function cleanup() {
    for (const [, entry] of activeTimers) {
        clearTimeout(entry.timerId);
    }
    activeTimers.clear();
    nonceToRealId.clear();
    timerListeners.clear();
}

// ── Timer Badge Component ──────────────────────────────────────────────────────

function TimerBadge({ messageId, inline = false }: { messageId: string; inline?: boolean; }) {
    const [remaining, setRemaining] = React.useState<number | null>(() => {
        const entry = getTimer(messageId);
        if (!entry) return null;
        return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    });

    React.useEffect(() => {
        function update() {
            const entry = getTimer(messageId);
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

    const timeStr = formatCountdown(remaining);

    return (
        <span
            className="nc-selfdestruct-timer"
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                marginLeft: inline ? "6px" : "4px",
                marginRight: "4px",
                padding: "1px 6px",
                borderRadius: "10px",
                backgroundColor: "rgba(237, 66, 69, 0.15)",
                color: "#ed4245",
                fontSize: "11px",
                fontWeight: 600,
                fontFamily: "var(--font-primary)",
                lineHeight: "14px",
                verticalAlign: "middle",
                userSelect: "none",
                cursor: "pointer",
                transition: "background-color 0.15s ease",
            }}
            onClick={e => {
                e.stopPropagation();
                cancelTimer(messageId);
            }}
            title={t("SelfDestruct — this message will be deleted automatically") + " (" + t("click to cancel") + ")"}
        >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" stroke="#ed4245" strokeWidth="2.5" fill="none" />
                <path d="M12 6v6l4 2" stroke="#ed4245" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span>{timeStr}</span>
        </span>
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
    const delayStr = formatDelayReadable(delaySec);

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
    if (!settings.store.active) return;

    const currentUserId = UserStore?.getCurrentUser?.()?.id;
    if (!currentUserId) return;

    const message = event?.message;
    const authorId = message?.author?.id ?? message?.authorId;

    // In MESSAGE_SEND_SUCCESS, authorId may be omitted on optimistic/partial payloads
    if (authorId && authorId !== currentUserId) return;

    const channelId = event?.channelId || message?.channel_id || message?.channelId;
    if (!channelId) return;

    // In MESSAGE_SEND_SUCCESS: event.messageId is nonce, message.id is real snowflake
    const nonce = event?.messageId || message?.nonce;
    const realId = message?.id;

    if (nonce && realId && nonce !== realId) {
        transferTimer(nonce, realId);
    }

    const targetId = realId || nonce;
    if (!targetId) return;

    if (!getTimer(targetId)) {
        const delaySec = settings.store.delay ?? 30;
        scheduleDelete(channelId, targetId, delaySec);
    }
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
    dependencies: ["ChatInputButtonAPI", "MessageAccessoriesAPI", "MessageDecorationsAPI", "MessageUpdaterAPI"],
    settings,

    chatBarButton: {
        icon: () => <SelfDestructIcon active={settings.store.active} />,
        render: SelfDestructButton,
    },

    patches: [
        {
            find: '.CUSTOM_GIFT?""',
            replacement: [
                {
                    match: /childrenMessageContent:(\i),/g,
                    replace: "childrenMessageContent:$self.wrapContent($1,arguments[0]),",
                },
            ],
        },
    ],

    wrapContent(content: any, itemProps: any) {
        const messageId = itemProps?.message?.id;
        if (!messageId || !getTimer(messageId)) return content;
        // If header exists, renderMessageDecoration already renders the badge next to username/timestamp
        if (itemProps?.childrenHeader) return content;
        // Otherwise (continuation message without header), render next to content
        return (
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap" }}>
                {content}
                <TimerBadge messageId={messageId} inline />
            </div>
        );
    },

    renderMessageDecoration(props: any) {
        const messageId = props?.message?.id;
        if (!messageId || !getTimer(messageId)) return null;
        return <TimerBadge messageId={messageId} />;
    },

    renderMessageAccessory(props: Record<string, any>) {
        const messageId = props?.message?.id;
        if (!messageId || !getTimer(messageId)) return null;
        return null;
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
        // Session-based timers
    },

    stop() {
        cleanup();
    },
});
