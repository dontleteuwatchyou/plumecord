/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, React, Slider, useEffect, useState } from "@webpack/common";
import { t } from "../../nightcordplugins/autoTranslateNightcord";
import {
    clearAllStrokes,
    getActiveBrushColor,
    getActiveBrushSize,
    getDrawingStrokes,
    initOwnDrawingStrokes,
    isDrawingModeActive,
    PRESET_COLORS,
    saveDrawing,
    setActiveBrushColor,
    setActiveBrushSize,
    setDrawingMode,
    subscribeDrawingState,
    undoLastStroke
} from "./drawingManager";

const BrushIcon = ({ width = 18, height = 18, className }: { width?: number; height?: number; className?: string }) => (
    <svg
        width={width}
        height={height}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
        <path d="M7.07 14.94c-1.66 0-3 1.34-3 3 0 1.94-1.5 2.5-2.07 2.5 1.5 1.5 4.5 1.5 6.07 0 1.66-1.66 1.66-4.04 0-5.5z" />
    </svg>
);

const UndoIcon = ({ width = 14, height = 14 }: { width?: number; height?: number }) => (
    <svg
        width={width}
        height={height}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginRight: 6 }}
        aria-hidden="true"
    >
        <path d="M3 7v6h6" />
        <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
);

const ClearIcon = ({ width = 14, height = 14 }: { width?: number; height?: number }) => (
    <svg
        width={width}
        height={height}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginRight: 6 }}
        aria-hidden="true"
    >
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

const SaveIcon = ({ width = 16, height = 16 }: { width?: number; height?: number }) => (
    <svg
        width={width}
        height={height}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginRight: 6 }}
        aria-hidden="true"
    >
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
    </svg>
);

export function ProfileDrawingSection() {
    const [, setTick] = useState(0);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        void initOwnDrawingStrokes();
        const unsub = subscribeDrawingState(() => {
            setTick(t => t + 1);
        });
        return () => unsub();
    }, []);

    const isDrawing = isDrawingModeActive();
    const currentColor = getActiveBrushColor();
    const currentSize = getActiveBrushSize();
    const strokes = getDrawingStrokes();

    const handleToggleDrawing = () => {
        setDrawingMode(!isDrawing);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveDrawing();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="group__96e81 nc-drawing-section-group">
            {/* Header */}
            <div className="label__96e81">
                <h3
                    className="text-sm/medium_cf4812 defaultColor__5345c labelHeading__96e81"
                    data-text-variant="text-sm/medium"
                    style={{ color: "var(--header-primary)", fontWeight: 600 }}
                >
                    {t("Pinceau")}
                </h3>
            </div>

            {/* Native Discord Style Toggle Tile */}
            <div
                className={`tile__4e9aa bar__4e9aa nc-drawing-toggle-tile ${isDrawing ? "nc-drawing-toggle-tile-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={handleToggleDrawing}
            >
                <div className="tileButton__4e9aa" style={{ width: "100%" }}>
                    <div className="content__4e9aa" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <div
                                className="nc-drawing-tool-icon-wrapper"
                                style={{
                                    width: 36,
                                    height: 36,
                                    minWidth: 36,
                                    borderRadius: 8,
                                    background: isDrawing ? "var(--brand-500)" : "var(--background-secondary-alt)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: isDrawing ? "#ffffff" : "var(--interactive-normal)",
                                    transition: "all 0.15s ease",
                                }}
                            >
                                <BrushIcon width={20} height={20} />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                <span
                                    style={{
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: isDrawing ? "var(--brand-500)" : "var(--header-primary)",
                                    }}
                                >
                                    {isDrawing ? t("Done Drawing") : t("Draw on Profile")}
                                </span>
                                <span
                                    style={{
                                        fontSize: 12,
                                        color: "var(--text-muted)",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {isDrawing
                                        ? t("Drawing Mode Active")
                                        : strokes.length > 0
                                        ? `${strokes.length} ${t("stroke(s) drawn")}`
                                        : t("Draw freely on your profile preview. Your drawing will be visible to everyone on your profile!")}
                                </span>
                            </div>
                        </div>

                        <div
                            style={{
                                padding: "4px 8px",
                                borderRadius: 12,
                                fontSize: 11,
                                fontWeight: 600,
                                background: isDrawing ? "var(--brand-500)" : "var(--background-modifier-selected, rgba(255,255,255,0.08))",
                                color: isDrawing ? "#ffffff" : "var(--text-muted)",
                                marginLeft: 8,
                                whiteSpace: "nowrap",
                            }}
                        >
                            {isDrawing ? t("Active") : t("Inactive")}
                        </div>
                    </div>
                </div>
            </div>

            {/* Discord Native Controls Panel */}
            <div className="nc-drawing-controls-panel">
                {/* 1. Brush Size Slider & Live Dot Preview */}
                <div className="nc-drawing-control-row">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span className="nc-drawing-control-label">{t("Brush Size")}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--header-primary)" }}>
                                {currentSize}px
                            </span>
                            <span
                                style={{
                                    display: "inline-block",
                                    width: Math.max(4, Math.min(22, currentSize)),
                                    height: Math.max(4, Math.min(22, currentSize)),
                                    borderRadius: "50%",
                                    backgroundColor: currentColor,
                                    border: "1px solid rgba(255, 255, 255, 0.4)",
                                    boxShadow: "0 0 4px rgba(0,0,0,0.4)",
                                    transition: "width 0.1s ease, height 0.1s ease, background-color 0.1s ease",
                                }}
                            />
                        </div>
                    </div>

                    <Slider
                        markers={[1, 4, 8, 14, 22, 32]}
                        minValue={1}
                        maxValue={32}
                        initialValue={currentSize}
                        onValueChange={(val: number) => setActiveBrushSize(Math.max(1, Math.round(val)))}
                        onValueRender={(val: number) => `${Math.round(val)}px`}
                        stickToMarkers={false}
                    />
                </div>

                {/* 2. Color Palette + Custom Native Color Picker */}
                <div className="nc-drawing-control-row">
                    <span className="nc-drawing-control-label">{t("Color")}</span>
                    <div className="nc-drawing-palette">
                        {PRESET_COLORS.map(color => {
                            const isSelected = currentColor.toLowerCase() === color.toLowerCase();
                            return (
                                <button
                                    key={color}
                                    type="button"
                                    className={`nc-drawing-color-swatch ${isSelected ? "nc-drawing-color-swatch-active" : ""}`}
                                    style={{ backgroundColor: color }}
                                    onClick={() => setActiveBrushColor(color)}
                                    aria-label={color}
                                    title={color}
                                />
                            );
                        })}

                        {/* Custom Color Input */}
                        <label
                            className="nc-drawing-custom-color-label"
                            title={t("Custom Color")}
                            style={{
                                background: `conic-gradient(from 180deg at 50% 50%, #FF0000 0deg, #FFFF00 60deg, #00FF00 120deg, #00FFFF 180deg, #0000FF 240deg, #FF00FF 300deg, #FF0000 360deg)`,
                            }}
                        >
                            <input
                                type="color"
                                value={currentColor}
                                onChange={e => setActiveBrushColor(e.target.value)}
                                className="nc-drawing-native-color-picker"
                            />
                        </label>
                    </div>
                </div>

                {/* 3. Action Buttons (Well Framed & Non-Truncating) */}
                <div className="nc-drawing-actions-container">
                    <Button
                        size={Button.Sizes.MEDIUM}
                        color={Button.Colors.BRAND}
                        onClick={handleSave}
                        submitting={saving}
                        className="nc-drawing-save-btn"
                    >
                        <SaveIcon />
                        {t("Save Drawing")}
                    </Button>

                    <div className="nc-drawing-subactions-grid">
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            onClick={undoLastStroke}
                            disabled={strokes.length === 0}
                        >
                            <UndoIcon />
                            {t("Undo")}
                        </Button>

                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.RED}
                            onClick={clearAllStrokes}
                            disabled={strokes.length === 0}
                        >
                            <ClearIcon />
                            {t("Clear")}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
