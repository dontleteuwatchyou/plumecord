/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@api/i18n";
import { FormSwitch } from "@components/FormSwitch";
import { Button, React, Select, showToast, TextInput, Toasts, useEffect, useState, UserStore } from "@webpack/common";
import { triggerEffectsUpdate } from "../profileEffects/effectsManager";
import { DEFAULT_EFFECTS_CONFIG, getLocalEffectsConfig, saveLocalEffectsConfig, syncOwnDataToCloud, uploadToImgur } from "../sync";
import type { ProfileEffectsConfig } from "../types";

const PRESET_OPTIONS = [
    { label: "Cards Glitch", value: "cards-glitch" },
    { label: "Aurora", value: "aurora" },
    { label: "Cherry Blossom", value: "cherry-blossom" },
    { label: "Cyber Grid", value: "cyber-grid" },
    { label: "Galaxy", value: "galaxy" },
    { label: "Holographic", value: "holographic" },
    { label: "Lava Lamp", value: "lava-lamp" },
    { label: "Matrix", value: "matrix" },
    { label: "Neon Pulse", value: "neon-pulse" },
    { label: "Ocean Waves", value: "ocean-waves" },
    { label: "Particles", value: "particles" },
    { label: "Rainy City", value: "rainy-city" },
    { label: "Sakura", value: "sakura" },
    { label: "Snow", value: "snow" },
    { label: "Starfield", value: "starfield" },
];

const UploadIcon = () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
);

export function ProfileEffectsSettingsSection() {
    const [cfg, setCfg] = useState<ProfileEffectsConfig>(DEFAULT_EFFECTS_CONFIG);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        void getLocalEffectsConfig().then(c => setCfg(c));
    }, []);

    const update = async (next: Partial<ProfileEffectsConfig>) => {
        const full = { ...cfg, ...next };
        setCfg(full);
        await saveLocalEffectsConfig(full);
        triggerEffectsUpdate();
        void syncOwnDataToCloud();
    };

    const handleUploadGif = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const url = await uploadToImgur(file);
        setUploading(false);
        e.target.value = "";

        if (url) {
            await update({ gifUrl: url, mode: "gif", showBanner: true });
            showToast(t("Banner uploaded successfully"), Toasts.Type.SUCCESS);
        } else {
            showToast(t("Failed to upload GIF banner"), Toasts.Type.DANGER);
        }
    };

    const effectOptions = [
        { label: t("None"), value: "none" },
        { label: t("Glow (Light halo)"), value: "glow" },
        { label: t("Glitch (Cyberpunk)"), value: "glitch" },
        { label: t("Typewriter"), value: "type" },
        { label: t("Rainbow"), value: "rainbow" },
    ];

    const fitOptions = [
        { label: "Cover", value: "cover" },
        { label: "Contain", value: "contain" },
        { label: "Fill", value: "fill" },
    ];

    const currentUserName = UserStore.getCurrentUser()?.username || "Username";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Banner Section */}
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
                    {t("Animated Profile Banner")}
                </div>

                <FormSwitch
                    value={cfg.showBanner}
                    onChange={(v: boolean) => update({ showBanner: v })}
                    title={t("Enable animated banner")}
                    description={t("Displays a customized animated background on your profile modal and popout.")}
                    hideBorder
                />

                {cfg.showBanner && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                                    {t("Banner type")}
                                </div>
                                <Select
                                    options={[
                                        { label: t("CSS Animated Preset"), value: "preset" },
                                        { label: t("Custom GIF"), value: "gif" },
                                    ]}
                                    closeOnSelect={true}
                                    isSelected={(v: string) => v === (cfg.mode ?? "preset")}
                                    select={(val: string) => update({ mode: val as any })}
                                    serialize={String}
                                />
                            </div>

                            {cfg.mode === "preset" ? (
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                                        {t("Animation preset")}
                                    </div>
                                    <Select
                                        options={PRESET_OPTIONS}
                                        closeOnSelect={true}
                                        isSelected={(v: string) => v === (cfg.presetName ?? "cards-glitch")}
                                        select={(val: string) => update({ presetName: val })}
                                        serialize={String}
                                    />
                                </div>
                            ) : (
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                                        {t("Fitting (Fit)")}
                                    </div>
                                    <Select
                                        options={fitOptions}
                                        closeOnSelect={true}
                                        isSelected={(v: string) => v === (cfg.gifFit ?? "cover")}
                                        select={(val: string) => update({ gifFit: val as any })}
                                        serialize={String}
                                    />
                                </div>
                            )}
                        </div>

                        {cfg.mode === "gif" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                                            {t("Direct GIF URL")}
                                        </div>
                                        <TextInput
                                            placeholder="https://i.imgur.com/..."
                                            value={cfg.gifUrl}
                                            onChange={(val: string) => update({ gifUrl: val })}
                                        />
                                    </div>

                                    <div style={{ alignSelf: "flex-end" }}>
                                        <label style={{
                                            background: "var(--brand-500, #5865f2)",
                                            color: "#ffffff",
                                            padding: "8px 14px",
                                            borderRadius: 4,
                                            fontSize: 13,
                                            fontWeight: 500,
                                            cursor: uploading ? "wait" : "pointer",
                                            display: "inline-flex",
                                            alignItems: "center"
                                        }}>
                                            <UploadIcon />
                                            {uploading ? t("Uploading...") : t("Upload")}
                                            <input
                                                type="file"
                                                accept="image/gif,image/png,image/jpeg"
                                                style={{ display: "none" }}
                                                onChange={handleUploadGif}
                                                disabled={uploading}
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                                            {t("Opacity")} ({Math.round((cfg.gifOpacity ?? 0.6) * 100)}%)
                                        </div>
                                        <input
                                            type="range"
                                            min={0.1}
                                            max={1}
                                            step={0.05}
                                            value={cfg.gifOpacity ?? 0.6}
                                            onChange={e => update({ gifOpacity: parseFloat(e.target.value) })}
                                            style={{ width: "100%", accentColor: "var(--brand-500, #5865f2)", cursor: "pointer" }}
                                        />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>
                                            {t("Background color")}
                                        </div>
                                        <TextInput
                                            placeholder="#0a0010"
                                            value={cfg.gifBgColor ?? "#0a0010"}
                                            onChange={(val: string) => update({ gifBgColor: val })}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Name Effects Section */}
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
                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                        <span
                            className={
                                cfg.nameEffect === "glow" ? "cpe-glow" :
                                cfg.nameEffect === "glitch" ? "cpe-glitch" :
                                cfg.nameEffect === "rainbow" ? "cpe-rainbow-letter" :
                                cfg.nameEffect === "type" ? "cpe-type-cursor" : ""
                            }
                            data-cpe-text={currentUserName}
                            style={{
                                "--cpe-glow-color": cfg.glowColor || "#a78bfa"
                            } as any}
                        >
                            {currentUserName}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
