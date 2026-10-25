/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showApiKeyWarning } from "@utils/apiKeyWarning";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    ComponentDispatch,
    Constants,
    GuildMemberStore,
    MessageStore,
    PendingReplyStore,
    RestAPI,
    SelectedChannelStore,
    Toasts,
    UserStore
} from "@webpack/common";
import { t } from "../autoTranslateNightcord";
import { getGroqKey, groqChat } from "../nightcordAI/groqManager";
import { settings } from "./index";

function getSlateEditor(target: HTMLElement | null): any {
    if (!target) return null;
    const slateEl = (
        target.closest?.('[data-slate-editor="true"]') ||
        target.closest?.('[role="textbox"]') ||
        target
    ) as HTMLElement | null;
    if (!slateEl) return null;

    let current: HTMLElement | null = slateEl;
    while (current && current !== document.body) {
        const keys = Object.keys(current);
        const fiberKey = keys.find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
        if (fiberKey) {
            let fiber = (current as any)[fiberKey];
            let depth = 0;
            while (fiber && depth < 40) {
                const editor =
                    fiber.memoizedProps?.editor ||
                    fiber.stateNode?.editor ||
                    fiber.memoizedState?.editor ||
                    fiber.stateNode?.props?.editor;

                if (editor && typeof editor.insertText === "function") {
                    return editor;
                }
                fiber = fiber.return;
                depth++;
            }
        }
        current = current.parentElement;
    }
    return null;
}

export async function insertReplyIntoChat(channelId: string, text: string): Promise<boolean> {
    const getSlateEl = () => (
        document.querySelector<HTMLElement>('div[role="textbox"][contenteditable="true"]') ||
        document.querySelector<HTMLElement>('div[role="textbox"]') ||
        document.querySelector<HTMLElement>('[data-slate-editor="true"]')
    );

    let slateEl = getSlateEl();

    // 1. Dispatch focus to Discord's chat input bus and focus the DOM node
    try {
        ComponentDispatch?.dispatchToLastSubscribed?.("TEXTAREA_FOCUS");
    } catch {}

    if (slateEl) {
        try {
            slateEl.focus();
        } catch {}
    }

    // Wait a tick to ensure Slate updates focus state and selection
    await new Promise(resolve => setTimeout(resolve, 35));

    // 2. Clear old text from the chat input
    try {
        ComponentDispatch?.dispatchToLastSubscribed?.("CLEAR_TEXT");
    } catch {}

    // 3. Dispatch insert text ONCE to the active chat input
    try {
        ComponentDispatch?.dispatchToLastSubscribed?.("INSERT_TEXT", {
            rawText: text,
            plainText: text,
        });
    } catch {}

    // Wait a tick to verify if text was accepted by Slate
    await new Promise(resolve => setTimeout(resolve, 40));

    // 4. Verify insertion in DOM. If missing or empty, run Slate fiber + execCommand fallbacks
    const updatedEl = getSlateEl();
    const currentText = (updatedEl?.textContent || "").trim();
    const prefixToCheck = text.slice(0, Math.min(10, text.length)).trim();

    if (!currentText || !currentText.includes(prefixToCheck)) {
        let insertedViaFiber = false;

        // Try direct Slate Editor instance via React Fiber
        if (updatedEl) {
            try {
                const editor = getSlateEditor(updatedEl);
                if (editor && typeof editor.insertText === "function") {
                    if (Array.isArray(editor.children) && editor.children.length > 0) {
                        const lastIdx = editor.children.length - 1;
                        const lastChild = editor.children[lastIdx];
                        const leaves = Array.isArray(lastChild?.children) ? lastChild.children : [lastChild];
                        const lastLeafIdx = Math.max(0, leaves.length - 1);
                        const leaf = leaves[lastLeafIdx];
                        const endOffset = typeof leaf?.text === "string" ? leaf.text.length : 0;
                        editor.selection = {
                            anchor: { path: [0, 0], offset: 0 },
                            focus: { path: [lastIdx, lastLeafIdx], offset: endOffset }
                        };
                    }
                    if (typeof editor.deleteFragment === "function") {
                        try { editor.deleteFragment(); } catch {}
                    }
                    editor.insertText(text);
                    insertedViaFiber = true;
                }
            } catch (e) {
                console.warn("[AlwaysRight] Slate fiber insertion fallback error:", e);
            }
        }

        // Try DOM Range + execCommand
        if (!insertedViaFiber && updatedEl) {
            try {
                updatedEl.focus();
                const sel = window.getSelection();
                if (sel) {
                    const range = document.createRange();
                    range.selectNodeContents(updatedEl);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
                document.execCommand("selectAll", false, undefined);
                document.execCommand("insertText", false, text);
                updatedEl.dispatchEvent(new InputEvent("input", {
                    bubbles: true,
                    cancelable: true,
                    inputType: "insertText",
                    data: text
                }));
            } catch {}
        }
    }

    // 5. Ensure the chat input remains focused for immediate user editing/sending
    const finalEl = getSlateEl();
    if (finalEl) {
        try {
            finalEl.focus();
        } catch {}
    } else {
        try {
            ComponentDispatch?.dispatchToLastSubscribed?.("TEXTAREA_FOCUS");
        } catch {}
    }

    return true;
}

let isGenerating = false;
const generatingListeners = new Set<(val: boolean) => void>();

export function getIsGenerating() {
    return isGenerating;
}

export function onGeneratingChange(cb: (val: boolean) => void) {
    generatingListeners.add(cb);
    return () => {
        generatingListeners.delete(cb);
    };
}

function setGenerating(val: boolean) {
    isGenerating = val;
    generatingListeners.forEach(cb => {
        try {
            cb(val);
        } catch {}
    });
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

    // Remove leading AI prefixes like "Response:", "Reply:", "AlwaysRight:"
    cleaned = cleaned.replace(/^(?:response|reply|alwaysright|ai):\s*/i, "").trim();

    // Only strip quotes if the ENTIRE message was wrapped in quotes from start to finish
    if (
        (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
        (cleaned.startsWith("«") && cleaned.endsWith("»")) ||
        (cleaned.startsWith("“") && cleaned.endsWith("”"))
    ) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    return cleaned;
}

let cachedGeminiModel: string | null = null;

async function resolveGeminiModel(apiKey: string, requestedModel?: string): Promise<string> {
    if (cachedGeminiModel && !requestedModel) {
        return cachedGeminiModel;
    }

    try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
        const listRes = await fetch(listUrl);
        if (listRes.ok) {
            const data = await listRes.json();
            if (Array.isArray(data?.models)) {
                const supported = data.models
                    .filter((m: any) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
                    .map((m: any) => m.name.replace(/^models\//, ""));

                if (requestedModel && supported.includes(requestedModel)) {
                    cachedGeminiModel = requestedModel;
                    return requestedModel;
                }

                // Prefer modern 2.0 / 2.5 flash models
                const best =
                    supported.find((m: string) => m.includes("2.0-flash") || m.includes("2.5-flash")) ||
                    supported.find((m: string) => m.includes("flash")) ||
                    supported.find((m: string) => m.includes("pro")) ||
                    supported[0];

                if (best) {
                    cachedGeminiModel = best;
                    return best;
                }
            }
        }
    } catch (e) {
        console.warn("[AlwaysRight] Failed to fetch Gemini model list:", e);
    }

    return requestedModel || "gemini-2.0-flash";
}

async function callGeminiApi(systemPrompt: string, userPrompt: string, apiKey: string, model?: string): Promise<string> {
    let targetModel = await resolveGeminiModel(apiKey, model || settings.store.geminiModel);

    const makeRequest = async (mod: string) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent?key=${encodeURIComponent(apiKey)}`;
        return fetch(url, {
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
                    maxOutputTokens: settings.store.responseFormat === "long" ? 1500 : 800,
                }
            })
        });
    };

    let res = await makeRequest(targetModel);

    // If 404 or 400 on requested model, try fallbacks
    if (!res.ok && (res.status === 404 || res.status === 400)) {
        const fallbacks = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-pro"]
            .filter(m => m !== targetModel);

        for (const fb of fallbacks) {
            console.warn(`[AlwaysRight] Model ${targetModel} failed (${res.status}), trying fallback: ${fb}`);
            const fbRes = await makeRequest(fb);
            if (fbRes.ok) {
                res = fbRes;
                targetModel = fb;
                cachedGeminiModel = fb;
                break;
            }
        }
    }

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Google Gemini error (${res.status}): ${body.slice(0, 160)}`);
    }

    const data = await res.json().catch(() => null);
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== "string" || !content.trim()) {
        throw new Error(t("The AI generated an empty response."));
    }
    return content.trim();
}

export async function generateAndInsertReply(channel: any, quickGuidance?: string, explicitTargetMessage?: any): Promise<void> {
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

    setGenerating(true);

    try {
        const myUser = UserStore?.getCurrentUser?.();
        const myId = myUser?.id;
        const guildId = channel.guild_id || channel.guildId || channel.getGuildId?.();

        // Check if there is an explicitly selected message to reply to:
        // 1. Directly passed message (e.g. from context menu)
        // 2. Or from Discord's active PendingReplyStore for this channel
        const pendingReply = PendingReplyStore?.getPendingReply?.(channel.id);
        const selectedReplyMsg = explicitTargetMessage || pendingReply?.message;
        const isDirectReply = Boolean(selectedReplyMsg);

        let targetMsg: any = selectedReplyMsg || null;
        let rawMessages: any[] = [];

        // If no explicit message was selected, fetch channel history to find the latest interlocutor message
        if (!targetMsg) {
            rawMessages = await fetchRecentMessages(channel.id, 50);
            if (!rawMessages || rawMessages.length === 0) {
                Toasts.show({
                    message: t("No messages found in this channel to reply to."),
                    type: Toasts.Type.FAILURE,
                    id: Toasts.genId()
                });
                return;
            }

            for (let i = rawMessages.length - 1; i >= 0; i--) {
                const m = rawMessages[i];
                if (m?.author?.id !== myId && m?.content?.trim()) {
                    targetMsg = m;
                    break;
                }
            }

            // Fallback to latest message if none from someone else
            if (!targetMsg) {
                for (let i = rawMessages.length - 1; i >= 0; i--) {
                    if (rawMessages[i]?.content?.trim()) {
                        targetMsg = rawMessages[i];
                        break;
                    }
                }
            }
        } else {
            // Replying to a specific selected message: fetch recent messages for light background context
            try {
                rawMessages = await fetchRecentMessages(channel.id, 15);
            } catch {
                rawMessages = [];
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
        let lengthInstruction = "Adaptive: Dynamically match the interlocutor's message length and depth. If they sent a short 1-line message, reply with a concise, punchy 1-line response. If they sent a longer message or asked for an in-depth explanation or sources, reply with a proportionate, well-reasoned paragraph.";
        if (settings.store.responseFormat === "short") {
            lengthInstruction = "Short and punchy (1 to 2 crisp, complete sentences maximum).";
        } else if (settings.store.responseFormat === "medium") {
            lengthInstruction = "Medium length (1 balanced paragraph, around 2 to 4 sentences).";
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

        const replyScopeInstruction = isDirectReply
            ? `\n\nCRITICAL SCOPE DIRECTIVE (SPECIFIC MESSAGE REPLY):
The user has explicitly selected ONE single message to reply to:
- From: @${targetAuthor}
- Message: "${targetContent}"
Your response MUST content itself with replying SOLELY, DIRECTLY, and EXCLUSIVELY to this particular message.
- Address ONLY what is stated, argued, asked, or claimed in this specific message.
- Do NOT bring in, merge, or get sidetracked by other unrelated conversation threads, side discussions, or other messages from the channel.
- Be razor-focused on answering, countering, or addressing this exact message.`
            : "";

        const systemPrompt = `You are AlwaysRight, an elite conversation strategist and articulate partner for Discord.
Your goal is to write the user's exact next message in reply to their conversation partner.

CONTEXT & STANCE CONSISTENCY:
- The conversation history contains messages labeled as [You] (sent by the user) and [@Username] (sent by the interlocutor).
- CAREFULLY ANALYZE [You]'s previous messages: identify the user's exact opinions, arguments, perspective, and past claims. Your reply MUST remain 100% faithful and consistent with what [You] has been defending. Never contradict the user's established position or flip sides.
- CAREFULLY ANALYZE the interlocutor's messages: detect their mindset, claims, questions, or logical fallacies, and address them with precision, wit, and authority.${replyScopeInstruction}

Analyze the target message and the surrounding context:
- If the partner is asking a question or seeking information, provide a clear, accurate, and insightful answer.
- If the partner asks for sources, proof, or links (e.g. "sortez la source", "source ?", "d'où tu sors ça", "t'as des preuves ?"):
  * NEVER say "google it" or "cherche sur internet".
  * ALWAYS cite concrete, real-world authorities, peer-reviewed journals, recognized organizations, or specific landmark studies (e.g. PubMed, OMS/WHO, INSERM, CDC, Nature, Journal of Applied Physiology, INSEE, Pew Research, or specific researchers like Janssen et al.).
- If the partner makes a claim, argument, or debate point, construct a persuasive, unassailable, and witty response that proves the user is right or debunks misconceptions.
- If the partner is bantering or discussing casually, keep the momentum going smoothly and cleverly without forcing an argument.

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
- NEVER state that you are an AI. Write as if you are the user themselves typing into Discord chat.
- NO CLICHÉ CONVERSATION ENDERS: NEVER use artificial, arrogant conversation stoppers like "le débat est clos", "point final", "c'est indiscutable", "fin de l'histoire", "circulez", or "case closed". They sound unnatural, childish, and forced. Sound like a real person, confident, grounded, and articulate.
- COMPLETENESS: Always ensure every message is 100% complete and finishes its final sentence properly with valid punctuation. Never stop or cut off mid-thought.`;

        let userPrompt = "";
        if (isDirectReply) {
            userPrompt = `=== SPECIFIC MESSAGE SELECTED TO REPLY TO ===
From: @${targetAuthor}
Content: "${targetContent}"

=== BACKGROUND CONTEXT (Recent messages for context only - focus strictly on replying to the specific message above) ===
${recentLines.join("\n")}

Compose the reply directly to @${targetAuthor}'s message above:`;
        } else {
            userPrompt = `=== CONVERSATION BACKGROUND (Up to 50 previous messages) ===
${historyLines.join("\n")}

=== RECENT EXCHANGES (Last 10 messages) ===
${recentLines.join("\n")}

=== TARGET MESSAGE TO REPLY TO ===
From: @${targetAuthor}
Content: "${targetContent}"

Compose the user's reply message now:`;
        }

        let reply = "";
        if (provider === "gemini") {
            const geminiKey = settings.store.geminiApiKey?.trim();
            const model = settings.store.geminiModel || "gemini-1.5-flash";
            reply = await callGeminiApi(systemPrompt, userPrompt, geminiKey, model);
        } else {
            reply = await groqChat({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7,
                maxTokens: settings.store.responseFormat === "long" ? 1200 : 800,
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

        // Insert the AI-generated reply into chat input robustly
        await insertReplyIntoChat(channel?.id || SelectedChannelStore?.getChannelId?.(), finalReply);

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
        setGenerating(false);
    }
}
