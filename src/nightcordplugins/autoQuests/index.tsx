/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { closeModal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { find, findByCodeLazy, findStore } from "@webpack";
import {
    ChannelStore,
    createRoot,
    GuildChannelStore,
    QuestStore,
    React,
    RestAPI,
    showToast,
    Text,
    Toasts,
    useCallback,
    useEffect,
    useState
} from "@webpack/common";
import { t } from "../autoTranslateNightcord";

const SUPPORTED_TASKS = [
    "WATCH_VIDEO",
    "PLAY_ON_DESKTOP",
    "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY",
    "WATCH_VIDEO_ON_MOBILE"
] as const;

type SupportedTask = typeof SUPPORTED_TASKS[number];

export interface QuestItemState {
    id: string;
    questName: string;
    taskType: SupportedTask;
    secondsNeeded: number;
    currentProgress: number;
    completed: boolean;
    quest: any;
}

let activeQuestStates: QuestItemState[] = [];
let isRunnerActive = false;
let currentRunningQuestId: string | null = null;
let activeStreamKey: string | null = null;
let currentQuestBeingHeartbeated: any = null;

const stateListeners = new Set<() => void>();

function notifyStateChanged() {
    for (const listener of stateListeners) {
        try { listener(); } catch {}
    }
}

export const settings = definePluginSettings({
    autoStart: {
        type: OptionType.BOOLEAN,
        description: "Automatically run active quests in the background when Discord opens",
        default: false
    },
    autoEnroll: {
        type: OptionType.BOOLEAN,
        description: "Automatically accept and enroll in available quests",
        default: true
    },
    showEverywhere: {
        type: OptionType.BOOLEAN,
        description: "Show the floating quest button on all Discord screens",
        default: false
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show notifications on quest progress and completion",
        default: true
    }
});

const reportVideoProgressNative = findByCodeLazy(".QUESTS_VIDEO_PROGRESS(") as ((questId: string, progress: number) => Promise<void>) | undefined;
const sendHeartbeatNative = findByCodeLazy(".QUESTS_HEARTBEAT(") as ((options: {
    questId: string;
    streamKey?: string;
    applicationId?: string;
    terminal?: boolean;
}) => Promise<void>) | undefined;
const enrollInQuestNative = findByCodeLazy('type:"QUESTS_ENROLL_BEGIN",') as ((questId: string, options?: any) => Promise<any>) | undefined;

function QuestCompassIcon({ size = 18 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" fillOpacity="0.25" />
        </svg>
    );
}

function PlayIcon({ size = 14 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
            <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
    );
}

function StopSquareIcon({ size = 14 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
            <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
    );
}

function ChevronIcon({ size = 12, expanded = false }: { size?: number; expanded?: boolean; }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
                transition: "transform 0.25s ease",
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                flexShrink: 0
            }}
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>
    );
}

function CheckmarkIcon({ size = 14 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--status-positive, #23a55a)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

function ExternalIcon({ size = 14 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    );
}

function getResolvedQuestsStore(): any {
    return (
        QuestStore ||
        (findStore("QuestStore") as any) ||
        (findStore("QuestsStore") as any) ||
        find(m => m?.quests && (m?.getQuest || m?.getQuests))
    );
}

function getAllQuestsFromStore(): any[] {
    const store = getResolvedQuestsStore();
    if (!store) return [];
    if (store.quests instanceof Map) {
        return Array.from(store.quests.values());
    }
    if (store.quests && typeof store.quests === "object") {
        return Object.values(store.quests);
    }
    if (typeof store.getQuests === "function") {
        const q = store.getQuests();
        if (q instanceof Map) return Array.from(q.values());
        if (Array.isArray(q)) return q;
        if (q && typeof q === "object") return Object.values(q);
    }
    return [];
}

async function enrollQuest(questId: string): Promise<boolean> {
    if (typeof enrollInQuestNative === "function") {
        try {
            await enrollInQuestNative(questId, {
                questContent: 1,
                questContentCTA: "ACCEPT_QUEST"
            });
            return true;
        } catch {}
    }
    try {
        await RestAPI.post({
            url: `/quests/${questId}/enroll`,
            body: { location: 11 }
        });
        return true;
    } catch {}
    try {
        await RestAPI.post({
            url: `/quests/${questId}/enroll`,
            body: {}
        });
        return true;
    } catch {}
    return false;
}

function getVoiceOrDMChannelId(): string | null {
    try {
        const sortedDMs = (ChannelStore as any)?.getSortedPrivateChannels?.();
        if (sortedDMs && sortedDMs.length > 0 && sortedDMs[0]?.id) {
            return sortedDMs[0].id;
        }
        const dmIds = (ChannelStore as any)?.getDMChannelIds?.() || (ChannelStore as any)?.getPrivateChannelIds?.();
        if (dmIds && dmIds.length > 0) {
            return dmIds[0];
        }
        if (GuildChannelStore && typeof (GuildChannelStore as any).getAllGuilds === "function") {
            const guilds = Object.values((GuildChannelStore as any).getAllGuilds());
            const voice = guilds.find((g: any) => g?.VOCAL && g.VOCAL.length > 0);
            if (voice) return voice.VOCAL[0].channel.id;
        }
    } catch {}
    return null;
}

export function refreshActiveQuests(): QuestItemState[] {
    const allQuests = getAllQuestsFromStore();
    const result: QuestItemState[] = [];

    for (const quest of allQuests) {
        if (!quest?.config) continue;
        const expiresAt = quest.config.expiresAt ? new Date(quest.config.expiresAt).getTime() : Infinity;
        if (expiresAt <= Date.now()) continue;

        const isCompleted = Boolean(quest.userStatus?.completedAt);
        const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
        if (!taskConfig?.tasks) continue;

        const taskType = SUPPORTED_TASKS.find(type => taskConfig.tasks[type] != null);
        if (!taskType) continue;

        const taskData = taskConfig.tasks[taskType];
        const secondsNeeded = taskData?.target ?? 0;
        const currentProgress = quest.userStatus?.progress?.[taskType]?.value ?? quest.userStatus?.streamProgressSeconds ?? 0;
        const questName = quest.config.messages?.questName || quest.config.questName || quest.config.messages?.gameTitle || quest.id;

        result.push({
            id: quest.id,
            questName,
            taskType,
            secondsNeeded,
            currentProgress,
            completed: isCompleted || currentProgress >= secondsNeeded,
            quest
        });
    }

    activeQuestStates = result;
    notifyStateChanged();
    return result;
}

async function processVideoStep(state: QuestItemState): Promise<boolean> {
    const { quest, secondsNeeded } = state;
    const speed = 1.5;
    const nextTime = Math.min(secondsNeeded, Math.floor(state.currentProgress + speed + Math.random()));

    let reported = false;
    if (typeof reportVideoProgressNative === "function") {
        try {
            await reportVideoProgressNative(quest.id, nextTime);
            reported = true;
        } catch {}
    }

    if (!reported) {
        try {
            const res = await RestAPI.post({
                url: `/quests/${quest.id}/video-progress`,
                body: { timestamp: nextTime }
            });
            if (res?.body?.completed_at != null || nextTime >= secondsNeeded) {
                state.completed = true;
            }
            reported = true;
        } catch {}
    }

    if (reported) {
        state.currentProgress = nextTime;
        if (state.currentProgress >= secondsNeeded) {
            state.completed = true;
        }
        notifyStateChanged();
        return true;
    }

    return false;
}

async function processHeartbeatStep(state: QuestItemState): Promise<boolean> {
    const { quest, taskType, secondsNeeded } = state;

    const channelId = getVoiceOrDMChannelId();
    const streamKey = channelId ? `call:${channelId}:1` : `call:${quest.id}:1`;
    const appId = state.quest?.config?.taskConfig?.tasks?.[taskType]?.applications?.[0]?.id;

    activeStreamKey = streamKey;
    currentQuestBeingHeartbeated = quest;

    let reported = false;
    if (typeof sendHeartbeatNative === "function") {
        try {
            await sendHeartbeatNative({
                questId: quest.id,
                streamKey,
                applicationId: appId,
                terminal: false
            });
            reported = true;
        } catch {}
    }

    if (!reported) {
        try {
            const response = await RestAPI.post({
                url: `/quests/${quest.id}/heartbeat`,
                body: { stream_key: streamKey, terminal: false }
            });
            const srv = response?.body?.progress?.[taskType]?.value;
            if (typeof srv === "number") {
                state.currentProgress = srv;
            } else {
                state.currentProgress = Math.min(secondsNeeded, state.currentProgress + 20);
            }
            reported = true;
        } catch {}
    }

    if (reported) {
        if (state.currentProgress < secondsNeeded) {
            state.currentProgress = Math.min(secondsNeeded, state.currentProgress + 20);
        }
        if (state.currentProgress >= secondsNeeded) {
            state.completed = true;
            try {
                if (typeof sendHeartbeatNative === "function") {
                    await sendHeartbeatNative({
                        questId: quest.id,
                        streamKey,
                        applicationId: appId,
                        terminal: true
                    });
                } else {
                    await RestAPI.post({
                        url: `/quests/${quest.id}/heartbeat`,
                        body: { stream_key: streamKey, terminal: true }
                    });
                }
            } catch {}
            activeStreamKey = null;
            currentQuestBeingHeartbeated = null;
        }
        notifyStateChanged();
        return true;
    }

    return false;
}

export async function stopQuestRunner() {
    if (!isRunnerActive) return;
    isRunnerActive = false;

    if (activeStreamKey && currentQuestBeingHeartbeated) {
        try {
            if (typeof sendHeartbeatNative === "function") {
                await sendHeartbeatNative({
                    questId: currentQuestBeingHeartbeated.id,
                    streamKey: activeStreamKey,
                    terminal: true
                });
            } else {
                await RestAPI.post({
                    url: `/quests/${currentQuestBeingHeartbeated.id}/heartbeat`,
                    body: { stream_key: activeStreamKey, terminal: true }
                });
            }
        } catch {}
        activeStreamKey = null;
        currentQuestBeingHeartbeated = null;
    }

    currentRunningQuestId = null;
    notifyStateChanged();

    if (settings.store.showToasts) {
        showToast(t("Quests runner stopped"), Toasts.Type.NORMAL);
    }
}

export async function startQuestRunner() {
    if (isRunnerActive) return;

    isRunnerActive = true;
    notifyStateChanged();

    if (settings.store.showToasts) {
        showToast(t("Quests runner started"), Toasts.Type.NORMAL);
    }

    refreshActiveQuests();

    if (settings.store.autoEnroll) {
        const allQuests = getAllQuestsFromStore();
        for (const q of allQuests) {
            if (!isRunnerActive) break;
            if (q && !q.userStatus?.enrolledAt && !q.userStatus?.completedAt) {
                await enrollQuest(q.id);
                await new Promise(r => setTimeout(r, 300));
            }
        }
        refreshActiveQuests();
    }

    const eligibleQuests = activeQuestStates.filter(q => !q.completed);
    if (eligibleQuests.length === 0) {
        isRunnerActive = false;
        notifyStateChanged();
        if (settings.store.showToasts) {
            showToast(t("You don't have any uncompleted active quests!"), Toasts.Type.NORMAL);
        }
        return;
    }

    try {
        for (const state of eligibleQuests) {
            if (!isRunnerActive) break;
            if (state.completed) continue;

            currentRunningQuestId = state.id;
            notifyStateChanged();

            if (!state.quest?.userStatus?.enrolledAt) {
                await enrollQuest(state.id);
                await new Promise(r => setTimeout(r, 400));
            }

            const isVideo = state.taskType.startsWith("WATCH_VIDEO");
            let failCount = 0;

            while (!state.completed && isRunnerActive) {
                let ok = false;
                if (isVideo) {
                    ok = await processVideoStep(state);
                    if (!state.completed && isRunnerActive) {
                        await new Promise(r => setTimeout(r, 1000 + Math.random() * 400));
                    }
                } else {
                    ok = await processHeartbeatStep(state);
                    if (!state.completed && isRunnerActive) {
                        await new Promise(r => setTimeout(r, 16000 + Math.random() * 2000));
                    }
                }

                if (!ok) {
                    failCount++;
                    if (failCount >= 5) {
                        console.warn("[AutoQuests] Quest step failed 5 times, proceeding to next quest:", state.questName);
                        break;
                    }
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    failCount = 0;
                }
            }

            if (state.completed && settings.store.showToasts) {
                showToast(`${t("Quest completed")}: ${state.questName}`, Toasts.Type.SUCCESS);
            }
        }

        const allFinished = activeQuestStates.every(q => q.completed);
        if (allFinished && settings.store.showToasts) {
            showToast(t("All active quests completed!"), Toasts.Type.SUCCESS);
        }
    } finally {
        isRunnerActive = false;
        currentRunningQuestId = null;
        activeStreamKey = null;
        currentQuestBeingHeartbeated = null;
        notifyStateChanged();
    }
}

function useAutoQuests() {
    const [, setTick] = useState(0);

    useEffect(() => {
        const update = () => setTick(t => t + 1);
        stateListeners.add(update);
        refreshActiveQuests();
        return () => {
            stateListeners.delete(update);
        };
    }, []);

    return {
        quests: activeQuestStates,
        isRunning: isRunnerActive,
        currentQuestId: currentRunningQuestId
    };
}

function formatTaskBadge(taskType: SupportedTask): string {
    if (taskType.startsWith("WATCH_VIDEO")) return t("Video Quest");
    if (taskType === "PLAY_ACTIVITY") return t("Activity Quest");
    return t("Desktop Game / Stream Quest");
}

function QuestProgressBar({ progress, target, completed, isCurrent }: { progress: number; target: number; completed: boolean; isCurrent: boolean; }) {
    const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : (completed ? 100 : 0);
    return (
        <div style={{ width: "100%", height: 5, borderRadius: 3, backgroundColor: "rgba(0, 0, 0, 0.4)", overflow: "hidden", marginTop: 7 }}>
            <div
                style={{
                    height: "100%",
                    width: `${pct}%`,
                    backgroundColor: completed
                        ? "var(--status-positive, #23a55a)"
                        : isCurrent
                        ? "var(--brand-500, #5865f2)"
                        : "var(--text-muted, #72767d)",
                    borderRadius: 3,
                    transition: "width 0.3s ease"
                }}
            />
        </div>
    );
}

function QuestListItem({ item, isCurrent }: { item: QuestItemState; isCurrent: boolean; }) {
    const displayProgress = Math.floor(item.currentProgress);
    const displayTarget = Math.floor(item.secondsNeeded);

    return (
        <div
            style={{
                padding: "10px 12px",
                marginBottom: 8,
                borderRadius: 8,
                backgroundColor: item.completed
                    ? "rgba(35, 165, 90, 0.08)"
                    : isCurrent
                    ? "rgba(88, 101, 242, 0.14)"
                    : "var(--background-secondary, #2b2d31)",
                border: item.completed
                    ? "1px solid rgba(35, 165, 90, 0.25)"
                    : isCurrent
                    ? "1px solid var(--brand-500, #5865f2)"
                    : "1px solid rgba(255, 255, 255, 0.05)",
                boxShadow: isCurrent ? "0 2px 10px rgba(0, 0, 0, 0.25)" : "none",
                transition: "all 0.2s ease"
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    {isCurrent && (
                        <div
                            style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                backgroundColor: "var(--brand-500, #5865f2)",
                                boxShadow: "0 0 6px var(--brand-500, #5865f2)",
                                flexShrink: 0
                            }}
                        />
                    )}
                    <Text
                        variant="text-sm/semibold"
                        style={{
                            color: "#ffffff",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis"
                        }}
                        title={item.questName}
                    >
                        {item.questName}
                    </Text>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {item.completed ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <CheckmarkIcon size={13} />
                            <Text variant="text-xs/bold" style={{ color: "var(--status-positive, #23a55a)", textTransform: "uppercase" }}>
                                {t("Completed")}
                            </Text>
                        </div>
                    ) : (
                        <Text variant="text-xs/medium" style={{ color: "var(--text-muted, #949ba4)", fontFamily: "monospace" }}>
                            {displayProgress} / {displayTarget}s
                        </Text>
                    )}
                </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--text-muted, #949ba4)",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                    }}
                >
                    {formatTaskBadge(item.taskType)}
                </span>
                {!item.completed && displayTarget > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: isCurrent ? "var(--brand-500, #5865f2)" : "var(--text-muted, #949ba4)" }}>
                        {Math.min(100, Math.round((displayProgress / displayTarget) * 100))}%
                    </span>
                )}
            </div>

            <QuestProgressBar progress={displayProgress} target={displayTarget} completed={item.completed} isCurrent={isCurrent} />
        </div>
    );
}

function FloatingQuestWidget() {
    const { quests, isRunning, currentQuestId } = useAutoQuests();
    const [expanded, setExpanded] = useState(false);
    const [currentPath, setCurrentPath] = useState(window.location.pathname);

    useEffect(() => {
        const updatePath = () => setCurrentPath(window.location.pathname);
        window.addEventListener("popstate", updatePath);

        const observer = new MutationObserver(() => {
            if (window.location.pathname !== currentPath) {
                updatePath();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            window.removeEventListener("popstate", updatePath);
            observer.disconnect();
        };
    }, [currentPath]);

    const isQuestPage = currentPath.includes("/quest-home") || currentPath.includes("/discovery");
    const shouldShow = settings.store.showEverywhere || isQuestPage;

    if (!shouldShow) return null;

    const uncompletedCount = quests.filter(q => !q.completed).length;

    return (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 10000, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            {expanded && (
                <div
                    style={{
                        width: 340,
                        maxHeight: 460,
                        backgroundColor: "var(--background-floating, #18191c)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 12,
                        padding: 16,
                        boxShadow: "0 16px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05)",
                        marginBottom: 12,
                        display: "flex",
                        flexDirection: "column"
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#ffffff" }}>
                            <QuestCompassIcon size={18} />
                            <Text variant="heading-sm/bold" style={{ color: "#ffffff", fontWeight: 700, margin: 0 }}>
                                {t("Auto Quests")}
                            </Text>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "3px 10px",
                                borderRadius: 12,
                                backgroundColor: isRunning ? "rgba(88, 101, 242, 0.2)" : "rgba(255, 255, 255, 0.06)",
                                color: isRunning ? "var(--brand-500, #5865f2)" : "var(--text-muted, #949ba4)",
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase"
                            }}
                        >
                            {isRunning && (
                                <div
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: "50%",
                                        backgroundColor: "var(--brand-500, #5865f2)",
                                        boxShadow: "0 0 6px var(--brand-500, #5865f2)"
                                    }}
                                />
                            )}
                            {isRunning ? t("Running") : t("Idle")}
                        </div>
                    </div>

                    <div className="nightcord-autoquests-scroller" style={{ overflowY: "auto", maxHeight: 280, paddingRight: 6, marginBottom: 14 }}>
                        {quests.length === 0 ? (
                            <div style={{ padding: "28px 12px", textAlign: "center" }}>
                                <Text variant="text-sm/normal" style={{ color: "var(--text-muted, #949ba4)" }}>
                                    {t("No active quests found")}
                                </Text>
                            </div>
                        ) : (
                            quests.map(q => (
                                <QuestListItem key={q.id} item={q} isCurrent={q.id === currentQuestId} />
                            ))
                        )}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                        <Button
                            color={isRunning ? Button.Colors.RED : Button.Colors.BRAND}
                            size={Button.Sizes.SMALL}
                            onClick={isRunning ? stopQuestRunner : startQuestRunner}
                            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontWeight: 600 }}
                        >
                            {isRunning ? <StopSquareIcon size={14} /> : <PlayIcon size={14} />}
                            {isRunning ? t("Stop Quests") : (uncompletedCount > 0 ? `${t("Run Quests")} (${uncompletedCount})` : t("Run Quests"))}
                        </Button>
                        <Button
                            color={Button.Colors.PRIMARY}
                            size={Button.Sizes.SMALL}
                            onClick={() => {
                                refreshActiveQuests();
                                openAutoQuestsModal();
                            }}
                            style={{ padding: "0 10px", display: "flex", alignItems: "center", justifyContent: "center" }}
                            title={t("Auto Quests Manager")}
                        >
                            <ExternalIcon size={14} />
                        </Button>
                    </div>
                </div>
            )}

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    backgroundColor: isRunning ? "var(--brand-500, #5865f2)" : "var(--background-secondary, #2b2d31)",
                    border: isRunning ? "1px solid var(--brand-500, #5865f2)" : "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: 10,
                    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
                    overflow: "hidden",
                    transition: "all 0.25s ease"
                }}
            >
                <button
                    onClick={isRunning ? stopQuestRunner : startQuestRunner}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "9px 15px",
                        background: "transparent",
                        border: "none",
                        color: "#ffffff",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: 13
                    }}
                >
                    <QuestCompassIcon size={16} />
                    <span>
                        {isRunning
                            ? `${t("Running Quests")}...`
                            : (uncompletedCount > 0 ? `${t("Run Quests")} (${uncompletedCount})` : t("Run Quests"))}
                    </span>
                </button>
                <div style={{ width: 1, height: 22, backgroundColor: "rgba(255, 255, 255, 0.15)" }} />
                <button
                    onClick={() => setExpanded(e => !e)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "9px 12px",
                        background: "transparent",
                        border: "none",
                        color: "#ffffff",
                        cursor: "pointer"
                    }}
                    title={t("Auto Quests")}
                >
                    <ChevronIcon size={12} expanded={expanded} />
                </button>
            </div>
        </div>
    );
}

function AutoQuestsModal({ modalProps }: { modalProps: ModalProps; }) {
    const { quests, isRunning, currentQuestId } = useAutoQuests();
    const uncompletedCount = quests.filter(q => !q.completed).length;

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false} style={{ padding: "20px 24px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#ffffff" }}>
                    <QuestCompassIcon size={22} />
                    <Text variant="heading-lg/bold" style={{ color: "#ffffff", fontWeight: 700, margin: 0 }}>
                        {t("Auto Quests Manager")}
                    </Text>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent style={{ padding: "0 24px 20px" }}>
                <Text variant="text-sm/normal" style={{ color: "var(--text-muted, #949ba4)", marginBottom: 16 }}>
                    {t("Automate completion of Discord video, game, and streaming quests.")}
                </Text>

                <div className="nightcord-autoquests-scroller" style={{ maxHeight: 380, overflowY: "auto", paddingRight: 6 }}>
                    {quests.length === 0 ? (
                        <div style={{ padding: "36px 16px", textAlign: "center", backgroundColor: "var(--background-secondary, #2b2d31)", borderRadius: 8 }}>
                            <Text variant="text-md/normal" style={{ color: "var(--text-muted, #949ba4)" }}>
                                {t("No active quests found")}
                            </Text>
                        </div>
                    ) : (
                        quests.map(q => (
                            <QuestListItem key={q.id} item={q} isCurrent={q.id === currentQuestId} />
                        ))
                    )}
                </div>
            </ModalContent>

            <ModalFooter style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Button
                    color={Button.Colors.PRIMARY}
                    look={Button.Looks.LINK}
                    size={Button.Sizes.SMALL}
                    onClick={() => {
                        window.location.href = "https://discord.com/quest-home";
                    }}
                >
                    {t("Open Quests Page")}
                </Button>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <Button
                        color={Button.Colors.PRIMARY}
                        look={Button.Looks.LINK}
                        size={Button.Sizes.SMALL}
                        onClick={modalProps.onClose}
                    >
                        {t("Cancel")}
                    </Button>
                    <Button
                        color={isRunning ? Button.Colors.RED : Button.Colors.BRAND}
                        size={Button.Sizes.SMALL}
                        onClick={isRunning ? stopQuestRunner : startQuestRunner}
                        style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}
                    >
                        {isRunning ? <StopSquareIcon size={14} /> : <PlayIcon size={14} />}
                        {isRunning ? t("Stop Quests") : (uncompletedCount > 0 ? `${t("Run Quests")} (${uncompletedCount})` : t("Run Quests"))}
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openAutoQuestsModal() {
    openModal(modalProps => (
        <AutoQuestsModal modalProps={modalProps} />
    ));
}

function AutoQuestsSettingsPanel() {
    const { quests, isRunning, currentQuestId } = useAutoQuests();
    const [autoStartVal, setAutoStartVal] = useState(settings.store.autoStart);
    const [autoEnrollVal, setAutoEnrollVal] = useState(settings.store.autoEnroll);
    const [showEverywhereVal, setShowEverywhereVal] = useState(settings.store.showEverywhere);
    const [showToastsVal, setShowToastsVal] = useState(settings.store.showToasts);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", backgroundColor: "var(--background-secondary, #2b2d31)", borderRadius: 8 }}>
                <div>
                    <Text variant="heading-sm/bold" style={{ color: "#ffffff" }}>
                        {t("Auto Quests")}
                    </Text>
                    <Text variant="text-xs/normal" style={{ color: "var(--text-muted, #949ba4)", marginTop: 2 }}>
                        {quests.length} {t("Auto Quests")} ({quests.filter(q => q.completed).length} {t("Completed")})
                    </Text>
                </div>
                <Button
                    color={isRunning ? Button.Colors.RED : Button.Colors.BRAND}
                    size={Button.Sizes.SMALL}
                    onClick={isRunning ? stopQuestRunner : startQuestRunner}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                    {isRunning ? <StopSquareIcon size={14} /> : <PlayIcon size={14} />}
                    {isRunning ? t("Stop Quests") : t("Run Quests")}
                </Button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <FormSwitch
                    value={autoStartVal}
                    onChange={(val: boolean) => {
                        setAutoStartVal(val);
                        settings.store.autoStart = val;
                    }}
                    note={t("Automatically run active quests in the background when Discord opens")}
                >
                    {t("Auto Start")}
                </FormSwitch>

                <FormSwitch
                    value={autoEnrollVal}
                    onChange={(val: boolean) => {
                        setAutoEnrollVal(val);
                        settings.store.autoEnroll = val;
                    }}
                    note={t("Automatically accept and enroll in available quests")}
                >
                    {t("Auto Enroll")}
                </FormSwitch>

                <FormSwitch
                    value={showEverywhereVal}
                    onChange={(val: boolean) => {
                        setShowEverywhereVal(val);
                        settings.store.showEverywhere = val;
                    }}
                    note={t("Show the floating quest button on all Discord screens")}
                >
                    {t("Show Everywhere")}
                </FormSwitch>

                <FormSwitch
                    value={showToastsVal}
                    onChange={(val: boolean) => {
                        setShowToastsVal(val);
                        settings.store.showToasts = val;
                    }}
                    note={t("Show notifications on quest progress and completion")}
                >
                    {t("Show Notifications")}
                </FormSwitch>
            </div>

            {quests.length > 0 && (
                <div style={{ marginTop: 8 }}>
                    <Text variant="text-sm/bold" style={{ color: "#ffffff", marginBottom: 10 }}>
                        {t("Auto Quests")} ({quests.length})
                    </Text>
                    <div className="nightcord-autoquests-scroller" style={{ maxHeight: 280, overflowY: "auto", paddingRight: 6 }}>
                        {quests.map(q => (
                            <QuestListItem key={q.id} item={q} isCurrent={q.id === currentQuestId} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

let widgetRootNode: HTMLDivElement | null = null;
let widgetRoot: ReturnType<typeof createRoot> | null = null;
let styleElement: HTMLStyleElement | null = null;

const SCROLLER_CSS = `
.nightcord-autoquests-scroller::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}
.nightcord-autoquests-scroller::-webkit-scrollbar-track {
    background: transparent;
}
.nightcord-autoquests-scroller::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.18);
    border-radius: 3px;
}
.nightcord-autoquests-scroller::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.32);
}
.nightcord-autoquests-scroller {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}
`;

function injectStyles() {
    if (document.getElementById("nightcord-autoquests-styles")) return;
    styleElement = document.createElement("style");
    styleElement.id = "nightcord-autoquests-styles";
    styleElement.textContent = SCROLLER_CSS;
    document.head.appendChild(styleElement);
}

function removeStyles() {
    const el = document.getElementById("nightcord-autoquests-styles");
    if (el) el.remove();
    styleElement = null;
}

function mountFloatingWidget() {
    if (widgetRootNode) return;
    injectStyles();
    widgetRootNode = document.createElement("div");
    widgetRootNode.id = "nightcord-autoquests-floating-container";
    document.body.appendChild(widgetRootNode);
    widgetRoot = createRoot(widgetRootNode);
    widgetRoot.render(<FloatingQuestWidget />);
}

function unmountFloatingWidget() {
    if (widgetRoot) {
        widgetRoot.unmount();
        widgetRoot = null;
    }
    if (widgetRootNode) {
        widgetRootNode.remove();
        widgetRootNode = null;
    }
    removeStyles();
}

export default definePlugin({
    name: "AutoQuests",
    description: "Automate completion of Discord video, game, and streaming quests.",
    authors: [{ name: "Nightcord", id: 0n }],
    settings,
    settingsPanel: AutoQuestsSettingsPanel,

    start() {
        mountFloatingWidget();

        setTimeout(() => {
            refreshActiveQuests();
            if (settings.store.autoStart) {
                void startQuestRunner();
            }
        }, 3000);
    },

    stop() {
        void stopQuestRunner();
        unmountFloatingWidget();
    }
});
