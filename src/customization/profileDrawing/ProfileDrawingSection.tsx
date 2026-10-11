/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@api/i18n";
import { Button, React, useEffect, useState } from "@webpack/common";
import {
    BRUSH_SIZES,
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

const SaveIcon = ({ width = 14, height = 14 }: { width?: number; height?: number }) => (
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
                    style={{ color: "var(--header-primary)" }}
                >
                    {t("Pinceau")}
                </h3>
            </div>

            {/* Toggle Tile */}
            <div
                className={`tile__4e9aa bar__4e9aa nc-drawing-toggle-tile ${isDrawing ? "nc-drawing-toggle-tile-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={handleToggleDrawing}
            >
                <div className="tileButton__4e9aa">
                    <div className="content__4e9aa" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                            className="nc-drawing-tool-icon-wrapper"
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                background: isDrawing ? "var(--brand-500)" : "var(--background-secondary-alt)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: isDrawing ? "#ffffff" : "var(--interactive-normal)",
                            }}
                        >
                            <BrushIcon width={20} height={20} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                            <span
                                style={{
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: isDrawing ? "var(--brand-500)" : "var(--header-primary)",
                                }}
                            >
                                {isDrawing ? t("Done Drawing") : t("Draw on Profile")}
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                {strokes.length > 0
                                    ? `${strokes.length} trait(s) tracé(s)`
                                    : t("Draw freely on your profile preview. Your drawing will be visible to everyone on your profile!")}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Controls Container */}
            <div className="nc-drawing-controls-panel">
                {/* 4 Brush Tip Sizes */}
                <div className="nc-drawing-control-row">
                    <span className="nc-drawing-control-label">{t("Brush Size")}</span>
                    <div className="nc-drawing-sizes-list">
                        {BRUSH_SIZES.map(item => {
                            const isSelected = currentSize === item.size;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`nc-drawing-size-btn ${isSelected ? "nc-drawing-size-btn-active" : ""}`}
                                    onClick={() => setActiveBrushSize(item.size)}
                                    title={t(item.label)}
                                    aria-label={t(item.label)}
                                >
                                    <span
                                        className="nc-drawing-size-dot"
                                        style={{
                                            width: Math.max(4, item.size),
                                            height: Math.max(4, item.size),
                                            backgroundColor: isSelected ? "var(--brand-500)" : "var(--text-muted)",
                                        }}
                                    />
                                    <span className="nc-drawing-size-text">{item.size}px</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Color Palette + Custom Picker */}
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
                            title="Couleur personnalisée"
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

                {/* Actions: Undo, Clear, Save */}
                <div className="nc-drawing-actions-row">
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

                    <div style={{ flex: 1 }} />

                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.BRAND}
                        onClick={handleSave}
                        submitting={saving}
                    >
                        <SaveIcon />
                        {t("Save Drawing")}
                    </Button>
                </div>
            </div>
        </div>
    );
}
