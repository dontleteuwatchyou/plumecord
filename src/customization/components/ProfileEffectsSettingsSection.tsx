/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, React, Select, showToast, TextInput, Toasts, useEffect, useState } from "@webpack/common";
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

const EFFECT_OPTIONS = [
    { label: "Aucun", value: "none" },
    { label: "Glow (Halo lumineux)", value: "glow" },
    { label: "Glitch (Cyberpunk)", value: "glitch" },
    { label: "Typewriter (Machine à écrire)", value: "type" },
    { label: "Rainbow (Arc-en-ciel)", value: "rainbow" },
];

const FIT_OPTIONS = [
    { label: "Cover", value: "cover" },
    { label: "Contain", value: "contain" },
    { label: "Fill", value: "fill" },
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
            showToast("Bannière téléversée avec succès", Toasts.Type.SUCCESS);
        } else {
            showToast("Échec du téléversement du GIF", Toasts.Type.DANGER);
        }
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Banner Section */}
            <div style={{
                background: "var(--background-secondary-alt, #1e1f22)",
                padding: "16px 20px",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 14
            }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                    Bannière animée de profil
                </div>

                <FormSwitch
                    value={cfg.showBanner}
                    onChange={(v: boolean) => update({ showBanner: v })}
                    note="Affiche un arrière-plan animé personnalisé sur votre modale et popout de profil."
                    hideBorder
                >
                    Activer la bannière animée
                </FormSwitch>

                {cfg.showBanner && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Type de bannière</div>
                                <Select
                                    value={cfg.mode}
                                    options={[
                                        { label: "Preset animé CSS", value: "preset" },
                                        { label: "GIF Personnalisé", value: "gif" },
                                    ]}
                                    select={(val: any) => update({ mode: val })}
                                />
                            </div>

                            {cfg.mode === "preset" ? (
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Preset d'animation</div>
                                    <Select
                                        value={cfg.presetName}
                                        options={PRESET_OPTIONS}
                                        select={(val: any) => update({ presetName: val })}
                                    />
                                </div>
                            ) : (
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Ajustement (Fit)</div>
                                    <Select
                                        value={cfg.gifFit}
                                        options={FIT_OPTIONS}
                                        select={(val: any) => update({ gifFit: val })}
                                    />
                                </div>
                            )}
                        </div>

                        {cfg.mode === "gif" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>URL directe du GIF</div>
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
                                            {uploading ? "Téléversement..." : "Téléverser"}
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
                                            Opacité ({Math.round((cfg.gifOpacity ?? 0.6) * 100)}%)
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
                                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Couleur de fond</div>
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
                background: "var(--background-secondary-alt, #1e1f22)",
                padding: "16px 20px",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 14
            }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--header-primary, #ffffff)" }}>
                    Effets de texte sur le pseudo
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Effet sur le profil</div>
                        <Select
                            value={cfg.nameEffect}
                            options={EFFECT_OPTIONS}
                            select={(val: any) => update({ nameEffect: val })}
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Effet dans le chat</div>
                        <Select
                            value={cfg.chatUsernameEffect}
                            options={EFFECT_OPTIONS}
                            select={(val: any) => update({ chatUsernameEffect: val })}
                        />
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Effet dans la liste des membres</div>
                        <Select
                            value={cfg.memberListEffect}
                            options={EFFECT_OPTIONS}
                            select={(val: any) => update({ memberListEffect: val })}
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #949ba4)", marginBottom: 4 }}>Couleur du Glow (Hex)</div>
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
            </div>
        </div>
    );
}
