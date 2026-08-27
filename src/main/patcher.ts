/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { onceDefined } from "@shared/onceDefined";
import electron, { app, BrowserWindowConstructorOptions, Menu, session } from "electron";
import { existsSync as fsExistsSync, statSync as fsStatSync } from "original-fs";
import { dirname, join } from "path";

import { registerMediaPermissionsForSession } from "../nightcord/main/mediaPermissions";
import { makeLinksOpenExternally } from "../nightcord/main/utils/makeLinksOpenExternally";
import { RendererSettings } from "./settings";
import { patchTrayMenu } from "./trayMenu";
import { applyPendingUpdateOnStartup } from "./updater/pendingUpdate";
import { IS_VANILLA } from "./utils/constants";

// Apply any staged updates before loading components
applyPendingUpdateOnStartup();

console.log("[Nightcord] Starting up...");

// Our injector file at app/index.js
const injectorPath = require.main!.filename;

// The original app.asar
const _asarFromInjector = join(dirname(injectorPath), "..", "app.asar");
const _backupAsarFromInjector = join(dirname(injectorPath), "..", "_app.asar");
const _asarFromResources = join(process.resourcesPath, "app.asar");
const _backupAsarFromResources = join(process.resourcesPath, "_app.asar");

const asarPath = (fsExistsSync(_asarFromInjector) && !fsStatSync(_asarFromInjector).isDirectory())
    ? _asarFromInjector
    : (fsExistsSync(_asarFromResources) && !fsStatSync(_asarFromResources).isDirectory())
        ? _asarFromResources
        : (fsExistsSync(_backupAsarFromInjector) && !fsStatSync(_backupAsarFromInjector).isDirectory())
            ? _backupAsarFromInjector
            : _backupAsarFromResources;

const discordPkg = require(join(asarPath, "package.json"));
require.main!.filename = join(asarPath, discordPkg.main);
if (IS_VESKTOP || IS_EQUIBOP) require.main!.filename = join(dirname(injectorPath), "..", "..", "package.json");

// @ts-expect-error Untyped method
app.setAppPath(asarPath);

if (!IS_VANILLA) {
    const settings = RendererSettings.store;

    patchTrayMenu();

    // Repatch after host updates on Windows
    if (process.platform === "win32") {
        require("./patchWin32Updater");

        if (settings.winCtrlQ) {
            const originalBuild = Menu.buildFromTemplate;
            Menu.buildFromTemplate = function (template) {
                if (template[0]?.label === "&File") {
                    const { submenu } = template[0];
                    if (Array.isArray(submenu)) {
                        submenu.push({
                            label: "Quit (Hidden)",
                            visible: false,
                            acceleratorWorksWhenHidden: true,
                            accelerator: "Control+Q",
                            click: () => app.quit()
                        });
                    }
                }
                return originalBuild.call(this, template);
            };
        }
    }

    class BrowserWindow extends electron.BrowserWindow {
        constructor(options: BrowserWindowConstructorOptions) {
            const titleLower = (options?.title ?? "").toLowerCase();
            const preloadLower = (options?.webPreferences?.preload ?? "").toLowerCase();
            const isOverlay = titleLower.includes("overlay") || preloadLower.includes("overlay") || (options as any)?.isOverlay;

            if (isOverlay) {
                options.transparent = true;
                options.backgroundColor = "#00000000";
                options.hasShadow = false;
                options.frame = false;
                super(options);
                try {
                    this.setBackgroundColor("#00000000");
                } catch {}
                return;
            }

            if (!options?.webPreferences?.preload || !options.title) {
                super(options);
                return;
            }

            const original = options.webPreferences.preload;
            const isMainWindow = options.title === "Discord";
            options.webPreferences.preload = join(__dirname, "preload.js");
            options.webPreferences.sandbox = false;
            options.webPreferences.backgroundThrottling = false;
            options.webPreferences.webviewTag = true;

            let ses = options.webPreferences.session;
            if (!ses && options.webPreferences.partition) {
                ses = electron.session.fromPartition(options.webPreferences.partition);
            }
            ses ??= electron.session.defaultSession;
            registerMediaPermissionsForSession(ses);

            if (settings.frameless) {
                options.frame = false;
            } else if (settings.mainWindowFrameless && isMainWindow) {
                options.frame = false;
            } else if (process.platform === "win32" && settings.winNativeTitleBar) {
                delete options.frame;
            }

            if (settings.transparent) {
                options.transparent = true;
                options.backgroundColor = "#00000000";
            }

            // Windows 11 acrylic/mica effect
            const winMaterial = settings.windowMaterial as string | undefined;
            if (process.platform === "win32" && winMaterial && winMaterial !== "none") {
                options.transparent = true;
                options.backgroundColor = "#00000000";
            }

            if (settings.disableMinSize) {
                options.minWidth = 0;
                options.minHeight = 0;
            }

            const needsVibrancy = process.platform === "darwin" && settings.macosVibrancyStyle;

            if (needsVibrancy) {
                options.backgroundColor = "#00000000";
                if (settings.macosVibrancyStyle) {
                    options.vibrancy = settings.macosVibrancyStyle;
                }
            }

            options.fullscreenable = true;

            const safeOriginalPreload = (function resolveDiscordPreload(p: string): string {
                if (!p) return "";
                const lower = p.toLowerCase();
                const isMod = lower.includes("vencord") || lower.includes("equicord") || lower.includes("betterdiscord") || (lower.includes("nightcord") && lower.includes("dist"));
                if (isMod) {
                    const candidates = [
                        join(asarPath, "app_bootstrap", "preload.js"),
                        join(asarPath, "dist", "preload.js"),
                        join(asarPath, "preload.js"),
                        join(asarPath, "..", "..", "modules", "discord_desktop_core", "discord_desktop_core", "core.asar", "app", "mainScreenPreload.js"),
                        join(dirname(asarPath), "_app.asar", "app_bootstrap", "preload.js"),
                        join(dirname(asarPath), "app.asar", "app_bootstrap", "preload.js")
                    ];
                    for (const cand of candidates) {
                        try {
                            if (fsExistsSync(cand) && !fsStatSync(cand).isDirectory()) {
                                return cand;
                            }
                        } catch {}
                    }
                    return "";
                }
                return p;
            })(original);

            process.env.DISCORD_PRELOAD = safeOriginalPreload;

            super(options);

            if (isMainWindow) {
                makeLinksOpenExternally(this);
            }

            if (settings.streamProof) {
                try {
                    this.setContentProtection(true);
                } catch (e) {
                    console.error("Failed to set content protection on startup:", e);
                }
            }

            const isTransparent = !!options.transparent;
            let isFakeFullScreen = false;
            let originalBounds: electron.Rectangle | null = null;
            let isMaximizedBefore = false;
            let transitioning = false;

            const superSetFullScreen = this.setFullScreen.bind(this);
            const superIsFullScreen = this.isFullScreen.bind(this);

            this.setFullScreen = (flag: boolean) => {
                if (transitioning) return;
                transitioning = true;
                try {
                    if (isTransparent) {
                        if (flag) {
                            if (isFakeFullScreen) return;
                            isFakeFullScreen = true;
                            originalBounds = this.getBounds();
                            isMaximizedBefore = this.isMaximized();
                            const display = electron.screen.getDisplayMatching(originalBounds).bounds;
                            this.setResizable(false);
                            this.setBounds(display);
                            this.setAlwaysOnTop(true, "screen-saver");
                            this.emit("enter-full-screen");
                        } else {
                            if (!isFakeFullScreen) return;
                            isFakeFullScreen = false;
                            this.setAlwaysOnTop(false);
                            this.setResizable(true);
                            if (isMaximizedBefore) {
                                this.maximize();
                            } else if (originalBounds) {
                                this.setBounds(originalBounds);
                            }
                            this.emit("leave-full-screen");
                        }
                    } else {
                        superSetFullScreen(flag);
                    }
                } finally {
                    transitioning = false;
                }
            };

            this.isFullScreen = () => {
                if (isTransparent) return isFakeFullScreen;
                return superIsFullScreen();
            };

            if (isTransparent) {
                this.on("enter-html-full-screen", () => {
                    if (!isFakeFullScreen) this.setFullScreen(true);
                });
                this.on("leave-html-full-screen", () => {
                    if (isFakeFullScreen) this.setFullScreen(false);
                });
            } else {
                this.on("enter-html-full-screen", () => {
                    if (!superIsFullScreen()) superSetFullScreen(true);
                });
                this.on("leave-html-full-screen", () => {
                    if (superIsFullScreen()) superSetFullScreen(false);
                });
            }

            this.webContents.on("before-input-event", (event, input) => {
                if (input.type === "keyDown" && input.key === "F11" && !input.control && !input.shift && !input.alt && !input.meta) {
                    event.preventDefault();
                    this.setFullScreen(!this.isFullScreen());
                }
            });

            if (process.platform === "win32" && winMaterial && winMaterial !== "none") {
                try {
                    let applied = false;
                    if (typeof this.setBackgroundMaterial === "function") {
                        this.setBackgroundMaterial(winMaterial);
                        applied = true;
                    }
                    if (!applied && typeof this.setVibrancy === "function") {
                        this.setVibrancy(winMaterial === "acrylic" ? "acrylic" : "under-window");
                        applied = true;
                    }
                } catch (e) {
                    console.error("[Nightcord] setBackgroundMaterial failed:", e);
                }
            }

            if (settings.disableMinSize) {
                this.setMinimumSize = (_width: number, _height: number) => { };
            }
        }
    }
    Object.assign(BrowserWindow, electron.BrowserWindow);
    Object.defineProperty(BrowserWindow, "name", { value: "BrowserWindow", configurable: true });

    const electronPath = require.resolve("electron");
    delete require.cache[electronPath]!.exports;
    require.cache[electronPath]!.exports = {
        ...electron,
        BrowserWindow
    };

    onceDefined(global, "appSettings", s => {
        s.set("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING", true);
    });

    process.env.DATA_DIR = join(app.getPath("userData"), "..", "Nightcord");

    app.whenReady().then(() => {
        registerMediaPermissionsForSession(session.defaultSession);
    });

    // ── Neutralisation de DISCORD_WINDOW_TOGGLE_FULLSCREEN ──
    {
        const _originalHandle = electron.ipcMain.handle.bind(electron.ipcMain);
        const FULLSCREEN_CHANNEL = "DISCORD_WINDOW_TOGGLE_FULLSCREEN";
        let _fullscreenPatched = false;

        (electron.ipcMain as any).handle = function(channel: string, listener: any) {
            if (channel === FULLSCREEN_CHANNEL) {
                if (_fullscreenPatched) return;
                _fullscreenPatched = true;
                try { electron.ipcMain.removeHandler(FULLSCREEN_CHANNEL); } catch {}
                _originalHandle(FULLSCREEN_CHANNEL, (_event: electron.IpcMainInvokeEvent) => {
                    // Intentionnellement vide.
                });
                return;
            }
            try {
                electron.ipcMain.removeHandler(channel);
            } catch {}
            try {
                return _originalHandle(channel, listener);
            } catch (e: any) {
                if (e?.message?.includes?.("Attempted to register a second handler")) {
                    console.warn(`[Nightcord] Ignored duplicate IPC handler for '${channel}'`);
                    return;
                }
                throw e;
            }
        };
    }

    // Optimization switches identical to Equicord:
    // Disables EcoQoS / background throttling to eliminate CPU starvation, stutter & game FPS drops
    const originalAppend = app.commandLine.appendSwitch;
    const _ncDisabledFeatures = new Set(["WidgetLayering", "UseEcoQoSForBackgroundProcess", "CalculateNativeWinOcclusion"]);
    app.commandLine.appendSwitch = function (...args) {
        if (args[0] === "process-per-site") return;
        if (args[0] === "disable-features") {
            (args[1] ?? "").split(",").filter(Boolean).forEach((f: string) => _ncDisabledFeatures.add(f));
            args[1] = [..._ncDisabledFeatures].join(",");
        }
        return originalAppend.apply(this, args);
    };

    app.commandLine.appendSwitch("disable-renderer-backgrounding");
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
} else {
    console.log("[Nightcord] Running in vanilla mode. Not loading Nightcord");
}

console.log("[Nightcord] Loading original Discord app.asar");
require(require.main!.filename);
