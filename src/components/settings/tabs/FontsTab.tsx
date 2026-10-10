/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@api/i18n";
import { FormSwitch } from "@components/FormSwitch";
import { SettingsTab } from "@components/settings/tabs/BaseTab";
import {
    GLOBAL_FONTS,
    getGlobalFontConfig,
    setGlobalFontConfig,
    type GlobalFontConfig
} from "customization/globalFonts/globalFontManager";
import { Button, React, showToast, TextInput, Toasts, useEffect, useState } from "@webpack/common";

const CheckIcon = () => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const ResetIcon = () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
    </svg>
);

const FontPreviewIcon = () => (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
);

export default function FontsTab() {
    const [config, setConfig] = useState<GlobalFontConfig>(getGlobalFontConfig);
    const [customInput, setCustomInput] = useState(config.customFamily || "");

    useEffect(() => {
        setConfig(getGlobalFontConfig());
    }, []);

    const update = (patch: Partial<GlobalFontConfig>) => {
        const next = setGlobalFontConfig(patch);
        setConfig(next);
        showToast(t("Client font updated successfully"), Toasts.Type.SUCCESS);
    };

    const handleSelectFont = (fontId: string) => {
        update({ fontId, enabled: true });
    };

    const handleCustomSubmit = () => {
        if (!customInput.trim()) return;
        update({ fontId: "custom", customFamily: customInput.trim(), enabled: true });
    };

    const handleReset = () => {
        update({ fontId: "none", customFamily: "", scale: 1.0, enabled: true });
        setCustomInput("");
    };

    const activeDef = GLOBAL_FONTS[config.fontId] || GLOBAL_FONTS.none;
    const isCustomActive = config.fontId !== "none" && config.enabled;

    return (
        <SettingsTab>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Header Description */}
                <div>
                    <h2 style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--header-primary, #ffffff)",
                        margin: "0 0 6px 0"
                    }}>
                        {t("Client Typography & Fonts")}
                    </h2>
                    <p style={{
                        fontSize: 14,
                        color: "var(--text-muted, #949ba4)",
                        margin: 0,
                        lineHeight: 1.45
                    }}>
                        {t("Customize the typography across your entire Discord client. Change the font for all settings, interface, messages, profiles, and dialogs.")}
                    </p>
                </div>

                {/* Status and Master Toggle Card */}
                <div style={{
                    background: "var(--background-secondary, #2b2d31)",
                    border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                    borderRadius: 8,
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16
                }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                                {t("Active Client Font")}
                            </span>
                            <span style={{
                                fontSize: 12,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 12,
                                background: isCustomActive ? "var(--brand-500, #5865f2)" : "var(--background-tertiary, #1e1f22)",
                                color: "#ffffff"
                            }}>
                                {config.fontId === "custom" && config.customFamily
                                    ? config.customFamily
                                    : t(activeDef.name)}
                            </span>
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-muted, #949ba4)" }}>
                            {isCustomActive
                                ? t("Custom typography applied to entire client interface and messages.")
                                : t("Default Discord typography is currently active.")}
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {isCustomActive && (
                            <Button
                                size={Button.Sizes.SMALL}
                                color={Button.Colors.PRIMARY}
                                onClick={handleReset}
                                style={{ display: "flex", alignItems: "center" }}
                            >
                                <ResetIcon />
                                {t("Reset to Default")}
                            </Button>
                        )}
                        <FormSwitch
                            value={config.enabled}
                            onChange={(val: boolean) => update({ enabled: val })}
                            hideBorder
                        />
                    </div>
                </div>

                {/* Available Fonts Grid */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--header-primary, #ffffff)",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                    }}>
                        {t("Select Font")}
                    </div>

                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                        gap: 12
                    }}>
                        {Object.values(GLOBAL_FONTS).filter(f => f.id !== "custom").map(font => {
                            const isSelected = config.enabled && config.fontId === font.id;
                            return (
                                <div
                                    key={font.id}
                                    onClick={() => handleSelectFont(font.id)}
                                    role="button"
                                    tabIndex={0}
                                    style={{
                                        background: isSelected
                                            ? "rgba(88, 101, 242, 0.12)"
                                            : "var(--background-secondary, #2b2d31)",
                                        border: `1.5px solid ${isSelected ? "var(--brand-500, #5865f2)" : "var(--border-subtle, rgba(255, 255, 255, 0.08))"}`,
                                        borderRadius: 8,
                                        padding: 16,
                                        cursor: "pointer",
                                        transition: "all 0.15s ease",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 10,
                                        boxShadow: isSelected ? "0 4px 14px rgba(88, 101, 242, 0.2)" : "none"
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div style={{
                                            fontSize: 15,
                                            fontWeight: 600,
                                            color: isSelected ? "var(--brand-500, #5865f2)" : "var(--header-primary, #ffffff)"
                                        }}>
                                            {t(font.name)}
                                        </div>
                                        {isSelected && (
                                            <div style={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: 10,
                                                background: "var(--brand-500, #5865f2)",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                color: "#ffffff"
                                            }}>
                                                <CheckIcon />
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ fontSize: 12, color: "var(--text-muted, #949ba4)", lineHeight: 1.35 }}>
                                        {t(font.description)}
                                    </div>

                                    {/* Direct font preview sample */}
                                    <div style={{
                                        marginTop: 4,
                                        padding: "8px 10px",
                                        background: "var(--background-tertiary, #1e1f22)",
                                        borderRadius: 6,
                                        fontFamily: font.fontFamily || "inherit",
                                        fontSize: font.id === "pixel" ? 11 : font.id === "signature" ? 20 : 14,
                                        color: "var(--header-primary, #ffffff)",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis"
                                    }}>
                                        Nightcord Discord Client 2026
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Custom Font Family Card */}
                <div style={{
                    background: "var(--background-secondary, #2b2d31)",
                    border: `1.5px solid ${config.fontId === "custom" && config.enabled ? "var(--brand-500, #5865f2)" : "var(--border-subtle, rgba(255, 255, 255, 0.08))"}`,
                    borderRadius: 8,
                    padding: "16px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                                {t("Custom Font")}
                            </div>
                            <div style={{ fontSize: 13, color: "var(--text-muted, #949ba4)", marginTop: 2 }}>
                                {t("Specify any font installed on your operating system (e.g. Segoe UI, Consolas, Roboto, Impact, Arial).")}
                            </div>
                        </div>
                        {config.fontId === "custom" && config.enabled && (
                            <span style={{
                                fontSize: 12,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 12,
                                background: "var(--brand-500, #5865f2)",
                                color: "#ffffff"
                            }}>
                                {t("Active")}
                            </span>
                        )}
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <TextInput
                            placeholder="Segoe UI, Tahoma, sans-serif"
                            value={customInput}
                            onChange={(val: string) => setCustomInput(val)}
                            style={{ flex: 1 }}
                        />
                        <Button
                            size={Button.Sizes.MEDIUM}
                            color={Button.Colors.BRAND}
                            onClick={handleCustomSubmit}
                            disabled={!customInput.trim()}
                        >
                            {t("Apply Custom Font")}
                        </Button>
                    </div>
                </div>

                {/* Live Client Preview Box */}
                <div style={{
                    background: "var(--background-secondary, #2b2d31)",
                    border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                    borderRadius: 8,
                    padding: "16px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <FontPreviewIcon />
                        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                            {t("Live Preview")}
                        </span>
                    </div>

                    <div style={{
                        background: "var(--background-tertiary, #1e1f22)",
                        borderRadius: 8,
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12
                    }}>
                        {/* Title simulation */}
                        <div style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: "var(--header-primary, #ffffff)",
                            borderBottom: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                            paddingBottom: 8
                        }}>
                            # general • Nightcord Community
                        </div>

                        {/* Message simulation */}
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                            <div style={{
                                width: 36,
                                height: 36,
                                borderRadius: 18,
                                background: "var(--brand-500, #5865f2)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 700,
                                color: "#ffffff",
                                flexShrink: 0
                            }}>
                                N
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                                        Nightcord User
                                    </span>
                                    <span style={{ fontSize: 12, color: "var(--text-muted, #949ba4)" }}>
                                        Today at 18:50
                                    </span>
                                </div>
                                <div style={{ fontSize: 14, color: "var(--text-normal, #dbdee1)", lineHeight: 1.45 }}>
                                    This is a live preview of how messages, channels, settings, and profile popouts look with this typography.
                                </div>
                            </div>
                        </div>

                        {/* Code snippet simulation */}
                        <div style={{
                            background: "var(--background-floating, #111214)",
                            borderRadius: 6,
                            padding: "8px 12px",
                            fontSize: 13,
                            color: "var(--text-normal, #dbdee1)"
                        }}>
                            <code>const typography = "100% applied across all Discord interface";</code>
                        </div>
                    </div>
                </div>
            </div>
        </SettingsTab>
    );
}
