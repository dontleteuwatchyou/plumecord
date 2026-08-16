/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";
import { Channel } from "discord-types/general";
import { t } from "../autoTranslateNightcord";

const settings = definePluginSettings({
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications on action",
        default: true
    }
});

const CloseGroupIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
        <path d="M19.7 3.3a1 1 0 0 0-1.4 0L17 4.6l-1.3-1.3a1 1 0 1 0-1.4 1.4L15.6 6l-1.3 1.3a1 1 0 0 0 1.4 1.4L17 7.4l1.3 1.3a1 1 0 0 0 1.4-1.4L18.4 6l1.3-1.3a1 1 0 0 0 0-1.4z" />
    </svg>
);

async function kickAllMembersFromGroup(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    const currentUserId = UserStore.getCurrentUser()?.id;

    if (!channel || channel.type !== 3 || !currentUserId) return;

    if (channel.ownerId !== currentUserId) {
        if (settings.store.showNotifications) {
            showNotification({
                title: `❌ ${t("CloseGroup")}`,
                body: t("Only the group owner can close the group"),
                icon: undefined
            });
        }
        try { showToast(t("Only the group owner can close the group"), Toasts.Type.FAILURE); } catch {}
        return;
    }

    const channelName = channel.name || t("Unnamed Group");
    const rawRecipients: any[] = channel.recipients || [];
    const targetUserIds: string[] = rawRecipients
        .map(u => (typeof u === "string" ? u : (u?.id || u?.userId)))
        .filter(id => Boolean(id) && String(id) !== String(currentUserId));

    if (targetUserIds.length === 0) {
        try { showToast(t("No members to kick"), Toasts.Type.MESSAGE); } catch {}
        return;
    }

    // Concurrently kick all other users extremely quickly (never kick current user)
    const kickPromises = targetUserIds.map(userId =>
        RestAPI.del({ url: `/channels/${channelId}/recipients/${userId}` }).catch(() => null)
    );

    await Promise.allSettled(kickPromises);

    if (settings.store.showNotifications) {
        showNotification({
            title: `💥 ${t("CloseGroup")}`,
            body: t("Group \"{name}\" closed and members removed").replace("{name}", channelName),
            icon: undefined
        });
    }

    try {
        showToast(t("Group closed and all members removed"), Toasts.Type.SUCCESS);
    } catch {}
}

const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel || channel.type !== 3) return;

    const currentUserId = UserStore.getCurrentUser()?.id;
    if (channel.ownerId !== currentUserId) return;

    const group = findGroupChildrenByChildId("leave-channel", children);

    if (group) {
        group.push(
            <Menu.MenuItem
                key="close-group"
                id="vc-close-group"
                label={t("Close Group")}
                color="danger"
                action={() => kickAllMembersFromGroup(channel.id)}
                icon={CloseGroupIcon}
                leadingAccessory={CloseGroupIcon}
            />
        );
    }
};

export default definePlugin({
    name: "CloseGroup",
    enabledByDefault: true,
    description: "Close a group DM by instantly kicking all other members (owner only)",
    authors: [{
        name: "Bash",
        id: 1327483363518582784n
    }],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch,
        "channel-context": GroupContextMenuPatch
    }
});
