/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";
import { t } from "../autoTranslateNightcord";
import { AlwaysRightModal } from "./AlwaysRightModal";
import { generateAndInsertReply, getIsGenerating } from "./generator";
import { AlwaysRightIcon } from "./Icon";

export const settings = definePluginSettings({
    tone: {
        type: OptionType.SELECT,
        description: "Tone and attitude for AI replies",
        options: [
            { label: "Friendly", value: "friendly", default: true },
            { label: "Cordial", value: "cordial" },
            { label: "Direct (No Politeness)", value: "direct" },
        ],
        default: "friendly",
    },
    responseFormat: {
        type: OptionType.SELECT,
        description: "Length and detail of the generated response",
        options: [
            { label: "Short (1-2 sentences)", value: "short" },
            { label: "Medium (1 paragraph)", value: "medium", default: true },
            { label: "Detailed (Full argument)", value: "long" },
        ],
        default: "medium",
    },
    capitalization: {
        type: OptionType.SELECT,
        description: "Letter casing style for the response",
        options: [
            { label: "Normal capitalization", value: "normal", default: true },
            { label: "Lowercase only", value: "lowercase" },
        ],
        default: "normal",
    },
    emojiUsage: {
        type: OptionType.SELECT,
        description: "Include or disallow emojis in responses",
        options: [
            { label: "No emojis", value: "no_emojis", default: true },
            { label: "Allow emojis", value: "with_emojis" },
        ],
        default: "no_emojis",
    },
    language: {
        type: OptionType.SELECT,
        description: "Language used for generating replies",
        options: [
            { label: "Auto-detect from conversation", value: "auto", default: true },
            { label: "French", value: "French" },
            { label: "English", value: "English" },
            { label: "Spanish", value: "Spanish" },
            { label: "German", value: "German" },
            { label: "Arabic", value: "Arabic" },
            { label: "Russian", value: "Russian" },
            { label: "Chinese", value: "Chinese" },
            { label: "Portuguese", value: "Portuguese" },
            { label: "Italian", value: "Italian" },
            { label: "Japanese", value: "Japanese" },
        ],
        default: "auto",
    },
    customPrompt: {
        type: OptionType.STRING,
        description: "Custom instructions for how the AI should argue and reply (e.g. cite statistics, be witty, act like a lawyer)",
        default: "",
    },
    customApiKey: {
        type: OptionType.STRING,
        description: "Optional custom Groq API key override (leave empty to use Nightcord AI key)",
        default: "",
    },
    showChatBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show the AlwaysRight quick button in the chat bar",
        default: true,
    },
});

const AlwaysRightChatBarButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    if (!isMainChat) return null;
    if (!settings.store.showChatBarButton) return null;

    const generating = getIsGenerating();

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        generateAndInsertReply(channel);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openModal(props => (
            <AlwaysRightModal rootProps={props} channel={channel} />
        ));
    };

    return (
        <ChatBarButton
            tooltip={t("AlwaysRight - AI Reply (Right-click for prompt)")}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <AlwaysRightIcon loading={generating} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AlwaysRight",
    description: "Generates smart, persuasive, and perfectly phrased AI responses based on conversation context.",
    authors: [{ name: "Nightcord", id: 0n }],
    enabledByDefault: false,
    dependencies: ["ChatInputButtonAPI"],
    settings,

    chatBarButton: {
        icon: () => <AlwaysRightIcon />,
        render: AlwaysRightChatBarButton,
    },
});
