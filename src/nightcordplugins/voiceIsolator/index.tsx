/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Avatar, Button, createRoot, Menu, React, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { voiceIsolatorEngine } from "./engine";
import { VoiceIsolatorFloatingHud } from "./indicator";
import { VoiceIsolatorState } from "./types";
import { t } from "../autoTranslateNightcord";

const settings = definePluginSettings({
    attenuationVolume: {
        description: "Background volume level percentage for other users when isolation is active.",
        type: OptionType.SLIDER,
        markers: [0, 5, 10, 20, 30, 50],
        default: 5,
        restartNeeded: false
    },
    boostTarget: {
        description: "Boost the isolated user's volume above 100% for maximum voice clarity.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    },
    targetVolume: {
        description: "Target user volume level percentage when boosted.",
        type: OptionType.SLIDER,
        markers: [100, 125, 150, 175, 200],
        default: 150,
        restartNeeded: false
    },
    showFloatingHud: {
        description: "Show a floating on-screen indicator when voice isolation is active.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    }
});

let hudContainer: HTMLDivElement | null = null;
let hudRoot: ReturnType<typeof createRoot> | null = null;

function mountHud() {
    if (hudContainer || typeof document === "undefined") return;
    hudContainer = document.createElement("div");
    hudContainer.id = "nc-voice-isolator-hud-root";
    document.body.appendChild(hudContainer);
    if (createRoot) {
        hudRoot = createRoot(hudContainer);
        hudRoot.render(<VoiceIsolatorFloatingHud />);
    }
}

function unmountHud() {
    if (hudRoot) {
        try { hudRoot.unmount(); } catch { }
        hudRoot = null;
    }
    if (hudContainer) {
        hudContainer.remove();
        hudContainer = null;
    }
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user || user.bot) return;

    const myId = UserStore.getCurrentUser()?.id;
    if (user.id === myId) return;

    const activeVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
    if (!activeVoiceChannelId) return;

    // Check if target user is in the active voice channel
    const targetState = VoiceStateStore.getVoiceStateForUser(user.id)
        ?? (VoiceStateStore.getVoiceStatesForChannel(activeVoiceChannelId) || {})[user.id];

    if (!targetState || targetState.channelId !== activeVoiceChannelId) return;

    const state = voiceIsolatorEngine.getState();
    const isCurrentlyIsolated = state.isolatedUserId === user.id;

    const menuItem = (
        <Menu.MenuItem
            id="voice-isolator-toggle"
            label={isCurrentlyIsolated ? t("Stop Voice Isolation") : t("Isolate Voice")}
            color={isCurrentlyIsolated ? "danger" : "default"}
            action={() => {
                voiceIsolatorEngine.toggleIsolate(user.id, {
                    attenuationVolume: settings.store.attenuationVolume,
                    boostTarget: settings.store.boostTarget,
                    targetVolume: settings.store.targetVolume
                });
            }}
        />
    );

    const targetGroup = findGroupChildrenByChildId("user-volume", children)
        ?? findGroupChildrenByChildId("mute", children)
        ?? findGroupChildrenByChildId("server-mute", children)
        ?? findGroupChildrenByChildId("user-profile-actions", children)
        ?? findGroupChildrenByChildId("roles", children);

    if (targetGroup && Array.isArray(targetGroup)) {
        targetGroup.push(menuItem);
    } else {
        children.push(<Menu.MenuGroup>{menuItem}</Menu.MenuGroup>);
    }
};

function VoiceIsolatorSettingsComponent() {
    const [state, setState] = React.useState<VoiceIsolatorState>(() => voiceIsolatorEngine.getState());

    React.useEffect(() => {
        const unsub = voiceIsolatorEngine.subscribe(setState);
        return () => unsub();
    }, []);

    return (
        <div style={{ width: "100%", marginTop: "10px" }}>
            <Card
                variant="primary"
                outline
                style={{
                    padding: "16px",
                    background: state.isolatedUserId ? "rgba(88, 101, 242, 0.15)" : "var(--background-secondary, #2b2d31)",
                    borderRadius: "8px",
                    border: state.isolatedUserId ? "1px solid var(--brand-500, #5865f2)" : undefined,
                    marginBottom: "16px"
                }}
            >
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <Flex alignItems={FlexAlign.CENTER} gap="12px">
                        {state.isolatedUserAvatar && (
                            <Avatar src={state.isolatedUserAvatar} size="SIZE_32" />
                        )}
                        <div>
                            <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "14px", display: "block" }}>
                                {t("Voice Isolation Status")}
                            </span>
                            <span style={{ color: state.isolatedUserId ? "var(--brand-500, #5865f2)" : "var(--text-muted, #949ba4)", fontSize: "12px", fontWeight: state.isolatedUserId ? 600 : 400 }}>
                                {state.isolatedUserId
                                    ? `● ${t("Active:")} ${state.isolatedUserName} (${t("Others lowered to")} ${settings.store.attenuationVolume}%)`
                                    : `○ ${t("Inactive / Normal voice mixing")}`}
                            </span>
                        </div>
                    </Flex>
                    {state.isolatedUserId && (
                        <Button
                            variant="dangerPrimary"
                            onClick={() => voiceIsolatorEngine.restoreAll()}
                        >
                            {t("Restore All Volumes")}
                        </Button>
                    )}
                </Flex>
            </Card>
        </div>
    );
}

export default definePlugin({
    name: "VoiceIsolator",
    description: "Allows you to select a single person in a noisy voice channel to automatically lower everyone else's volume and hear their voice clearly.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: VoiceIsolatorSettingsComponent,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            if (Array.isArray(voiceStates)) {
                for (const st of voiceStates) {
                    voiceIsolatorEngine.handleVoiceStateUpdate(st, {
                        attenuationVolume: settings.store.attenuationVolume
                    });
                }
            }
        },
        VOICE_STATE_UPDATE(st: any) {
            voiceIsolatorEngine.handleVoiceStateUpdate(st, {
                attenuationVolume: settings.store.attenuationVolume
            });
        },
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            voiceIsolatorEngine.handleChannelChange(channelId);
        }
    },

    start() {
        if (settings.store.showFloatingHud !== false) {
            mountHud();
        }
    },

    stop() {
        voiceIsolatorEngine.restoreAll();
        unmountHud();
    }
});
