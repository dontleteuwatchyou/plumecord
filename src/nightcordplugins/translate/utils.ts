/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Nightcord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { classNameFactory } from "@utils/css";
import { onlyOnce } from "@utils/onlyOnce";
import { PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import { DeeplLanguages, deeplLanguageToGoogleLanguage, GoogleLanguages } from "./languages";
import { resetLanguageDefaults, settings } from "./settings";

export const cl = classNameFactory("vc-trans-");

const Native = VencordNative.pluginHelpers.Translate as PluginNative<typeof import("./native")>;

interface GoogleData {
    translation: string;
    sourceLanguage: string;
}

interface DeeplData {
    translations: {
        detected_source_language: string;
        text: string;
    }[];
}

export interface TranslationValue {
    sourceLanguage: string;
    text: string;
}

export const getLanguages = () => IS_WEB || settings.store.service === "google"
    ? GoogleLanguages
    : DeeplLanguages;

export async function translate(kind: "received" | "sent", text: string): Promise<TranslationValue> {
    const translate = IS_WEB || settings.store.service === "google"
        ? googleTranslate
        : deeplTranslate;

    try {
        return await translate(
            text,
            settings.store[`${kind}Input`],
            settings.store[`${kind}Output`]
        );
    } catch (e) {
        const userMessage = typeof e === "string"
            ? e
            : "Something went wrong. If this issue persists, please check the console or ask for help in the support server.";

        showToast(userMessage, Toasts.Type.FAILURE);

        throw e instanceof Error
            ? e
            : new Error(userMessage);
    }
}

async function googleTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    const sl = sourceLang === "auto" || !sourceLang ? "auto" : sourceLang;
    const tl = targetLang || "en";

    // 1. Primary: Direct translate_a/single (no API key required, highly reliable)
    try {
        const url = `https://translate.googleapis.com/translate_a/single?${new URLSearchParams({
            client: "gtx",
            sl,
            tl,
            dt: "t",
            dj: "1",
            source: "input",
            q: text
        })}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const translatedText = data.sentences?.map((s: any) => s.trans).filter(Boolean).join("") || "";
            if (translatedText) {
                const detected = data.src || sl;
                return {
                    sourceLanguage: GoogleLanguages[detected] ?? detected,
                    text: translatedText
                };
            }
        }
    } catch {}

    // 2. Secondary: translate-pa.googleapis.com
    try {
        const url = "https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
            "params.client": "gtx",
            "dataTypes": "TRANSLATION",
            "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA",
            "query.sourceLanguage": sl,
            "query.targetLanguage": tl,
            "query.text": text,
        });

        const res = await fetch(url);
        if (res.ok) {
            const data: GoogleData = await res.json();
            if (data.translation) {
                return {
                    sourceLanguage: GoogleLanguages[data.sourceLanguage] ?? data.sourceLanguage,
                    text: data.translation
                };
            }
        }
    } catch {}

    throw new Error(`Failed to translate "${text}" (${sl} -> ${tl})`);
}

function fallbackToGoogle(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    return googleTranslate(
        text,
        deeplLanguageToGoogleLanguage(sourceLang),
        deeplLanguageToGoogleLanguage(targetLang)
    );
}

const showDeeplApiQuotaToast = onlyOnce(
    () => showToast("Deepl API quota exceeded. Falling back to Google Translate", Toasts.Type.FAILURE)
);

async function deeplTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    if (!settings.store.deeplApiKey) {
        showToast("DeepL API key is not set. Resetting to Google", Toasts.Type.FAILURE);

        settings.store.service = "google";
        resetLanguageDefaults();

        return fallbackToGoogle(text, sourceLang, targetLang);
    }

    // CORS jumpscare
    const { status, data } = await Native.makeDeeplTranslateRequest(
        settings.store.service === "deepl-pro",
        settings.store.deeplApiKey,
        JSON.stringify({
            text: [text],
            target_lang: targetLang,
            source_lang: sourceLang.split("-")[0]
        })
    );

    switch (status) {
        case 200:
            break;
        case -1:
            throw "Failed to connect to DeepL API: " + data;
        case 403:
            throw "Invalid DeepL API key or version";
        case 456:
            showDeeplApiQuotaToast();
            return fallbackToGoogle(text, sourceLang, targetLang);
        default:
            throw new Error(`Failed to translate "${text}" (${sourceLang} -> ${targetLang})\n${status} ${data}`);
    }

    const { translations }: DeeplData = JSON.parse(data);
    const src = translations[0].detected_source_language;

    return {
        sourceLanguage: DeeplLanguages[src] ?? src,
        text: translations[0].text
    };
}
