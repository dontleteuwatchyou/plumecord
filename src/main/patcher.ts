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

// Our injector file inside app.asar / app/index.js
const injectorPath = require.main!.filename;

// The original app.asar (discord_app.asar is immune to Squirrel cleaner, _app.asar fallback)
const _primaryAsar = join(dirname(injectorPath), "..", "discord_app.asar");
const _secondaryAsar = join(dirname(injectorPath), "..", "_app.asar");
const _resourcesPrimary = join(process.resourcesPath, "discord_app.asar");
const _resourcesSecondary = join(process.resourcesPath, "_app.asar");

const asarPath = (fsExistsSync(_primaryAsar) && !fsStatSync(_primaryAsar).isDirectory())
    ? _primaryAsar
    : (fsExistsSync(_secondaryAsar) && !fsStatSync(_secondaryAsar).isDirectory())
        ? _secondaryAsar
        : (fsExistsSync(_resourcesPrimary) && !fsStatSync(_resourcesPrimary).isDirectory())
            ? _resourcesPrimary
            : _resourcesSecondary;

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
            if (!options?.webPreferences?.preload || !options.title) {
                super(options);
                return;
            }

            const original = options.webPreferences.preload;
            const isMainWindow = options.title === "Discord";
            options.webPreferences.preload = join(__dirname, "preload.js");
            options.webPreferences.sandbox = false;
            options.webPreferences.backgroundThrottling = false;

            let ses = options.webPreferences.session;
            if (!ses && options.webPreferences.partition) {
                ses = electron.session.fromPartition(options.webPreferences.partition);
            }
            ses ??= electron.session.defaultSession;
            registerMediaPermissionsForSession(ses);

            if (settings.mainWindowFrameless && isMainWindow) {
                options.frame = false;
            } else if (settings.frameless) {
                options.frame = false;
            } else if (process.platform === "win32" && settings.winNativeTitleBar) {
                delete options.frame;
            }

            if (settings.disableMinSize) {
                options.minWidth = 0;
                options.minHeight = 0;
            }

            if (settings.transparent) {
                options.transparent = true;
                options.backgroundColor = "#00000000";
            }
            if (process.platform === "darwin" && settings.macosVibrancyStyle) {
                options.vibrancy = settings.macosVibrancyStyle;
                options.backgroundColor = "#00000000";
            }
            if (process.platform === "win32" && settings.windowMaterial && settings.windowMaterial !== "none") {
                options.backgroundMaterial = settings.windowMaterial as any;
                options.backgroundColor = "#00000000";
            }

            process.env.DISCORD_PRELOAD = original;

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

    const originalAppend = app.commandLine.appendSwitch;
    app.commandLine.appendSwitch = function (...args) {
        if (args[0] === "disable-features") {
            const disabledFeatures = new Set((args[1] ?? "").split(","));
            disabledFeatures.add("UseEcoQoSForBackgroundProcess");
            args[1] += [...disabledFeatures].join(",");
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
