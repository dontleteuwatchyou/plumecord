/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface GlobalFontConfig {
    enabled: boolean;
    fontId: string;
    customFamily: string;
    scale: number;
}

export interface GlobalFontDefinition {
    id: string;
    name: string;
    description: string;
    fontFamily: string;
    previewText?: string;
    letterSpacing?: string;
}

export const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Alex+Brush&family=Caveat:wght@500;600;700&family=JetBrains+Mono:wght@500;700&family=Orbitron:wght@600;800&family=Press+Start+2P&family=UnifrakturMaguntia&display=swap";

export const GLOBAL_FONTS: Record<string, GlobalFontDefinition> = {
    none: {
        id: "none",
        name: "Default (Discord)",
        description: "Discord standard native typography (gg sans)",
        fontFamily: "",
    },
    gothic: {
        id: "gothic",
        name: "Gothic (Unifraktur)",
        description: "Medieval gothic calligraphy font",
        fontFamily: "'UnifrakturMaguntia', 'MedievalSharp', cursive, serif",
        letterSpacing: "0.2px",
    },
    signature: {
        id: "signature",
        name: "Signature Script (Alex Brush)",
        description: "Elegant cursive calligraphy handwriting",
        fontFamily: "'Alex Brush', 'Great Vibes', cursive",
        letterSpacing: "0.4px",
    },
    pixel: {
        id: "pixel",
        name: "Pixel / Retro (Press Start 2P)",
        description: "8-bit retro arcade and gaming font",
        fontFamily: "'Press Start 2P', 'VT323', monospace",
        letterSpacing: "-0.5px",
    },
    nerd: {
        id: "nerd",
        name: "Nerd Font (JetBrains Mono)",
        description: "Clean monospace coding and terminal font",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    },
    cyberpunk: {
        id: "cyberpunk",
        name: "Cyberpunk (Orbitron)",
        description: "Futuristic geometric cyberpunk font",
        fontFamily: "'Orbitron', sans-serif",
        letterSpacing: "0.3px",
    },
    handwritten: {
        id: "handwritten",
        name: "Handwritten (Caveat)",
        description: "Natural artistic handwriting style",
        fontFamily: "'Caveat', cursive",
        letterSpacing: "0.2px",
    },
    custom: {
        id: "custom",
        name: "Custom Font",
        description: "Use any custom font installed on your computer",
        fontFamily: "",
    }
};

const LS_KEY = "nightcord_global_font_config";

export const DEFAULT_GLOBAL_FONT_CONFIG: GlobalFontConfig = {
    enabled: true,
    fontId: "none",
    customFamily: "",
    scale: 1.0,
};

let cachedConfig: GlobalFontConfig = DEFAULT_GLOBAL_FONT_CONFIG;

export function getGlobalFontConfig(): GlobalFontConfig {
    if (typeof localStorage === "undefined") return DEFAULT_GLOBAL_FONT_CONFIG;
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            cachedConfig = {
                enabled: parsed.enabled ?? true,
                fontId: parsed.fontId ?? "none",
                customFamily: parsed.customFamily ?? "",
                scale: typeof parsed.scale === "number" ? parsed.scale : 1.0,
            };
            return cachedConfig;
        }
    } catch {}
    return DEFAULT_GLOBAL_FONT_CONFIG;
}

export function ensureGoogleFontsLoaded() {
    if (typeof document === "undefined" || !document.head) return;
    if (document.getElementById("nightcord-google-fonts-sheet")) return;
    const link = document.createElement("link");
    link.id = "nightcord-google-fonts-sheet";
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    document.head.appendChild(link);
}

export function applyGlobalFont(config: GlobalFontConfig) {
    if (typeof document === "undefined") return;

    cachedConfig = { ...config };

    if (!document.documentElement || !document.head) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => applyGlobalFont(config), { once: true });
        }
        return;
    }

    const styleId = "nightcord-global-client-font";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!config.enabled || config.fontId === "none") {
        if (styleEl) {
            styleEl.remove();
        }
        document.documentElement?.style?.removeProperty?.("--nc-global-font-scale");
        return;
    }

    ensureGoogleFontsLoaded();

    let family = "";
    let letterSpacing = "";

    if (config.fontId === "custom") {
        family = config.customFamily.trim() || "";
    } else {
        const def = GLOBAL_FONTS[config.fontId];
        if (def) {
            family = def.fontFamily;
            letterSpacing = def.letterSpacing || "";
        }
    }

    if (!family) {
        if (styleEl) styleEl.remove();
        return;
    }

    if (!styleEl) {
        styleEl = document.createElement("style");
        styleId && (styleEl.id = styleId);
        document.head.appendChild(styleEl);
    }

    const scale = config.scale || 1.0;
    const fontCodeFamily = (config.fontId === "nerd" || config.fontId === "pixel")
        ? family
        : `'JetBrains Mono', 'Fira Code', ${family}, monospace`;

    const cssRules = `
:root {
    --font-primary: ${family} !important;
    --font-display: ${family} !important;
    --font-headline: ${family} !important;
    --font-code: ${fontCodeFamily} !important;
    --font-korean: ${family} !important;
    --font-japanese: ${family} !important;
    --font-chinese-simplified: ${family} !important;
    --font-chinese-traditional: ${family} !important;
}

html,
body,
#app-mount,
#app-mount *:not(svg):not(path):not(use):not(foreignObject):not(img):not(i):not([class*='icon']):not([class*='Icon']) {
    font-family: ${family} !important;
    ${letterSpacing ? `letter-spacing: ${letterSpacing} !important;` : ""}
}

/* Allow scalable client font sizing when customized */
${scale !== 1.0 ? `
:root {
    --nc-global-font-scale: ${scale};
}
` : ""}
`;

    styleEl.textContent = cssRules;
}

export function setGlobalFontConfig(next: Partial<GlobalFontConfig>): GlobalFontConfig {
    const current = getGlobalFontConfig();
    const updated: GlobalFontConfig = { ...current, ...next };
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(updated));
    } catch {}
    applyGlobalFont(updated);
    return updated;
}

export function initGlobalFont() {
    const config = getGlobalFontConfig();
    applyGlobalFont(config);
}
