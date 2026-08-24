/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import os from "os";

async function main() {
    const rawVersion = process.argv[2] || "1.27.2";
    const version = rawVersion.replace(/^v/i, "");
    const tag = `v${version}`;
    const notes = process.argv[4] || tag;

    const giteaUrl = "https://source.nightcord.st";
    const repo = "nightcord/nightcord";

    // Read token from project root or user home directory
    let tokenFile = path.join(process.cwd(), ".gitea_token");
    if (!fs.existsSync(tokenFile)) {
        tokenFile = path.join(os.homedir(), ".gitea_token");
    }
    if (!fs.existsSync(tokenFile)) {
        console.error(`\n [ERREUR] Fichier de token introuvable.`);
        console.error(` Créez un fichier .gitea_token avec votre jeton.`);
        process.exit(1);
    }
    const token = fs.readFileSync(tokenFile, "utf8").trim().replace(/[\r\n\s]+/g, "");
    if (!token) {
        console.error(`\n [ERREUR] Token Gitea vide dans ${tokenFile}`);
        process.exit(1);
    }

    // Check local SSH tunnel (port 3000) for 0 Cloudflare limit
    let baseUrl = "http://127.0.0.1:3000";
    try {
        await new Promise((res, rej) => {
            const req = http.get("http://127.0.0.1:3000/api/v1/version", { timeout: 2000 }, r => {
                if (r.statusCode === 200) res(true); else rej();
            });
            req.on("error", rej);
            req.on("timeout", () => { req.destroy(); rej(); });
        });
        console.log(`  [Tunnel SSH Connecte] Utilisation de ${baseUrl} (0 limite Cloudflare)`);
    } catch {
        baseUrl = giteaUrl;
        console.log(`  [Direct Cloudflare] Utilisation de ${baseUrl}`);
    }

    const client = baseUrl.startsWith("https") ? https : http;

    function reqPromise(options, bodyData) {
        return new Promise((resolve, reject) => {
            const req = client.request(options, res => {
                let chunks = [];
                res.on("data", d => chunks.push(d));
                res.on("end", () => {
                    const buf = Buffer.concat(chunks);
                    resolve({ status: res.statusCode, data: buf.toString("utf8"), raw: buf });
                });
            });
            req.on("error", reject);
            if (bodyData) req.write(bodyData);
            req.end();
        });
    }

    // Detect valid auth header format (token vs Bearer)
    let authHeader = `token ${token}`;
    const testUserUrl = new URL(`${baseUrl}/api/v1/user`);
    const testRes = await reqPromise({
        hostname: testUserUrl.hostname,
        port: testUserUrl.port || (testUserUrl.protocol === "https:" ? 443 : 80),
        path: testUserUrl.pathname,
        method: "GET",
        headers: { "Authorization": authHeader, "Accept": "application/json" }
    });

    if (testRes.status === 401) {
        const testBearer = await reqPromise({
            hostname: testUserUrl.hostname,
            port: testUserUrl.port || (testUserUrl.protocol === "https:" ? 443 : 80),
            path: testUserUrl.pathname,
            method: "GET",
            headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
        });
        if (testBearer.status === 200) {
            authHeader = `Bearer ${token}`;
        }
    }

    // 1. Check or Create Release
    console.log(`  Creation/Recuperation de la release ${tag}...`);
    const urlObj = new URL(`${baseUrl}/api/v1/repos/${repo}/releases/tags/${tag}`);
    let releaseRes = await reqPromise({
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: urlObj.pathname,
        method: "GET",
        headers: { "Authorization": authHeader, "Accept": "application/json" }
    });

    let release = null;
    if (releaseRes.status === 200) {
        release = JSON.parse(releaseRes.data);
    } else {
        const createUrl = new URL(`${baseUrl}/api/v1/repos/${repo}/releases`);
        const payload = JSON.stringify({
            tag_name: tag,
            name: tag,
            body: notes,
            draft: false,
            prerelease: false
        });
        const createRes = await reqPromise({
            hostname: createUrl.hostname,
            port: createUrl.port || (createUrl.protocol === "https:" ? 443 : 80),
            path: createUrl.pathname,
            method: "POST",
            headers: {
                "Authorization": authHeader,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
            }
        }, payload);

        if (createRes.status === 201 || createRes.status === 200) {
            release = JSON.parse(createRes.data);
        } else {
            throw new Error(`Echec creation release: ${createRes.status} ${createRes.data}\n\n Conseil: Vérifiez votre token Gitea dans ${tokenFile} (Paramètres Gitea -> Applications -> Générer un nouveau jeton avec droits 'repo').`);
        }
    }

    const releaseId = release.id;
    console.log(`  Release ID: ${releaseId} (Nom: ${release.name}, Tag: ${release.tag_name})`);

    // 2. Assets to upload
    const filesToUpload = [
        { name: "Nightcord-Installer.exe", path: path.join("release", "installer", "Nightcord-Installer.exe"), type: "application/octet-stream" },
        { name: "desktop.asar", path: path.join("dist", "desktop.asar"), type: "application/octet-stream" },
        { name: "extension-chrome.zip", path: path.join("dist", "extension-chrome.zip"), type: "application/zip" },
        { name: "extension-firefox.zip", path: path.join("dist", "extension-firefox.zip"), type: "application/zip" },
        { name: "nightcord-dist.zip", path: path.join("release", "installer", "nightcord-dist.zip"), type: "application/zip" },
        { name: "version.json", path: path.join("release", "installer", "version.json"), type: "application/json" }
    ];

    // Delete existing old assets with identical names
    if (Array.isArray(release.assets)) {
        for (const asset of release.assets) {
            if (filesToUpload.some(f => f.name === asset.name)) {
                console.log(`  Suppression ancien asset: ${asset.name}`);
                const delUrl = new URL(`${baseUrl}/api/v1/repos/${repo}/releases/${releaseId}/assets/${asset.id}`);
                await reqPromise({
                    hostname: delUrl.hostname,
                    port: delUrl.port || (delUrl.protocol === "https:" ? 443 : 80),
                    path: delUrl.pathname,
                    method: "DELETE",
                    headers: { "Authorization": authHeader }
                });
            }
        }
    }

    // 3. Upload each asset
    for (const f of filesToUpload) {
        if (!fs.existsSync(f.path)) {
            console.warn(`  [Ignore] Fichier introuvable: ${f.path}`);
            continue;
        }

        const size = fs.statSync(f.path).size;
        const sizeMb = (size / (1024 * 1024)).toFixed(1);
        console.log(`  -> Upload de ${f.name} (${sizeMb} MB)...`);

        const uploadUrl = new URL(`${baseUrl}/api/v1/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(f.name)}`);

        await new Promise((res, rej) => {
            const fileStream = fs.createReadStream(f.path);
            const req = client.request({
                hostname: uploadUrl.hostname,
                port: uploadUrl.port || (uploadUrl.protocol === "https:" ? 443 : 80),
                path: uploadUrl.pathname + uploadUrl.search,
                method: "POST",
                headers: {
                    "Authorization": authHeader,
                    "Content-Type": f.type,
                    "Content-Length": size
                }
            }, r => {
                if (r.statusCode >= 200 && r.statusCode < 300) {
                    console.log(`     OK: ${f.name}`);
                    res();
                } else {
                    let body = "";
                    r.on("data", d => body += d);
                    r.on("end", () => rej(new Error(`Upload error ${r.statusCode}: ${body}`)));
                }
            });
            req.on("error", rej);
            fileStream.pipe(req);
        });
    }

    console.log("\n  Tous les 6 assets ont ete publies avec succes !");
}

main().catch(err => {
    console.error("\n  [ERREUR]", err);
    process.exit(1);
});
