/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Menu } from "@webpack/common";

import { QuickMessagesChatBarButton } from "./components/ChatBarButton";
import { QuickMessagesIcon } from "./components/Icons";
import { QuickMessagesModal } from "./components/QuickMessagesModal";
import { loadQuickMessages } from "./store";
import { t } from "../autoTranslateNightcord";

const ChannelStore = findStoreLazy("ChannelStore");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");

export const settings = definePluginSettings({
    showInAttachMenu: {
        type: OptionType.BOOLEAN,
        description: "Display Quick Messages in the attach (+) button menu.",
        default: true
    },
    showNextToAttach: {
        type: OptionType.BOOLEAN,
        description: "Display the Quick Messages button directly next to the attach (+) button.",
        default: true
    },
    showInChatBar: {
        type: OptionType.BOOLEAN,
        description: "Display the Quick Messages button in the chat action bar on the right.",
        default: false
    },
    autoCloseOnSend: {
        type: OptionType.BOOLEAN,
        description: "Automatically close the preset modal after sending a message.",
        default: true
    }
});

let observer: MutationObserver | null = null;

function createAttachButtonElement(): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nc-quick-messages-attach-btn";
    btn.setAttribute("aria-label", t("Quick Messages"));
    btn.title = t("Quick Messages");

    btn.innerHTML = `
        <svg class="vc-ic-save-icon" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24">
            <path d="M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h6.88c.37 0 .61-.38.5-.73a7 7 0 0 1-.37-2.7.53.53 0 0 0-.52-.57H6a1 1 0 1 1 0-2h6.36c.2 0 .37-.11.46-.28.3-.6.7-1.13 1.17-1.6.35-.37.11-1.12-.4-1.12H6a1 1 0 1 1 0-2h12a1 1 0 0 1 .88.52c.13.24.34.48.62.5.61.04 1.2.16 1.77.36.35.11.73-.13.73-.5V5a3 3 0 0 0-3-3H5Zm1 4a1 1 0 0 0 0 2h5a1 1 0 1 0 0-2H6Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" />
            <path d="M24 19a5 5 0 1 1-10 0 5 5 0 0 1 10 0Zm-5-3a1 1 0 0 1 1 1v1.59l.7.7a1 1 0 1 1-1.4 1.42l-1-1A1 1 0 0 1 18 19v-2a1 1 0 0 1 1-1Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" />
        </svg>
    `;

    const openHandler = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const curId = SelectedChannelStore?.getChannelId?.();
        const cur = curId ? ChannelStore?.getChannel?.(curId) : null;
        openModal(props => (
            <QuickMessagesModal
                rootProps={props}
                channel={cur}
                autoCloseOnSend={settings.store.autoCloseOnSend}
            />
        ));
    };

    btn.addEventListener("click", openHandler);
    btn.addEventListener("contextmenu", openHandler);
    return btn;
}

function scan(root: ParentNode = document) {
    if (!settings.store.showNextToAttach) return;
    try {
        const inners = root.querySelectorAll?.('[class*="attachButtonInner"]') ?? [];
        for (const inner of inners) {
            const el = inner as HTMLElement;
            const attachBtn = el.closest("button") || el.closest('[role="button"]') || el.parentElement;
            if (!attachBtn || !attachBtn.parentElement) continue;

            const targetWrapper = attachBtn.closest('[class*="attachWrapper"]') || attachBtn;
            const parentRow = targetWrapper.parentElement;
            if (!parentRow) continue;

            if (parentRow.querySelector(".nc-quick-messages-attach-wrapper")) continue;

            const newWrapper = document.createElement("div");
            newWrapper.className = "nc-quick-messages-attach-wrapper";

            const newBtn = createAttachButtonElement();
            newWrapper.appendChild(newBtn);

            targetWrapper.insertAdjacentElement("afterend", newWrapper);
        }
    } catch (e) {
        console.error("[QuickMessages] Error during scan:", e);
    }
}

function startObserver() {
    if (observer) return;
    observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof HTMLElement) {
                    scan(node);
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scan(document);
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    const injected = document.querySelectorAll(".nc-quick-messages-attach-wrapper, .nc-quick-messages-attach-btn");
    for (const el of injected) {
        el.remove();
    }
}

const channelAttachMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (settings.store.showInAttachMenu === false) return;
    if (!props?.channel) return;
    if (!Menu?.MenuItem) return;

    children.push(
        <Menu.MenuItem
            id="nc-quick-messages-attach-menu"
            key="nc-quick-messages-attach-menu"
            label={t("Quick Messages")}
            iconLeft={QuickMessagesIcon}
            icon={QuickMessagesIcon}
            leadingAccessory={{
                type: "icon",
                icon: QuickMessagesIcon
            }}
            action={() => {
                openModal(modalProps => (
                    <QuickMessagesModal
                        rootProps={modalProps}
                        channel={props.channel}
                        autoCloseOnSend={settings.store.autoCloseOnSend}
                    />
                ));
            }}
        />
    );
};

export default definePlugin({
    name: "QuickMessages",
    enabledByDefault: false,
    description: "Save custom preset messages and send or paste them instantly into any channel or DM with a single click.",
    authors: [EquicordDevs.nobody],
    settings,
    contextMenus: {
        "channel-attach": channelAttachMenuPatch
    },

    chatBarButton: {
        icon: QuickMessagesIcon,
        render: QuickMessagesChatBarButton
    },

    start() {
        loadQuickMessages();
        startObserver();
    },

    stop() {
        stopObserver();
    }
});
