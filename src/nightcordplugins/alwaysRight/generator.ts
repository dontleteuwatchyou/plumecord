/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showApiKeyWarning } from "@utils/apiKeyWarning";
import { insertTextIntoChatInputBox } from "@utils/discord";
import {
    ChannelStore,
    ComponentDispatch,
    Constants,
    GuildMemberStore,
    MessageStore,
    RestAPI,
    Toasts,
    UserStore
} from "@webpack/common";
import { t } from "../autoTranslateNightcord";
import { getGroqKey, groqChat } from "../nightcordAI/groqManager";
import { settings } from "./index";

let isGenerating = false;

export function getIsGenerating() {
    return isGenerating;
}

export async function resolveApiKey(): Promise<string> {
    const custom = settings.store.customApiKey?.trim();
    if (custom) return custom;
    const shared = await getGroqKey();
    if (shared) return shared;
    const fallback = (Vencord as any)?.Settings?.plugins?.NightcordAI?.apiKey?.trim?.();
    if (fallback) return fallback;
    return "";
}

export async function fetchRecentMessages(channelId: string, limit = 50): Promise<any[]> {
    try {
        const endpoint = Constants?.Endpoints?.MESSAGES?.(channelId) ?? `/channels/${channelId}/messages`;
        const res = await RestAPI.get({
            url: endpoint,
            query: { limit }
        });
        if (Array.isArray(res?.body) && res.body.length > 0) {
            // Discord API returns newest first; reverse for chronological order
            return res.body.slice().reverse();
        }
    } catch (err) {
        console.warn("[AlwaysRight] REST fetch failed, falling back to cached messages:", err);
    }
    const cached = MessageStore?.getMessages?.(channelId)?._array ?? [];
    return cached.slice(-limit);
}

function getAuthorName(author: any, guildId?: string): string {
    if (!author) return "User";
    if (guildId && GuildMemberStore?.getNick) {
        try {
            const nick = GuildMemberStore.getNick(guildId, author.id);
            if (nick) return nick;
        } catch {}
    }
    return author.globalName || author.global_name || author.username || "User";
}

function stripEmojis(text: string): string {
    return text
        .replace(/<a?:[a-zA-Z0-9_]+:[0-9]+>/g, "")
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function cleanAiOutput(text: string): string {
    let cleaned = text.trim();
    // Remove surrounding quotes if the AI wrapped the entire response
    cleaned = cleaned.replace(/^["'«“]+|["'»”]+$/g, "").trim();

    // Remove leading AI prefixes like "Response:", "Reply:", "AlwaysRight:"
    cleaned = cleaned.replace(/^(?:response|reply|alwaysright|ai):\s*/i, "").trim();

    // If still wrapped in quotes
    cleaned = cleaned.replace(/^["'«“]+|["'»”]+$/g, "").trim();
    return cleaned;
}

async function callGeminiApi(systemPrompt: string, userPrompt: string, apiKey: string, model: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            contents: [
                {
                    role: "user",
                    parts: [{ text: userPrompt }]
                }
            ],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: settings.store.responseFormat === "long" ? 1000 : 500,
            }
        })
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        // If 404 on model, fallback to gemini-2.0-flash or gemini-1.5-flash
        if (res.status === 404 && model !== "gemini-2.0-flash" && model !== "gemini-1.5-flash") {
            return callGeminiApi(systemPrompt, userPrompt, apiKey, "gemini-2.0-flash");
        }
        throw new Error(`Google Gemini error (${res.status}): ${body.slice(0, 160)}`);
    }

    const data = await res.json().catch(() => null);
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== "string" || !content.trim()) {
        throw new Error(t("The AI generated an empty response."));
    }
    return content.trim();
}

export async function generateAndInsertReply(channel: any, quickGuidance?: string): Promise<void> {
    if (!channel?.id) {
        Toasts.show({
            message: t("No active channel found."),
            type: Toasts.Type.FAILURE,
            id: Toasts.genId()
        });
        return;
    }

    if (isGenerating) {
        Toasts.show({
            message: t("AlwaysRight is analyzing and composing reply..."),
            type: Toasts.Type.NORMAL,
            id: Toasts.genId()
        });
        return;
    }

    const provider = settings.store.apiProvider ?? "nightcord";
    if (provider === "gemini") {
        const geminiKey = settings.store.geminiApiKey?.trim();
        if (!geminiKey) {
            Toasts.show({
                message: t("Gemini API key missing — configure it in AlwaysRight settings."),
                type: Toasts.Type.FAILURE,
                id: Toasts.genId()
            });
            return;
        }
    } else {
        const apiKey = await resolveApiKey();
        if (!apiKey) {
            showApiKeyWarning("AlwaysRight");
            return;
        }
    }

    isGenerating = true;

    try {
        const rawMessages = await fetchRecentMessages(channel.id, 50);
        if (!rawMessages || rawMessages.length === 0) {
            Toasts.show({
                message: t("No messages found in this channel to reply to."),
                type: Toasts.Type.FAILURE,
                id: Toasts.genId()
            });
            return;
        }

        const myUser = UserStore?.getCurrentUser?.();
        const myId = myUser?.id;
        const guildId = channel.guild_id || channel.guildId || channel.getGuildId?.();

        // Find the target message to reply to: the latest message not sent by current user
        let targetMsg = null;
        for (let i = rawMessages.length - 1; i >= 0; i--) {
            const m = rawMessages[i];
            if (m?.author?.id !== myId && m?.content?.trim()) {
                targetMsg = m;
                break;
            }
        }

        // If no message from someone else was found, fallback to the latest message with content
        if (!targetMsg) {
            for (let i = rawMessages.length - 1; i >= 0; i--) {
                if (rawMessages[i]?.content?.trim()) {
                    targetMsg = rawMessages[i];
                    break;
                }
            }
        }

        if (!targetMsg) {
            Toasts.show({
                message: t("No messages found in this channel to reply to."),
                type: Toasts.Type.FAILURE,
                id: Toasts.genId()
            });
            return;
        }

        const targetAuthor = getAuthorName(targetMsg.author, guildId);
        const targetContent = targetMsg.content?.trim() || "";

        // Build dialogue history (up to 50 messages for deep context)
        const historyLines = rawMessages
            .slice(-50)
            .map(m => {
                const author = getAuthorName(m.author, guildId);
                const isMe = m.author?.id === myId;
                const prefix = isMe ? "[You]" : `[${author}]`;
                const text = (m.content || "").trim();
                if (!text) return null;
                return `${prefix}: ${text}`;
            })
            .filter(Boolean);

        // Immediate last 10 messages
        const recentLines = historyLines.slice(-10);

        // Tone directive
        let toneInstruction = "Friendly, natural, and conversational.";
        if (settings.store.tone === "cordial") {
            toneInstruction = "Cordial, polite, articulate, and well-mannered while remaining compelling.";
        } else if (settings.store.tone === "direct") {
            toneInstruction = "Direct, frank, sharp, and concise. No greetings, no polite filler, straight to the core point.";
        }

        // Length directive
        let lengthInstruction = "Medium length (1 balanced paragraph, around 2 to 4 sentences).";
        if (settings.store.responseFormat === "short") {
            lengthInstruction = "Short and punchy (1 to 2 crisp sentences maximum).";
        } else if (settings.store.responseFormat === "long") {
            lengthInstruction = "Detailed and thorough (1 to 2 comprehensive paragraphs with complete reasoning).";
        }

        // Casing directive
        let casingInstruction = "Use standard, natural capitalization.";
        if (settings.store.capitalization === "lowercase") {
            casingInstruction = "Use strictly lowercase letters only (no uppercase or capital letters anywhere, casual chatter style).";
        }

        // Emoji directive
        let emojiInstruction = "Strictly ZERO emojis. Do not use any emojis or emoticons.";
        if (settings.store.emojiUsage === "with_emojis") {
            emojiInstruction = "You may naturally include 1 or 2 relevant emojis if fitting.";
        }

        // Language directive
        let langInstruction = "Detect the exact language and slang used by the interlocutor in TARGET_MESSAGE and reply in that EXACT same language.";
        if (settings.store.language && settings.store.language !== "auto") {
            langInstruction = `Reply strictly in ${settings.store.language}.`;
        }

        // Custom prompt
        const customPromptSetting = settings.store.customPrompt?.trim();
        const customPromptBlock = customPromptSetting
            ? `\nUser's Custom Persona & Directives: ${customPromptSetting}`
            : "";

        // Quick guidance from right click
        const quickGuidanceBlock = quickGuidance?.trim()
            ? `\nIMMEDIATE PRIORITY INSTRUCTION FOR THIS MESSAGE: ${quickGuidance.trim()}`
            : "";

        const systemPrompt = `You are AlwaysRight, an elite conversation strategist and articulate partner for Discord.
Your goal is to write the user's exact next message in reply to their conversation partner.
Analyze the target message and the surrounding context:
- If the partner is asking a question or seeking information, provide a clear, accurate, and insightful answer.
- If the partner makes a claim, argument, or debate point, construct a persuasive, unassailable, and witty response that proves the user is right or debunks misconceptions.
- If the partner is bantering or discussing casually, keep the momentum going smoothly and cleverly.

Guidelines:
1. Tone: ${toneInstruction}
2. Format: ${lengthInstruction}
3. Casing: ${casingInstruction}
4. Emojis: ${emojiInstruction}
5. Language: ${langInstruction}${customPromptBlock}${quickGuidanceBlock}

CRITICAL RULES:
- Output ONLY the text of the message itself.
- NEVER wrap your output in quotation marks.
- NEVER add introductory phrases like "Here's what you can say:", "Reply:", or "AlwaysRight:".
- NEVER state that you are an AI. Write as if you are the user themselves typing into Discord chat.`;

        const userPrompt = `=== CONVERSATION BACKGROUND (Up to 50 previous messages) ===
${historyLines.join("\n")}

=== RECENT EXCHANGES (Last 10 messages) ===
${recentLines.join("\n")}

=== TARGET MESSAGE TO REPLY TO ===
From: @${targetAuthor}
Content: "${targetContent}"

Compose the user's reply message now:`;

        let reply = "";
        if (provider === "gemini") {
            const geminiKey = settings.store.geminiApiKey?.trim();
            const model = settings.store.geminiModel || "gemini-2.5-flash";
            reply = await callGeminiApi(systemPrompt, userPrompt, geminiKey, model);
        } else {
            reply = await groqChat({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7,
                maxTokens: settings.store.responseFormat === "long" ? 1000 : 500,
            });
        }

        let finalReply = cleanAiOutput(reply);

        if (settings.store.capitalization === "lowercase") {
            finalReply = finalReply.toLowerCase();
        }

        if (settings.store.emojiUsage === "no_emojis") {
            finalReply = stripEmojis(finalReply);
        }

        if (!finalReply) {
            throw new Error(t("The AI generated an empty response."));
        }

        // Clear existing text draft and insert the AI-generated reply
        try {
            ComponentDispatch?.dispatchToLastSubscribed?.("CLEAR_TEXT");
        } catch {}

        insertTextIntoChatInputBox(finalReply);

        Toasts.show({
            message: t("AI response placed in chat input."),
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });

    } catch (err: any) {
        console.error("[AlwaysRight] Generation error:", err);
        Toasts.show({
            message: `${t("AlwaysRight Error")}: ${err?.message || String(err)}`,
            type: Toasts.Type.FAILURE,
            id: Toasts.genId()
        });
    } finally {
        isGenerating = false;
    }
}
