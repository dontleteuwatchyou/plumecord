/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@api/i18n";
import { EyeIcon, EyeSlashIcon } from "@components/Icons";
import { PluginOptionString } from "@utils/types";
import { React, TextArea, TextInput, useMemo, useState } from "@webpack/common";

import { resolveError, SettingProps, SettingsSection } from "./Common";

function isSecretSetting(id: string, option: PluginOptionString, value: any): boolean {
    const idLower = id.toLowerCase();
    const isExcluded = idLower.includes("hotkey") || idLower.includes("keyword") || idLower.includes("keyboard") || idLower.includes("monkey");
    if (!isExcluded) {
        if (
            idLower.includes("key") ||
            idLower.includes("token") ||
            idLower.includes("secret") ||
            idLower.includes("password") ||
            idLower.includes("auth") ||
            idLower.includes("credential")
        ) {
            return true;
        }
    }

    const descLower = (option.description ?? "").toLowerCase();
    if (
        descLower.includes("api key") ||
        descLower.includes("apikey") ||
        descLower.includes("clé api") ||
        descLower.includes("cle api") ||
        descLower.includes("secret") ||
        descLower.includes("token") ||
        descLower.includes("groq") ||
        descLower.includes("deepl") ||
        descLower.includes("password")
    ) {
        return true;
    }

    const placeholderLower = (option.placeholder ?? "").toLowerCase();
    if (
        placeholderLower.includes("gsk_") ||
        placeholderLower.includes("sk-") ||
        placeholderLower.includes("api key") ||
        placeholderLower.includes("apikey")
    ) {
        return true;
    }

    if (typeof value === "string") {
        const valTrimmed = value.trim();
        if (
            valTrimmed.startsWith("gsk_") ||
            valTrimmed.startsWith("sk-") ||
            valTrimmed.startsWith("ghp_") ||
            valTrimmed.startsWith("discord_") ||
            valTrimmed.startsWith("Bot ") ||
            valTrimmed.startsWith("Bearer ")
        ) {
            return true;
        }
    }

    if ((option as any).isSecret || (option as any).type === "password" || option.componentProps?.type === "password") {
        return true;
    }

    return false;
}

export function TextSetting({ option, pluginSettings, definedSettings, id, onChange }: SettingProps<PluginOptionString>) {
    const [state, setState] = useState(pluginSettings[id] ?? option.default ?? null);
    const [error, setError] = useState<string | null>(null);
    const [isRevealed, setIsRevealed] = useState(false);

    const isSecret = useMemo(() => isSecretSetting(id, option, state), [id, option, state]);

    function handleChange(newValue: string) {
        const isValid = option.isValid?.call(definedSettings, newValue) ?? true;

        setState(newValue);
        setError(resolveError(isValid));

        if (isValid === true) {
            onChange(newValue);
        }
    }

    const inputElement = option.multiline
        ? <TextArea
            placeholder={option.placeholder ?? "Enter a value"}
            value={state}
            onChange={handleChange}
            disabled={option.disabled?.call(definedSettings) ?? false}
            {...option.componentProps} />
        : <TextInput
            type="text"
            placeholder={option.placeholder ?? "Enter a value"}
            value={state}
            onChange={handleChange}
            maxLength={null}
            disabled={option.disabled?.call(definedSettings) ?? false}
            {...option.componentProps}
        />;

    return (
        <SettingsSection name={id} description={option.description} error={error}>
            {isSecret ? (
                <div className="nc-api-key-container">
                    <div className={`nc-api-key-input-wrapper ${!isRevealed ? "nc-blurred-api-key" : ""}`}>
                        {inputElement}
                    </div>
                    <button
                        type="button"
                        className="nc-api-key-toggle-btn"
                        style={{ color: "#ffffff" }}
                        title={isRevealed ? t("Hide API key") : t("Reveal API key")}
                        aria-label={isRevealed ? t("Hide API key") : t("Reveal API key")}
                        onClick={() => setIsRevealed(prev => !prev)}
                    >
                        {isRevealed ? <EyeSlashIcon width={18} height={18} fill="#ffffff" /> : <EyeIcon width={18} height={18} fill="#ffffff" />}
                    </button>
                </div>
            ) : inputElement}
        </SettingsSection>
    );
}
