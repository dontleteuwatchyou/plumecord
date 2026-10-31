#!/usr/bin/node
/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// @ts-check

import { readFileSync } from "fs";
import ts from "typescript";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import path, { join } from "path";
import Zip from "zip-local";

import { BUILD_TIMESTAMP, commonOpts, globPlugins, IS_DEV, IS_REPORTER, IS_COMPANION_TEST, VERSION, commonRendererPlugins, buildOrWatchAll, stringifyValues, IS_ANTI_CRASH_TEST } from "./common.mjs";

/**
 * Combined esbuild plugin that replaces several heavy data-only modules with
 * tiny stubs for the Firefox / Chromium extension build.
 *
 * Modules stubbed and why:
 *  - autoTranslateNightcord (~1.9 MB)  – huge translation table; extension
 *    users already have the browser's own language, so we just echo the key.
 *  - nightcordNews/icon.ts (~256 KB)   – base64-encoded SVG; a simple inline
 *    SVG or empty string is fine in extension context.
 *  - sekaiStickers/characters.json.ts (~110 KB) – sticker character list.
 *    Replaced with an empty array; the plugin gracefully handles no data.
 *
 * @type {import("esbuild").Plugin}
 */
const extensionStubPlugin = {
    name: "extension-heavy-module-stubs",
    setup(build) {
        // Plume : traductions gardées (Nightcord en français comme l’appli).

        // ── nightcordNews/icon.ts ───────────────────────────────────────────
        // The import is `from "../icon"` so args.path = "../icon" — we must
        // also check args.importer to confirm it's coming from nightcordNews.
        build.onResolve({ filter: /icon/ }, args => {
            if (/nightcordNews/.test(args.importer) && /[/\\]?icon$/.test(args.path)) {
                return { path: args.path, namespace: "ext-stub-ncNewsIcon" };
            }
        });
        build.onLoad({ filter: /.*/, namespace: "ext-stub-ncNewsIcon" }, () => ({
            loader: "js",
            // Empty string — NightcordNewsButton falls back gracefully
            contents: `export const newsIconBase64 = "";`
        }));


        // ── sekaiStickers/characters.json.ts ───────────────────────────────
        build.onResolve({ filter: /sekaiStickers[/\\]characters/ }, args => ({
            path: args.path,
            namespace: "ext-stub-sekaiChars"
        }));
        build.onLoad({ filter: /.*/, namespace: "ext-stub-sekaiChars" }, () => ({
            loader: "js",
            contents: `export const characters = [];`
        }));

        // ── src/api/pluginI18n.ts (~1.1 MB i18n table) ────────────────────
        // This is a massive serialised i18n data blob.  In the extension build
        // we stub it with an empty object so the PluginI18n API still exists
        // but no pre-bundled translations are shipped.
        build.onResolve({ filter: /api[/\\]pluginI18n/ }, args => ({
            path: args.path,
            namespace: "ext-stub-pluginI18n"
        }));
        build.onLoad({ filter: /.*/, namespace: "ext-stub-pluginI18n" }, () => ({
            loader: "js",
            contents: `export function tPlugin(key) { return key; }`
        }));

        // ── src/api/illegalcord_base64.ts (~135 KB base64 image) ──────────
        build.onResolve({ filter: /illegalcord_base64/ }, args => ({
            path: args.path,
            namespace: "ext-stub-illegalB64"
        }));
        build.onLoad({ filter: /.*/, namespace: "ext-stub-illegalB64" }, () => ({
            loader: "js",
            contents: `export const ILLEGALCORD_ICON_DATA_URI = "";`
        }));

    }
};



/**
 * @type {import("esbuild").BuildOptions}
 */
// Plumecord : le nom affiché remplace celui de Nightcord partout à l'écran
// (textes, traductions, titres), sans toucher au source. Seul le mot entier
// « Nightcord » dans les chaînes et le texte JSX change : les noms de code
// (NightcordHelper, autoTranslateNightcord…), les adresses (nightcord.st) et
// les clés en minuscules restent tels quels. Clés et textes de traduction
// passent par la même règle, donc les traductions se retrouvent toujours.
const BRAND = /\bNightcord\b/g;
// Les morceaux de texte d'un fichier, tels que TypeScript les voit : chaînes,
// gabarits (hors ${…}) et texte JSX. Jamais les identifiants ni les commentaires.
const TEXT_KINDS = new Set([
    ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.JsxText,
]);
function brand(path, src) {
    const file = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, false, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const spans = [];
    (function walk(node) {
        if (TEXT_KINDS.has(node.kind)) {
            const start = node.getStart(file), end = node.getEnd();
            if (src.slice(start, end).includes("Nightcord")) spans.push([start, end]);
        }
        ts.forEachChild(node, walk);
    })(file);
    let out = "", last = 0;
    for (const [start, end] of spans) {
        out += src.slice(last, start) + src.slice(start, end).replace(BRAND, "Plumecord");
        last = end;
    }
    return out + src.slice(last);
}

/** @type {import("esbuild").Plugin} */
const brandPlugin = {
    name: "plumecord-brand",
    setup(build) {
        build.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, async ({ path }) => {
            const src = await readFile(path, "utf-8");
            if (!src.includes("Nightcord")) return;
            return { contents: brand(path, src), loader: path.endsWith("x") ? "tsx" : "ts" };
        });
    }
};

const commonOptions = {
    ...commonOpts,
    entryPoints: ["browser/Vencord.ts"],
    format: "iife",
    globalName: "Vencord",
    external: ["~plugins", "~git-hash", "/assets/*"],
    target: ["esnext"],
    plugins: [
        brandPlugin,
        globPlugins("web"),
        ...commonRendererPlugins
    ],
    define: stringifyValues({
        IS_WEB: true,
        IS_EXTENSION: false,
        IS_USERSCRIPT: false,
        IS_STANDALONE: true,
        IS_DEV,
        IS_REPORTER,
        IS_COMPANION_TEST,
        IS_ANTI_CRASH_TEST,
        IS_DISCORD_DESKTOP: false,
        IS_VESKTOP: false,
        IS_EQUIBOP: false,
        IS_UPDATER_DISABLED: true,
        VERSION,
        BUILD_TIMESTAMP
    })
};

const MonacoWorkerEntryPoints = [
    "vs/language/css/css.worker.js",
    "vs/editor/editor.worker.js"
];

/** @type {import("esbuild").BuildOptions[]} */
const buildConfigs = [
    {
        entryPoints: MonacoWorkerEntryPoints.map(entry => `node_modules/monaco-editor/esm/${entry}`),
        bundle: true,
        minify: true,
        format: "iife",
        outbase: "node_modules/monaco-editor/esm/",
        outdir: "dist/browser/vendor/monaco"
    },
    {
        entryPoints: ["browser/monaco.ts"],
        bundle: true,
        minify: true,
        format: "iife",
        outfile: "dist/browser/vendor/monaco/index.js",
        loader: {
            ".ttf": "file"
        }
    },
    {
        ...commonOptions,
        outfile: "dist/browser/browser.js",
        footer: { js: "//# sourceURL=file:///VencordWeb" }
    },
    {
        ...commonOptions,
        outfile: "dist/browser/extension.js",
        minify: true,
        plugins: [
            brandPlugin,
            extensionStubPlugin,
            globPlugins("web"),
            ...commonRendererPlugins
        ],
        define: {
            ...commonOptions.define,
            IS_EXTENSION: "true"
        },
        footer: { js: "//# sourceURL=file:///VencordWeb" }
    },
    {
        ...commonOptions,
        inject: ["browser/GMPolyfill.js", ...(commonOptions?.inject || [])],
        define: {
            ...commonOptions.define,
            IS_USERSCRIPT: "true",
            window: "unsafeWindow",
        },
        outfile: "dist/Equicord.user.js",
        banner: {
            js: readFileSync("browser/userscript.meta.js", "utf-8").replace("%version%", `${VERSION}.${new Date().getTime()}`)
        },
        footer: {
            // UserScripts get wrapped in an iife, so define Vencord prop on window that returns our local
            js: "Object.defineProperty(unsafeWindow,'Vencord',{get:()=>Vencord});"
        }
    }
];

await buildOrWatchAll(buildConfigs);

/**
 * @type {(dir: string) => Promise<string[]>}
 */
async function globDir(dir) {
    const files = [];

    for (const child of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, child.name);
        if (child.isDirectory())
            files.push(...await globDir(p));
        else
            files.push(p);
    }

    return files;
}

/**
 * @type {(dir: string, basePath?: string) => Promise<Record<string, string>>}
 */
async function loadDir(dir, basePath = "") {
    const files = await globDir(dir);
    return Object.fromEntries(
        await Promise.all(
            files.map(
                async f =>
                    [f.slice(basePath.length), await readFile(f)]
            )
        )
    );
}

/**
  * @type {(target: string, files: string[], includeMonaco?: boolean) => Promise<void>}
 */
async function buildExtension(target, files, includeMonaco = true) {
    const monacoEntries = includeMonaco
        ? await loadDir("dist/browser/vendor/monaco", "dist/browser/")
        : {};

    const entries = {
        "dist/Equicord.js": await readFile("dist/browser/extension.js"),
        "dist/Equicord.css": await readFile("dist/browser/extension.css"),
        ...monacoEntries,
        ...Object.fromEntries(await Promise.all(files.map(async f => {
            let content = await readFile(join("browser", f));
            if (f.startsWith("manifest")) {
                const json = JSON.parse(content.toString("utf-8"));
                json.version = VERSION;
                content = Buffer.from(new TextEncoder().encode(JSON.stringify(json)));
            }

            return [
                f.startsWith("manifest") ? "manifest.json" : f,
                content
            ];
        })))
    };

    await rm(join("dist/browser", target), { recursive: true, force: true });
    await Promise.all(Object.entries(entries).map(async ([file, content]) => {
        const dest = join("dist/browser", target, file);
        const parentDirectory = join(dest, "..");
        await mkdir(parentDirectory, { recursive: true });
        await writeFile(dest, content);
    }));

    console.info("Unpacked Extension written to dist/browser/" + target);
}

const appendCssRuntime = readFile("dist/Equicord.user.css", "utf-8").then(content => {
    const cssRuntime = `unsafeWindow._vcUserScriptRendererCss=\`${content.replaceAll("`", "\\`")}\``;

    return appendFile("dist/Equicord.user.js", cssRuntime);
});

if (!process.argv.includes("--skip-extension")) {
    await Promise.all([
        appendCssRuntime,
        buildExtension("chromium-unpacked", ["modifyResponseHeaders.json", "content.js", "manifest.json", "icon.png"], true),
        buildExtension("firefox-unpacked", ["background.js", "content.js", "manifestv2.json", "icon.png"], false),
    ]);

    Zip.zip("dist/browser/chromium-unpacked", (_err, zip) => {
        zip.compress().save("dist/extension-chrome.zip");
        console.info("Packed Chromium Extension written to dist/extension-chrome.zip");
    });
    Zip.zip("dist/browser/firefox-unpacked", (_err, zip) => {
        zip.compress().save("dist/extension-firefox.zip");
        console.info("Packed Firefox Extension written to dist/extension-firefox.zip");
    });
} else {
    await appendCssRuntime;
}
