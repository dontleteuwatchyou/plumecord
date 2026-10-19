/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { EquicordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";

import { FloodPanelButton } from "./components/ChatBarButton";
import { FloodModal } from "./components/FloodModal";
import { FloodIcon } from "./components/Icons";
import { t } from "../autoTranslateNightcord";

const ChannelStore = findStoreLazy("ChannelStore");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");

function OpenFloodPanelSetting() {
    return (
        <Button
            size="small"
            variant="primary"
            onClick={() => {
                const curId = SelectedChannelStore?.getChannelId?.();
                const cur = curId ? ChannelStore?.getChannel?.(curId) : null;
                if (cur) {
                    openModal(props => (
                        <FloodModal
                            channel={cur}
                            rootProps={props}
                            onRunningChange={() => {}}
                        />
                    ));
                }
            }}
        >
            {t("Open Flood Panel")}
        </Button>
    );
}

const settings = definePluginSettings({
    openPanel: {
        type: OptionType.COMPONENT,
        description: t("Open the full Flood Panel interface directly."),
        component: OpenFloodPanelSetting
    },
    defaultDelay: {
        type: OptionType.NUMBER,
        description: "Default delay between messages (ms).",
        default: 500
    },
    defaultShuffle: {
        type: OptionType.BOOLEAN,
        description: "Randomize message order by default.",
        default: true
    }
});

export { settings };

export default definePlugin({
    name: "FloodPanel",
    enabledByDefault: true,
    description: "Send a flood of messages rapidly in any channel. Load a custom .txt file or use the built-in phrases. Accessible from the chat bar.",
    authors: [EquicordDevs.nobody],
    settings,

    chatBarButton: {
        icon: FloodIcon,
        render: FloodPanelButton
    },
});
