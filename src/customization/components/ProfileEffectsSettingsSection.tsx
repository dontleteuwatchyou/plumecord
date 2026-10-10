/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@api/i18n";
import { React, Select, TextInput, useEffect, useState, UserStore } from "@webpack/common";
import { triggerEffectsUpdate } from "../profileEffects/effectsManager";
import { getCachedEffectsConfig, getLocalEffectsConfig, saveLocalEffectsConfig, syncOwnDataToCloud } from "../sync";
import type { ProfileEffectsConfig } from "../types";

function TypewriterPreview({ text }: { text: string }) {
    const [displayed, setDisplayed] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (!isDeleting) {
            if (displayed.length < text.length) {
                timer = setTimeout(() => {
                    setDisplayed(text.slice(0, displayed.length + 1));
                }, 100);
            } else {
                timer = setTimeout(() => {
                    setIsDeleting(true);
                }, 1800);
            }
        } else {
            if (displayed.length > 0) {
                timer = setTimeout(() => {
                    setDisplayed(text.slice(0, displayed.length - 1));
                }, 60);
            } else {
                timer = setTimeout(() => {
                    setIsDeleting(false);
                }, 500);
            }
        }
        return () => clearTimeout(timer);
    }, [displayed, isDeleting, text]);

    return (
        <span
            className="cpe-type-cursor"
            style={{
                color: "var(--header-primary, #ffffff)",
                WebkitTextFillColor: "var(--header-primary, #ffffff)"
            }}
        >
            {displayed}
        </span>
    );
}

export function ProfileEffectsSettingsSection() {
    const [cfg, setCfg] = useState<ProfileEffectsConfig>(getCachedEffectsConfig);

    useEffect(() => {
        void getLocalEffectsConfig().then(c => setCfg(c));
    }, []);

    const update = async (next: Partial<ProfileEffectsConfig>) => {
        const full = { ...cfg, ...next, showBanner: false };
        setCfg(full);
        await saveLocalEffectsConfig(full);
        triggerEffectsUpdate();
        void syncOwnDataToCloud();
    };

    const effectOptions = [
        { label: t("None"), value: "none" },
        { label: t("Glow (Light halo)"), value: "glow" },
        { label: t("Glitch (Cyberpunk)"), value: "glitch" },
        { label: t("Typewriter"), value: "type" },
        { label: t("Rainbow"), value: "rainbow" },
    ];

    const currentUserName = UserStore.getCurrentUser()?.username || "Username";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Username Text Effects Card */}
            <div style={{
                background: "var(--background-secondary, #2b2d31)",
                padding: "16px 20px",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))"
            }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                    {t("Username Text Effects")}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                            {t("Effect on profile")}
                        </div>
                        <Select
                            options={effectOptions}
                            closeOnSelect={true}
                            isSelected={(v: string) => v === (cfg.nameEffect ?? "none")}
                            select={(val: string) => update({ nameEffect: val as any })}
                            serialize={String}
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                            {t("Effect in chat")}
                        </div>
                        <Select
                            options={effectOptions}
                            closeOnSelect={true}
                            isSelected={(v: string) => v === (cfg.chatUsernameEffect ?? "none")}
                            select={(val: string) => update({ chatUsernameEffect: val as any })}
                            serialize={String}
                        />
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                            {t("Effect in member list")}
                        </div>
                        <Select
                            options={effectOptions}
                            closeOnSelect={true}
                            isSelected={(v: string) => v === (cfg.memberListEffect ?? "none")}
                            select={(val: string) => update({ memberListEffect: val as any })}
                            serialize={String}
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                            {t("Glow Color (Hex)")}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input
                                type="color"
                                value={cfg.glowColor || "#a78bfa"}
                                onChange={e => update({ glowColor: e.target.value })}
                                style={{ width: 36, height: 36, border: "none", borderRadius: 4, cursor: "pointer", background: "none" }}
                            />
                            <TextInput
                                placeholder="#a78bfa"
                                value={cfg.glowColor || "#a78bfa"}
                                onChange={(val: string) => update({ glowColor: val })}
                            />
                        </div>
                    </div>
                </div>

                {/* Live Preview Card */}
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "var(--background-tertiary, #1e1f22)",
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                    marginTop: 2
                }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                            {t("Live Preview")}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-muted, #949ba4)" }}>
                            {t("Preview of your chosen profile effect")}
                        </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                        {cfg.nameEffect === "type" ? (
                            <TypewriterPreview text={currentUserName} />
                        ) : (
                            <span
                                className={
                                    cfg.nameEffect === "glow" ? "cpe-glow" :
                                    cfg.nameEffect === "glitch" ? "cpe-glitch" :
                                    cfg.nameEffect === "rainbow" ? "cpe-rainbow-letter" : ""
                                }
                                data-cpe-text={currentUserName}
                                style={{
                                    "--cpe-glow-color": cfg.glowColor || "#a78bfa",
                                    color: "var(--header-primary, #ffffff)",
                                    WebkitTextFillColor: cfg.nameEffect === "glow"
                                        ? (cfg.glowColor || "#a78bfa")
                                        : cfg.nameEffect === "rainbow"
                                        ? "transparent"
                                        : "var(--header-primary, #ffffff)"
                                } as any}
                            >
                                {currentUserName}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
