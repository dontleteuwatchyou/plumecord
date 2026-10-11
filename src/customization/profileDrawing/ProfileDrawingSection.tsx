/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FormSwitch } from "@components/FormSwitch";
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

const PipetteIcon = ({ width = 14, height = 14 }: { width?: number; height?: number }) => (
    <svg
        width={width}
        height={height}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" />
        <path d="m5 2 5 5" />
        <path d="m2 5 5 5" />
        <circle cx="21" cy="21" r="1" />
    </svg>
);

const PRESET_SIZES = [2, 4, 8, 14, 22, 32];

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

    const handleToggleDrawing = (val: boolean) => {
        setDrawingMode(val);
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
        <div className="nc-drawing-section-group">
            {/* Native Discord ON/OFF Switch */}
            <div className="nc-drawing-switch-wrapper">
                <FormSwitch
                    title={t("Mode dessin")}
                    description={
                        isDrawing
                            ? t("Drawing mode active (Ctrl+Z to undo)")
                            : strokes.length > 0
                            ? `${strokes.length} ${t("stroke(s) drawn")}`
                            : t("Draw freely on your profile preview")
                    }
                    value={isDrawing}
                    onChange={handleToggleDrawing}
                    hideBorder
                />
            </div>

            {/* Controls Panel */}
            <div className="nc-drawing-controls-panel">
                {/* 1. Brush Size Slider & Pill Presets */}
                <div className="nc-drawing-control-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span className="nc-drawing-control-label">{t("Brush Size")}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span className="nc-drawing-size-badge">
                                {currentSize}px
                            </span>
                            <span
                                style={{
                                    display: "inline-block",
                                    width: Math.max(4, Math.min(24, currentSize)),
                                    height: Math.max(4, Math.min(24, currentSize)),
                                    borderRadius: "50%",
                                    backgroundColor: currentColor,
                                    border: "1.5px solid rgba(255, 255, 255, 0.6)",
                                    boxShadow: `0 0 6px ${currentColor}55`,
                                    transition: "width 0.1s ease, height 0.1s ease, background-color 0.1s ease",
                                }}
                            />
                        </div>
                    </div>

                    {/* Smooth Continuous Slider without tick marks */}
                    <div className="nc-drawing-slider-wrapper">
                        <Slider
                            minValue={1}
                            maxValue={36}
                            initialValue={currentSize}
                            onValueChange={(val: number) => setActiveBrushSize(Math.max(1, Math.round(val)))}
                            onValueRender={(val: number) => `${Math.round(val)}px`}
                            stickToMarkers={false}
                        />
                    </div>

                    {/* Quick Preset Size Pills */}
                    <div className="nc-drawing-size-pills-row">
                        {PRESET_SIZES.map(sz => (
                            <button
                                key={sz}
                                type="button"
                                className={`nc-drawing-size-pill ${currentSize === sz ? "nc-drawing-size-pill-active" : ""}`}
                                onClick={() => setActiveBrushSize(sz)}
                            >
                                {sz}px
                            </button>
                        ))}
                    </div>
                </div>

                {/* 2. Color Palette Grid (11 curated colors + 1 custom color picker in 6x2 grid) */}
                <div className="nc-drawing-control-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <span className="nc-drawing-control-label">{t("Color")}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", fontFamily: "monospace" }}>
                            {currentColor.toUpperCase()}
                        </span>
                    </div>

                    <div className="nc-drawing-palette-grid">
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
                                >
                                    {isSelected && (
                                        <span
                                            style={{
                                                display: "block",
                                                width: 8,
                                                height: 8,
                                                borderRadius: "50%",
                                                backgroundColor: ["#ffffff", "#fee75c", "#57f287"].includes(color.toLowerCase())
                                                    ? "#111214"
                                                    : "#ffffff",
                                                boxShadow: "0 0 2px rgba(0,0,0,0.5)",
                                            }}
                                        />
                                    )}
                                </button>
                            );
                        })}

                        {/* Custom Color Input */}
                        <label
                            className={`nc-drawing-custom-color-label ${!PRESET_COLORS.some(c => c.toLowerCase() === currentColor.toLowerCase()) ? "nc-drawing-color-swatch-active" : ""}`}
                            title={t("Custom Color")}
                        >
                            <PipetteIcon width={14} height={14} />
                            <input
                                type="color"
                                value={currentColor}
                                onChange={e => setActiveBrushColor(e.target.value)}
                                className="nc-drawing-native-color-picker"
                            />
                        </label>
                    </div>
                </div>

                {/* 3. Action Buttons */}
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
                            {t("Undo (Ctrl+Z)")}
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
