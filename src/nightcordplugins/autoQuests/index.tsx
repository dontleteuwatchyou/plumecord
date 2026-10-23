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
import { find, findStore } from "@webpack";
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

function QuestCompassIcon({ size = 18 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" fillOpacity="0.2" />
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

async function enrollInQuest(questId: string) {
    try {
        await RestAPI.post({
            url: `/quests/${questId}/enroll`,
            body: { location: 1 }
        });
    } catch {
        try {
            await RestAPI.post({
                url: `/quests/${questId}/enroll`,
                body: {}
            });
        } catch {}
    }
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

async function processVideoStep(state: QuestItemState) {
    const { quest, secondsNeeded } = state;
    const speed = 1;
    const nextTime = Math.min(secondsNeeded, state.currentProgress + speed + Math.random());

    try {
        const res = await RestAPI.post({
            url: `/quests/${quest.id}/video-progress`,
            body: { timestamp: nextTime }
        });
        state.currentProgress = nextTime;
        notifyStateChanged();

        if (res.body?.completed_at !== null && res.body?.completed_at !== undefined || state.currentProgress >= secondsNeeded) {
            state.completed = true;
            notifyStateChanged();
            await RestAPI.post({
                url: `/quests/${quest.id}/video-progress`,
                body: { timestamp: secondsNeeded }
            });
        }
    } catch (err) {
        console.error("[Nightcord AutoQuests] Video progress error:", err);
    }
}

async function processHeartbeatStep(state: QuestItemState) {
    const { quest, taskType, secondsNeeded } = state;

    const channelId = getVoiceOrDMChannelId();
    const streamKey = channelId ? `call:${channelId}:1` : `call:${quest.id}:1`;
    activeStreamKey = streamKey;
    currentQuestBeingHeartbeated = quest;

    try {
        const response = await RestAPI.post({
            url: `/quests/${quest.id}/heartbeat`,
            body: { stream_key: streamKey, terminal: false }
        });

        const serverProgress = response.body?.progress?.[taskType]?.value ?? (state.currentProgress + 20);
        state.currentProgress = serverProgress;
        notifyStateChanged();

        if (state.currentProgress >= secondsNeeded) {
            await RestAPI.post({
                url: `/quests/${quest.id}/heartbeat`,
                body: { stream_key: streamKey, terminal: true }
            });
            state.completed = true;
            activeStreamKey = null;
            currentQuestBeingHeartbeated = null;
            notifyStateChanged();
        }
    } catch (err) {
        console.error("[Nightcord AutoQuests] Heartbeat error:", err);
    }
}

export async function stopQuestRunner() {
    if (!isRunnerActive) return;
    isRunnerActive = false;

    if (activeStreamKey && currentQuestBeingHeartbeated) {
        try {
            await RestAPI.post({
                url: `/quests/${currentQuestBeingHeartbeated.id}/heartbeat`,
                body: { stream_key: activeStreamKey, terminal: true }
            });
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

    refreshActiveQuests();

    if (settings.store.autoEnroll) {
        const allQuests = getAllQuestsFromStore();
        for (const q of allQuests) {
            if (q && !q.userStatus?.enrolledAt && !q.userStatus?.completedAt) {
                await enrollInQuest(q.id);
                await new Promise(r => setTimeout(r, 400));
            }
        }
        refreshActiveQuests();
    }

    const eligibleQuests = activeQuestStates.filter(q => !q.completed);
    if (eligibleQuests.length === 0) {
        if (settings.store.showToasts) {
            showToast(t("You don't have any uncompleted active quests!"), Toasts.Type.NORMAL);
        }
        return;
    }

    isRunnerActive = true;
    notifyStateChanged();

    if (settings.store.showToasts) {
        showToast(t("Quests runner started"), Toasts.Type.NORMAL);
    }

    try {
        for (const state of eligibleQuests) {
            if (!isRunnerActive) break;
            if (state.completed) continue;

            currentRunningQuestId = state.id;
            notifyStateChanged();

            if (!state.quest.userStatus?.enrolledAt && settings.store.autoEnroll) {
                await enrollInQuest(state.id);
                await new Promise(r => setTimeout(r, 500));
            }

            const isVideo = state.taskType.startsWith("WATCH_VIDEO");

            while (!state.completed && isRunnerActive) {
                if (isVideo) {
                    await processVideoStep(state);
                    if (!state.completed && isRunnerActive) {
                        await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
                    }
                } else {
                    await processHeartbeatStep(state);
                    if (!state.completed && isRunnerActive) {
                        await new Promise(r => setTimeout(r, 20000 + Math.random() * 2000));
                    }
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

function QuestProgressBar({ progress, target, completed }: { progress: number; target: number; completed: boolean; }) {
    const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : (completed ? 100 : 0);
    return (
        <div style={{ width: "100%", height: 6, borderRadius: 3, backgroundColor: "var(--background-secondary, #2b2d31)", overflow: "hidden", marginTop: 6 }}>
            <div
                style={{
                    height: "100%",
                    width: `${pct}%`,
                    backgroundColor: completed ? "var(--status-positive, #23a55a)" : "var(--brand-500, #5865f2)",
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
                backgroundColor: isCurrent ? "rgba(88, 101, 242, 0.12)" : "var(--background-secondary, #2b2d31)",
                border: isCurrent ? "1px solid var(--brand-500, #5865f2)" : "1px solid transparent",
                transition: "all 0.2s ease"
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <Text
                    variant="text-sm/semibold"
                    style={{
                        color: "#ffffff",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 190
                    }}
                    title={item.questName}
                >
                    {item.questName}
                </Text>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                    <span style={{ fontSize: 10, color: "var(--text-muted, #949ba4)" }}>
                        {Math.min(100, Math.round((displayProgress / displayTarget) * 100))}%
                    </span>
                )}
            </div>

            <QuestProgressBar progress={displayProgress} target={displayTarget} completed={item.completed} />
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
        <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 10000, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            {expanded && (
                <div
                    style={{
                        width: 320,
                        maxHeight: 440,
                        backgroundColor: "var(--background-floating, #18191c)",
                        border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                        borderRadius: 12,
                        padding: 16,
                        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
                        marginBottom: 12,
                        display: "flex",
                        flexDirection: "column"
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#ffffff" }}>
                            <QuestCompassIcon size={18} />
                            <Text variant="heading-sm/bold" style={{ color: "#ffffff", margin: 0 }}>
                                {t("Auto Quests")}
                            </Text>
                        </div>
                        <div
                            style={{
                                padding: "2px 8px",
                                borderRadius: 10,
                                backgroundColor: isRunning ? "rgba(88, 101, 242, 0.2)" : "rgba(148, 155, 164, 0.15)",
                                color: isRunning ? "var(--brand-500, #5865f2)" : "var(--text-muted, #949ba4)",
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase"
                            }}
                        >
                            {isRunning ? t("Running") : t("Idle")}
                        </div>
                    </div>

                    <div style={{ overflowY: "auto", maxHeight: 260, paddingRight: 4, marginBottom: 12 }}>
                        {quests.length === 0 ? (
                            <div style={{ padding: "24px 8px", textAlign: "center" }}>
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
                            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                        >
                            {isRunning ? <StopSquareIcon size={14} /> : <PlayIcon size={14} />}
                            {isRunning ? t("Stop Quests") : t("Run Quests")}
                        </Button>
                        <Button
                            color={Button.Colors.PRIMARY}
                            look={Button.Looks.LINK}
                            size={Button.Sizes.SMALL}
                            onClick={() => {
                                refreshActiveQuests();
                                openAutoQuestsModal();
                            }}
                            style={{ padding: "0 10px" }}
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
                    backgroundColor: "var(--background-secondary, #2b2d31)",
                    border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                    borderRadius: 10,
                    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
                    overflow: "hidden",
                    transition: "all 0.2s ease"
                }}
            >
                <button
                    onClick={isRunning ? stopQuestRunner : startQuestRunner}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 14px",
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
                        {isRunning ? `${t("Running Quests")}...` : (uncompletedCount > 0 ? `${t("Run Quests")} (${uncompletedCount})` : t("Run Quests"))}
                    </span>
                </button>
                <div style={{ width: 1, height: 20, backgroundColor: "var(--background-modifier-accent, rgba(255, 255, 255, 0.1))" }} />
                <button
                    onClick={() => setExpanded(e => !e)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "8px 10px",
                        background: "transparent",
                        border: "none",
                        color: "var(--text-muted, #949ba4)",
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

                <div style={{ maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
                    {quests.length === 0 ? (
                        <div style={{ padding: "32px 16px", textAlign: "center", backgroundColor: "var(--background-secondary, #2b2d31)", borderRadius: 8 }}>
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

                <div style={{ display: "flex", gap: 10 }}>
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
                        style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                        {isRunning ? <StopSquareIcon size={14} /> : <PlayIcon size={14} />}
                        {isRunning ? t("Stop Quests") : t("Run Quests")}
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
                    <div style={{ maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
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

function mountFloatingWidget() {
    if (widgetRootNode) return;
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
