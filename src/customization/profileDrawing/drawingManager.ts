/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@api/i18n";
import { showToast, Toasts, UserStore } from "@webpack/common";
import {
    getCachedEffectsConfig,
    getLocalEffectsConfig,
    profileCache,
    saveLocalEffectsConfig,
    syncOwnDataToCloud
} from "../sync";
import type { ProfileDrawingData, ProfileDrawingStroke } from "../types";

export const BRUSH_SIZES = [
    { id: "fine", label: "Fine", size: 2 },
    { id: "medium", label: "Medium", size: 5 },
    { id: "thick", label: "Thick", size: 10 },
    { id: "extra", label: "Extra Thick", size: 18 },
] as const;

export const PRESET_COLORS = [
    "#FFFFFF",
    "#5865F2",
    "#00F0FF",
    "#57F287",
    "#FEE75C",
    "#EB459E",
    "#ED4245",
    "#A855F7",
    "#000000",
];

export function getBrushCursor(color: string): string {
    const safeColor = color || "#FFFFFF";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
        <path d="M4 28 L8 24 L6 22 L2 26 C1.5 26.5 1.5 27.5 2 28 C2.5 28.5 3.5 28.5 4 28 Z" fill="${safeColor}"/>
        <path d="M8 24 L11 21 L8 18 L5 21 Z" fill="#b0b0b0" stroke="#000" stroke-width="0.8"/>
        <path d="M11 21 L24 8 C25.5 6.5 25.5 4.2 24 2.7 C22.5 1.2 20.2 1.2 18.7 2.7 L5.7 15.7 Z" fill="#5865F2" stroke="#000" stroke-width="1"/>
        <circle cx="2" cy="28" r="2" fill="${safeColor}" stroke="#ffffff" stroke-width="0.5"/>
    </svg>`;
    try {
        const b64 = btoa(svg);
        return `url("data:image/svg+xml;base64,${b64}") 2 28, crosshair`;
    } catch {
        return "crosshair";
    }
}

// ─── Drawing Manager State ───────────────────────────────────────────────────

let currentStrokes: ProfileDrawingStroke[] = [];
let activeBrushColor = "#FFFFFF";
let activeBrushSize = 5;
let isDrawingActive = false;
let activeCanvas: HTMLCanvasElement | null = null;
let currentActiveStroke: ProfileDrawingStroke | null = null;

const stateListeners = new Set<() => void>();

function notifyListeners() {
    for (const listener of stateListeners) {
        try { listener(); } catch {}
    }
}

export function subscribeDrawingState(listener: () => void): () => void {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
}

export function getDrawingStrokes(): ProfileDrawingStroke[] {
    return [...currentStrokes];
}

export function setDrawingStrokes(strokes: ProfileDrawingStroke[]) {
    currentStrokes = [...strokes];
    notifyListeners();
    redrawActiveCanvases();
}

export function getActiveBrushColor(): string {
    return activeBrushColor;
}

export function setActiveBrushColor(color: string) {
    activeBrushColor = color;
    notifyListeners();
    updateInteractiveCanvasCursor();
}

export function getActiveBrushSize(): number {
    return activeBrushSize;
}

export function setActiveBrushSize(size: number) {
    activeBrushSize = size;
    notifyListeners();
}

export function isDrawingModeActive(): boolean {
    return isDrawingActive;
}

export function undoLastStroke() {
    if (currentStrokes.length > 0) {
        currentStrokes.pop();
        notifyListeners();
        redrawActiveCanvases();
    }
}

export function clearAllStrokes() {
    if (currentStrokes.length > 0) {
        currentStrokes = [];
        notifyListeners();
        redrawActiveCanvases();
    }
}

// Initialize own strokes from config
export async function initOwnDrawingStrokes() {
    const config = await getLocalEffectsConfig();
    if (config.profileDrawing && Array.isArray(config.profileDrawing.strokes)) {
        currentStrokes = [...config.profileDrawing.strokes];
        notifyListeners();
    }
}

export async function saveDrawing(): Promise<boolean> {
    try {
        const effects = await getLocalEffectsConfig();
        const drawingData: ProfileDrawingData = {
            enabled: true,
            strokes: [...currentStrokes],
            updatedAt: Date.now(),
        };

        const updatedEffects = {
            ...effects,
            profileDrawing: drawingData,
        };

        await saveLocalEffectsConfig(updatedEffects);
        const curUser = UserStore.getCurrentUser();
        if (curUser?.id) {
            const cached = profileCache.get(curUser.id);
            if (cached?.data) {
                cached.data.effects = updatedEffects;
            }
        }

        void syncOwnDataToCloud();
        showToast(t("Drawing saved and synced successfully!"), Toasts.Type.SUCCESS);
        redrawAllProfiles();
        return true;
    } catch (e) {
        console.error("[ProfileDrawing] Failed to save drawing:", e);
        showToast(t("Failed to save drawing"), Toasts.Type.DANGER);
        return false;
    }
}

// ─── Canvas Stroke Rendering ─────────────────────────────────────────────────

export function drawStrokes(
    ctx: CanvasRenderingContext2D,
    strokes: ProfileDrawingStroke[],
    width: number,
    height: number
) {
    if (!strokes || strokes.length === 0 || width <= 0 || height <= 0) return;

    // Base coordinate reference width (340px standard card width)
    const scaleFactor = Math.max(0.6, width / 340);

    for (const stroke of strokes) {
        if (!stroke.points || stroke.points.length === 0) continue;

        const strokeWidth = Math.max(1, stroke.size * scaleFactor);
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (stroke.points.length === 1) {
            const [nx, ny] = stroke.points[0];
            const px = nx * width;
            const py = ny * height;
            ctx.beginPath();
            ctx.arc(px, py, strokeWidth / 2, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }

        ctx.beginPath();
        const [firstNx, firstNy] = stroke.points[0];
        ctx.moveTo(firstNx * width, firstNy * height);

        for (let i = 1; i < stroke.points.length; i++) {
            const [nx, ny] = stroke.points[i];
            ctx.lineTo(nx * width, ny * height);
        }
        ctx.stroke();
    }
}

// ─── Drawing Overlay Renderer on Any Profile Container ───────────────────────

export function renderDrawingOverlay(
    container: HTMLElement,
    data?: ProfileDrawingData | null,
    interactive = false
): HTMLCanvasElement | null {
    if (!container) return null;

    let canvas = container.querySelector<HTMLCanvasElement>(".nc-profile-drawing-overlay");

    if (!data || !data.enabled || (!interactive && (!data.strokes || data.strokes.length === 0))) {
        if (canvas && !canvas.classList.contains("nc-profile-drawing-interactive")) {
            canvas.remove();
        }
        return null;
    }

    if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.className = "nc-profile-drawing-overlay";
        canvas.setAttribute("aria-hidden", "true");
        container.appendChild(canvas);
    }

    // Ensure container has relative/absolute positioning
    const compPos = window.getComputedStyle(container).position;
    if (compPos === "static") {
        container.style.position = "relative";
    }

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const strokesToDraw = interactive ? currentStrokes : (data.strokes || []);
    drawStrokes(ctx, strokesToDraw, width, height);

    if (interactive && currentActiveStroke) {
        drawStrokes(ctx, [currentActiveStroke], width, height);
    }
    ctx.restore();

    return canvas;
}

// Redraw all visible profile overlays
export function redrawAllProfiles() {
    const curUser = UserStore.getCurrentUser();
    const ownEffects = getCachedEffectsConfig();

    const profileElements = document.querySelectorAll<HTMLElement>(
        "[class*='userProfileOuter'], [class*='userProfileModalOuter'], [class*='userPopout'], [class*='user-profile-popout'], .user-profile-popout, [class*='themeContainer_'], [class*='preview_']"
    );

    for (const el of Array.from(profileElements)) {
        const isSelf = !!el.closest("[id='account'], [class*='accountProfile']") ||
            el.querySelector(`img[src*='${curUser?.id}']`) !== null ||
            el.closest("[class*='preview_']") !== null;

        if (isSelf && ownEffects.profileDrawing) {
            renderDrawingOverlay(el, ownEffects.profileDrawing);
        }
    }
}

function redrawActiveCanvases() {
    if (activeCanvas && isDrawingActive) {
        const container = activeCanvas.parentElement;
        if (container) {
            renderDrawingOverlay(container, { enabled: true, strokes: currentStrokes, updatedAt: Date.now() }, true);
        }
    }
}

function updateInteractiveCanvasCursor() {
    if (activeCanvas && isDrawingActive) {
        activeCanvas.style.cursor = getBrushCursor(activeBrushColor);
    }
}

// ─── Interactive Drawing Mode Engine ─────────────────────────────────────────

let badgeElement: HTMLElement | null = null;

function removeActiveBadge() {
    if (badgeElement) {
        badgeElement.remove();
        badgeElement = null;
    }
}

function createActiveBadge(container: HTMLElement) {
    removeActiveBadge();
    const badge = document.createElement("div");
    badge.className = "nc-drawing-mode-badge";
    badge.innerHTML = `
        <span class="nc-drawing-badge-dot"></span>
        <span class="nc-drawing-badge-text">${t("Drawing Mode Active")}</span>
        <button type="button" class="nc-drawing-badge-done-btn">${t("Done Drawing")}</button>
    `;

    const doneBtn = badge.querySelector<HTMLButtonElement>(".nc-drawing-badge-done-btn");
    doneBtn?.addEventListener("click", e => {
        e.stopPropagation();
        setDrawingMode(false);
    });

    container.appendChild(badge);
    badgeElement = badge;
}

export function setDrawingMode(active: boolean) {
    if (isDrawingActive === active) return;
    isDrawingActive = active;
    notifyListeners();

    if (active) {
        attachInteractiveCanvas();
    } else {
        detachInteractiveCanvas();
    }
}

export function findProfilePreviewElement(): HTMLElement | null {
    // Look for profile preview in settings or modal
    const candidates = [
        "[class*='preview_'] [class*='userProfileOuter']",
        "[class*='preview_'] [class*='themeContainer_']",
        "[class*='preview_']",
        "[class*='userProfileOuter'][class*='theme-']",
        "[class*='userProfileOuter']",
        "[class*='userProfileModalOuter']",
        "[class*='userPopout']",
    ];

    for (const sel of candidates) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el && el.clientWidth > 100 && el.clientHeight > 100) {
            return el;
        }
    }
    return null;
}

function handlePointerDown(e: PointerEvent) {
    if (!activeCanvas || !isDrawingActive) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = activeCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    activeCanvas.setPointerCapture?.(e.pointerId);

    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    currentActiveStroke = {
        color: activeBrushColor,
        size: activeBrushSize,
        points: [[nx, ny]],
    };

    redrawActiveCanvases();
}

function handlePointerMove(e: PointerEvent) {
    if (!activeCanvas || !isDrawingActive || !currentActiveStroke) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = activeCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    currentActiveStroke.points.push([nx, ny]);
    redrawActiveCanvases();
}

function handlePointerUp(e: PointerEvent) {
    if (!activeCanvas || !isDrawingActive || !currentActiveStroke) return;
    e.preventDefault();
    e.stopPropagation();

    if (currentActiveStroke.points.length > 0) {
        currentStrokes.push(currentActiveStroke);
        currentActiveStroke = null;
        notifyListeners();
        redrawActiveCanvases();
    }
}

function handlePointerCancel() {
    if (currentActiveStroke) {
        currentActiveStroke = null;
        redrawActiveCanvases();
    }
}

export function attachInteractiveCanvas() {
    const previewEl = findProfilePreviewElement();
    if (!previewEl) return;

    const canvas = renderDrawingOverlay(previewEl, { enabled: true, strokes: currentStrokes, updatedAt: Date.now() }, true);
    if (!canvas) return;

    activeCanvas = canvas;
    canvas.classList.add("nc-profile-drawing-interactive");
    canvas.style.cursor = getBrushCursor(activeBrushColor);
    canvas.style.pointerEvents = "auto";

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);

    createActiveBadge(previewEl);
}

export function detachInteractiveCanvas() {
    removeActiveBadge();
    if (activeCanvas) {
        activeCanvas.removeEventListener("pointerdown", handlePointerDown);
        activeCanvas.removeEventListener("pointermove", handlePointerMove);
        activeCanvas.removeEventListener("pointerup", handlePointerUp);
        activeCanvas.removeEventListener("pointercancel", handlePointerCancel);
        activeCanvas.classList.remove("nc-profile-drawing-interactive");
        activeCanvas.style.cursor = "";
        activeCanvas.style.pointerEvents = "none";
        activeCanvas = null;
    }
    redrawAllProfiles();
}
