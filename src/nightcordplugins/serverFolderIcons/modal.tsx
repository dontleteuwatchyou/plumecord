/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, FormSwitch, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, React, Slider, Text, TextInput, showToast, Toasts } from "@webpack/common";
import { ModalSize } from "@utils/modal";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { CustomFolderIconData, BackgroundMode, ServerFolderProps } from "./types";
import { t } from "../autoTranslateNightcord";

export function int2rgba(rgbVal: number = 0, alpha: number = 1): string {
    const b = rgbVal & 0xFF;
    const g = (rgbVal & 0xFF00) >>> 8;
    const r = (rgbVal & 0xFF0000) >>> 16;
    return `rgba(${[r, g, b].join(",")},${alpha})`;
}

// Crisp minimalist SVG presets (0 emojis)
const PRESET_ICONS = [
    {
        name: "Gamepad",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line><rect x="2" y="6" width="20" height="12" rx="6"></rect></svg>`
    },
    {
        name: "Code",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`
    },
    {
        name: "Music",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`
    },
    {
        name: "Crown",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"></path></svg>`
    },
    {
        name: "Shield",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`
    },
    {
        name: "Star",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
    },
    {
        name: "Message",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`
    },
    {
        name: "Fire",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>`
    },
    {
        name: "Globe",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`
    },
    {
        name: "Folder",
        svg: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
    }
];

function svgToDataUrl(svgString: string, color: string = "#ffffff"): string {
    const colored = svgString.replace(/stroke="currentColor"/g, `stroke="${color}"`);
    return `data:image/svg+xml;utf8,${encodeURIComponent(colored)}`;
}

export function FolderIconEditModal({
    folderProps,
    initialData,
    onSave,
    onReset,
    onClose,
    transitionState
}: {
    folderProps: ServerFolderProps;
    initialData?: CustomFolderIconData | null;
    onSave: (data: CustomFolderIconData) => void;
    onReset: () => void;
    onClose: () => void;
    transitionState: any;
}) {
    const [url, setUrl] = React.useState(initialData?.url || "");
    const [size, setSize] = React.useState(initialData?.size ?? 100);
    const [radius, setRadius] = React.useState(initialData?.radius ?? 33);
    const [bgMode, setBgMode] = React.useState<BackgroundMode>(initialData?.bgMode || "folderColor");

    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            showToast("File size too large (max 5 MB)", Toasts.Type.DANGER);
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                setUrl(reader.result);
                showToast("Image loaded", Toasts.Type.SUCCESS);
            }
        };
        reader.readAsDataURL(file);
    };

    // Calculate background style for preview
    let previewBackground = "transparent";
    if (bgMode === "folderColor") {
        previewBackground = int2rgba(folderProps.folderColor ?? 0x5865F2, 0.4);
    } else if (bgMode === "solid") {
        previewBackground = int2rgba(folderProps.folderColor ?? 0x5865F2, 1.0);
    }

    return (
        <ModalRoot transitionState={transitionState} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false} style={{ padding: "20px 24px 12px 24px" }}>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <div>
                        <h2 style={{ color: "#ffffff", fontSize: "18px", fontWeight: 700, margin: 0 }}>
                            {t("Customize Folder Icon")}
                        </h2>
                        <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "13px" }}>
                            {folderProps.folderName || `Folder #${folderProps.folderId}`}
                        </span>
                    </div>
                    <ModalCloseButton onClick={onClose} />
                </Flex>
            </ModalHeader>

            <ModalContent style={{ padding: "12px 24px 24px 24px" }}>
                {/* Live Preview Section */}
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "20px",
                    padding: "16px 20px",
                    background: "var(--background-secondary, #2b2d31)",
                    borderRadius: "10px",
                    marginBottom: "18px",
                    border: "1px solid var(--background-modifier-accent, rgba(255,255,255,0.06))"
                }}>
                    <div style={{
                        width: "56px",
                        height: "56px",
                        borderRadius: `${radius}%`,
                        backgroundColor: previewBackground,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        flexShrink: 0,
                        border: bgMode === "transparent" ? "1px dashed rgba(255,255,255,0.2)" : "none",
                        transition: "all 0.2s ease"
                    }}>
                        {url ? (
                            <img
                                src={url}
                                alt="Folder Preview"
                                style={{
                                    width: `${size}%`,
                                    height: `${size}%`,
                                    objectFit: "contain",
                                    transition: "all 0.15s ease"
                                }}
                            />
                        ) : (
                            <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "11px", textAlign: "center" }}>
                                {t("No Icon")}
                            </span>
                        )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                        <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "14px" }}>
                            {t("Live Preview")}
                        </span>
                        <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px", lineHeight: "1.4" }}>
                            {t("This is how your folder will look in the Discord server list.")}
                        </span>
                    </div>
                </div>

                {/* Preset Icons Section */}
                <div style={{ marginBottom: "16px" }}>
                    <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "8px" }}>
                        {t("Preset Vector Icons")}
                    </span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {PRESET_ICONS.map(preset => (
                            <button
                                key={preset.name}
                                onClick={() => setUrl(svgToDataUrl(preset.svg))}
                                title={preset.name}
                                style={{
                                    all: "unset",
                                    width: "36px",
                                    height: "36px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: "var(--background-secondary-alt, #1e1f22)",
                                    borderRadius: "8px",
                                    cursor: "pointer",
                                    color: "var(--text-normal, #dbdee1)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    transition: "all 0.15s ease"
                                }}
                            >
                                <div dangerouslySetInnerHTML={{ __html: preset.svg }} style={{ width: "20px", height: "20px", display: "flex" }} />
                            </button>
                        ))}
                    </div>
                </div>

                {/* URL Input and File Picker */}
                <div style={{ marginBottom: "16px" }}>
                    <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>
                        {t("Image URL or Base64")}
                    </span>
                    <Flex alignItems={FlexAlign.CENTER} gap="8px" style={{ width: "100%" }}>
                        <TextInput
                            value={url}
                            onChange={(val: string) => setUrl(val)}
                            placeholder="https://example.com/logo.png"
                            style={{ flex: 1 }}
                        />
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFileUpload}
                            style={{ display: "none" }}
                        />
                        <Button
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                            style={{ whiteSpace: "nowrap" }}
                        >
                            {t("Choose Local File")}
                        </Button>
                    </Flex>
                </div>

                {/* Sliders: Size & Radius */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                    <div>
                        <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ marginBottom: "6px" }}>
                            <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                {t("Icon Size")}
                            </span>
                            <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px" }}>{size}%</span>
                        </Flex>
                        <Slider
                            initialValue={size}
                            onValueChange={(v: number) => setSize(Math.round(v))}
                            minValue={30}
                            maxValue={150}
                            keyboardStep={5}
                            stickToMarkers={false}
                        />
                    </div>
                    <div>
                        <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ marginBottom: "6px" }}>
                            <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                {t("Corner Radius")}
                            </span>
                            <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "12px" }}>{radius}%</span>
                        </Flex>
                        <Slider
                            initialValue={radius}
                            onValueChange={(v: number) => setRadius(Math.round(v))}
                            minValue={0}
                            maxValue={50}
                            keyboardStep={5}
                            stickToMarkers={false}
                        />
                    </div>
                </div>

                {/* Background Mode Options */}
                <div>
                    <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "8px" }}>
                        {t("Background Mode")}
                    </span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                        <Button
                            variant={bgMode === "transparent" ? "primary" : "secondary"}
                            onClick={() => setBgMode("transparent")}
                            style={{ fontSize: "12px", padding: "8px 12px" }}
                        >
                            {t("Transparent Background")}
                        </Button>
                        <Button
                            variant={bgMode === "folderColor" ? "primary" : "secondary"}
                            onClick={() => setBgMode("folderColor")}
                            style={{ fontSize: "12px", padding: "8px 12px" }}
                        >
                            {t("Folder Color (Discord)")}
                        </Button>
                        <Button
                            variant={bgMode === "solid" ? "primary" : "secondary"}
                            onClick={() => setBgMode("solid")}
                            style={{ fontSize: "12px", padding: "8px 12px" }}
                        >
                            {t("Solid Color")}
                        </Button>
                    </div>
                </div>
            </ModalContent>

            <ModalFooter>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <Button
                        variant="dangerPrimary"
                        onClick={() => {
                            onReset();
                            onClose();
                            showToast("Folder icon reset", Toasts.Type.INFO);
                        }}
                    >
                        {t("Reset to Default")}
                    </Button>
                    <Flex alignItems={FlexAlign.CENTER} gap="10px">
                        <Button
                            variant="secondary"
                            onClick={onClose}
                        >
                            {t("Cancel")}
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => {
                                if (!url) {
                                    onReset();
                                } else {
                                    onSave({
                                        url: url.trim(),
                                        size,
                                        radius,
                                        bgMode
                                    });
                                }
                                onClose();
                                showToast("Folder icon saved", Toasts.Type.SUCCESS);
                            }}
                        >
                            {t("Save Icon")}
                        </Button>
                    </Flex>
                </Flex>
            </ModalFooter>
        </ModalRoot>
    );
}
