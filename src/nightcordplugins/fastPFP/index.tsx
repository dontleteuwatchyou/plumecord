/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { copyMediaImage, resolveDiscordMedia, saveMediaFile } from "@plugins/fileUpload/utils/getMediaUrl";
import definePlugin from "@utils/types";
import { Menu, RestAPI, Toasts } from "@webpack/common";
import { t } from "../autoTranslateNightcord";

const openLink = (url: string) => {
    window.open(url, "_blank");
};

const uploadImageToProfile = async (url: string, type: "avatar" | "banner") => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();

        // Convert Blob to Base64
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64data = reader.result;
            try {
                await RestAPI.patch({
                    url: "/users/@me",
                    body: {
                        [type]: base64data
                    }
                });
                Toasts.show(Toasts.create(t(`Successfully updated your ${type}!`), Toasts.Type.SUCCESS));
            } catch (error) {
                Toasts.show(Toasts.create(t(`Failed to update ${type}.`), Toasts.Type.FAILURE));
                console.error("FastPFP Error:", error);
            }
        };
    } catch (err) {
        Toasts.show(Toasts.create(t("Failed to download image."), Toasts.Type.FAILURE));
        console.error("FastPFP Error:", err);
    }
};

function hasMenuItemById(children: any[], ids: string[]): boolean {
    if (!Array.isArray(children)) return false;
    for (const child of children) {
        if (!child) continue;
        const id = child.props?.id ?? child.key;
        if (typeof id === "string" && ids.includes(id)) return true;
        if (Array.isArray(child.props?.children) && hasMenuItemById(child.props.children, ids)) {
            return true;
        }
    }
    return false;
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props) return;

    const media = resolveDiscordMedia(props);
    if (!media?.url) return;

    const { url, isVideo, filename } = media;

    const group = findGroupChildrenByChildId("open-native-link", children)
        ?? findGroupChildrenByChildId("copy-native-link", children)
        ?? findGroupChildrenByChildId("copy-link", children)
        ?? findGroupChildrenByChildId("save-image", children);

    if (hasMenuItemById(children, ["fastpfp-avatar", "fastpfp-save-image-msg"])) return;

    const hasSaveAlready = hasMenuItemById(children, ["save-image", "viewicons-save-media", "fastpfp-save-image"]);
    const hasCopyAlready = hasMenuItemById(children, ["copy-image", "viewicons-copy-image", "fastpfp-copy-image"]);
    const hasOpenAlready = hasMenuItemById(children, ["open-native-link", "fastpfp-open-link"]);

    const items: React.ReactElement[] = [];

    if (!isVideo) {
        items.push(
            <Menu.MenuItem
                label={t("Add To PFP")}
                key="fastpfp-avatar"
                id="fastpfp-avatar"
                action={() => void uploadImageToProfile(url, "avatar")}
            />,
            <Menu.MenuItem
                label={t("Add To Banner")}
                key="fastpfp-banner"
                id="fastpfp-banner"
                action={() => void uploadImageToProfile(url, "banner")}
            />
        );
    }

    if (!hasSaveAlready || (!isVideo && !hasCopyAlready) || !hasOpenAlready) {
        if (items.length > 0) {
            items.push(<Menu.MenuSeparator key="fastpfp-sep-msg" />);
        }
        if (!isVideo && !hasCopyAlready) {
            items.push(
                <Menu.MenuItem
                    label={t("Copy Image")}
                    key="fastpfp-copy-image-msg"
                    id="fastpfp-copy-image-msg"
                    action={() => void copyMediaImage(url)}
                />
            );
        }
        if (!hasSaveAlready) {
            items.push(
                <Menu.MenuItem
                    label={t(isVideo ? "Save Video" : "Save Image")}
                    key="fastpfp-save-image-msg"
                    id="fastpfp-save-image-msg"
                    action={() => void saveMediaFile(url, filename, isVideo)}
                />
            );
        }
        if (!hasOpenAlready) {
            items.push(
                <Menu.MenuItem
                    label={t("Open Link")}
                    key="fastpfp-open-link-msg"
                    id="fastpfp-open-link-msg"
                    action={() => openLink(url)}
                />
            );
        }
    }

    if (items.length === 0) return;

    if (group) {
        group.push(...items);
    } else {
        children.push(
            <Menu.MenuGroup key="fastpfp-msg-group" id="fastpfp-msg-group">
                {items}
            </Menu.MenuGroup>
        );
    }
};

const imageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props) return;
    if ("href" in props && !props.src) return;

    const media = resolveDiscordMedia(props);
    if (!media?.url) return;

    const { url, isVideo, filename } = media;

    if (children.some(child => child?.props?.id === "fastpfp-group")) return;

    const hasSaveAlready = hasMenuItemById(children, ["save-image", "viewicons-save-media", "fastpfp-save-image-msg"]);
    const hasCopyAlready = hasMenuItemById(children, ["copy-image", "viewicons-copy-image", "fastpfp-copy-image-msg"]);
    const hasOpenAlready = hasMenuItemById(children, ["open-native-link", "fastpfp-open-link-msg"]);

    const items: React.ReactElement[] = [];

    if (!isVideo) {
        items.push(
            <Menu.MenuItem
                label={t("Add To PFP")}
                key="fastpfp-avatar"
                id="fastpfp-avatar"
                action={() => void uploadImageToProfile(url, "avatar")}
            />,
            <Menu.MenuItem
                label={t("Add To Banner")}
                key="fastpfp-banner"
                id="fastpfp-banner"
                action={() => void uploadImageToProfile(url, "banner")}
            />
        );
    }

    if (!hasSaveAlready || (!isVideo && !hasCopyAlready) || !hasOpenAlready) {
        if (items.length > 0) {
            items.push(<Menu.MenuSeparator key="fastpfp-sep" />);
        }
        if (!isVideo && !hasCopyAlready) {
            items.push(
                <Menu.MenuItem
                    label={t("Copy Image")}
                    key="fastpfp-copy-image"
                    id="fastpfp-copy-image"
                    action={() => void copyMediaImage(url)}
                />
            );
        }
        if (!hasSaveAlready) {
            items.push(
                <Menu.MenuItem
                    label={t(isVideo ? "Save Video" : "Save Image")}
                    key="fastpfp-save-image"
                    id="fastpfp-save-image"
                    action={() => void saveMediaFile(url, filename, isVideo)}
                />
            );
        }
        if (!hasOpenAlready) {
            items.push(
                <Menu.MenuItem
                    label={t("Open Link")}
                    key="fastpfp-open-link"
                    id="fastpfp-open-link"
                    action={() => openLink(url)}
                />
            );
        }
    }

    if (items.length === 0) return;

    children.push(
        <Menu.MenuGroup key="fastpfp-group" id="fastpfp-group">
            {items}
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "FastPFP",
    enabledByDefault: true,
    description: "Allows you to quickly set any image as your profile picture or banner from the context menu.",
    authors: [{ name: "Nightcord", id: 0n }],
    contextMenus: {
        "message": messageContextMenuPatch,
        "image-context": imageContextMenuPatch
    }
});

