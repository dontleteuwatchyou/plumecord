/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * ghost-server.js — Nightcord Ghost Client
 * Architecture "always-on" + optimisé performance :
 *   - Cache ffmpeg/device au démarrage (plus de execSync pendant l'audio)
 *   - Buffer pré-alloué (plus de Buffer.concat à chaque frame)
 *   - Priorité process élevée (ABOVE_NORMAL)
 *
 * FIX streaming infini :
 *   - /stream-start répond IMMÉDIATEMENT (202) puis résout en arrière-plan
 *   - /stream-status permet à l'UI de poller l'état de la résolution
 *   - Plus de blocage HTTP pendant yt-dlp (30s) ou le démarrage ffmpeg
 */

import http from "http";
import https from "https";
import WebSocket from "ws";
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;
import { Client } from "discord.js-selfbot-v13";
import { spawn, spawnSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const PORT = 47821;

let DVS = null;
let OpusScript = null;

let _ffmpegCache = null;
let _ytdlpCache = null;
let _dshowDevicesCache = null;

let _fluentFfmpeg = null;

import("@dank074/discord-video-stream").then(m => {
    DVS = m;
    console.log("[GhostServer] DVS OK");
    // Pré-charger fluent-ffmpeg dès que DVS est prêt — évite le dynamic import au moment du stream
    import("fluent-ffmpeg").then(m2 => {
        _fluentFfmpeg = m2.default ?? m2;
        console.log("[GhostServer] fluent-ffmpeg pré-chargé OK");
    }).catch(() => { });
}).catch(e => console.error("[GhostServer] DVS introuvable: " + e.message));

try { OpusScript = require("opusscript"); console.log("[GhostServer] opusscript OK"); }
catch (e) { console.error("[GhostServer] opusscript introuvable: " + e.message); }

try {
    // Utilise os.setPriority (natif Node.js) au lieu de wmic (obsolète/lent)
    os.setPriority(process.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    console.log("[GhostServer] Priorité processeur augmentée ✓");
} catch (e) {
    console.warn("[GhostServer] Impossible de régler la priorité process:", e.message);
}

function findFfmpeg() {
    if (_ffmpegCache !== null) return _ffmpegCache;
    const candidates = [
        path.join(__dirname, "..", "..", "ffmpeg.exe"), // Racine (production)
        path.join(__dirname, "..", "ffmpeg.exe"),        // Resources (dev/dist)
        path.join(__dirname, "ffmpeg.exe")              // Local
    ];
    for (const c of candidates) { if (fs.existsSync(c)) { _ffmpegCache = c; return c; } }
    try { let p = require("ffmpeg-static"); p = p?.default ?? p; if (p && fs.existsSync(p)) { _ffmpegCache = p; return p; } } catch { }
    for (const c of ["ffmpeg", "C:\\ffmpeg\\bin\\ffmpeg.exe"]) {
        try { execSync('"' + c + '" -version', { stdio: "ignore", timeout: 2000 }); _ffmpegCache = c; return c; } catch { }
    }
    _ffmpegCache = null;
    return null;
}

function listDshowDevices(ffmpeg) {
    if (_dshowDevicesCache !== null) return _dshowDevicesCache;
    const res = spawnSync(ffmpeg, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"],
        { timeout: 5000, encoding: "buffer" });
    let text = [res.stderr, res.stdout].map(b => (b || Buffer.alloc(0)).toString("utf8")).join("\n");
    if (text.includes("\ufffd")) {
        text = [res.stderr, res.stdout].map(b => (b || Buffer.alloc(0)).toString("latin1")).join("\n");
    }
    const devices = [];
    for (const line of text.split(/\r?\n/)) {
        if (!/\(audio\)/i.test(line) || /Alternative name/i.test(line)) continue;
        const m = line.match(/"([^"]+)"/);
        if (!m) continue;
        const name = m[1].trim();
        if (!name.startsWith("@") && name.length >= 2 && !devices.includes(name)) devices.push(name);
    }
    _dshowDevicesCache = devices;
    return devices;
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const request = (u) => {
            https.get(u, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return request(res.headers.location);
                }
                if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(); });
                file.on("error", (err) => { fs.unlink(dest, () => { }); reject(err); });
            }).on("error", reject);
        };
        request(url);
    });
}

let _ytdlpDownloadPromise = null;

async function findYtDlp() {
    if (_ytdlpCache) return _ytdlpCache;
    const candidates = [
        path.join(__dirname, "yt-dlp.exe"),
        path.join(__dirname, "..", "yt-dlp.exe"),
        path.join(__dirname, "..", "..", "yt-dlp.exe"),
        "C:\\yt-dlp\\yt-dlp.exe", "yt-dlp.exe", "yt-dlp",
    ];
    for (const c of candidates) {
        try {
            if (c.includes(path.sep) && !fs.existsSync(c)) continue;
            execSync('"' + c + '" --version', { stdio: "ignore", timeout: 3000 });
            _ytdlpCache = c;
            return c;
        } catch { }
    }

    // Si on arrive ici, il est vraiment absent. On tente le téléchargement.
    if (_ytdlpDownloadPromise) return _ytdlpDownloadPromise;

    const target = path.join(__dirname, "yt-dlp.exe");
    console.log("[GhostServer] yt-dlp.exe introuvable, téléchargement automatique...");
    _ytdlpDownloadPromise = (async () => {
        try {
            await downloadFile("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", target);
            console.log("[GhostServer] yt-dlp.exe téléchargé ✓");
            _ytdlpCache = target;
            _ytdlpDownloadPromise = null;
            return target;
        } catch (e) {
            console.error("[GhostServer] Échec téléchargement yt-dlp:", e.message);
            _ytdlpDownloadPromise = null;
            return null;
        }
    })();

    return _ytdlpDownloadPromise;
}

// Cache des URLs résolues — évite de relancer yt-dlp pour la même URL
const _resolvedUrlCache = new Map();

async function resolveVideoUrl(url) {
    if (/\.(mp4|mkv|webm|m3u8|mov|avi)(\?|$)/i.test(url)) return url;
    // Cache : si déjà résolue récemment (< 5 min) on retourne directement
    const cached = _resolvedUrlCache.get(url);
    if (cached && (Date.now() - cached.ts) < 5 * 60 * 1000) return cached.resolved;
    const ytdlp = await findYtDlp();
    if (!ytdlp) throw new Error("yt-dlp manquant (échec du téléchargement)");
    if (typeof ytdlp !== "string") throw new Error("yt-dlp en cours de téléchargement, réessaie dans 10 secondes...");
    return new Promise((resolve, reject) => {
        // Timeout étendu à 30s pour les connexions lentes
        const proc = spawn(ytdlp, [
            "-g",
            "--no-playlist",
            "--no-warnings",
            "-f", "bestvideo[ext=mp4][height<=720]+bestaudio/best[ext=mp4][height<=720]/best[height<=720]/best",
            url
        ], { windowsHide: true });
        const timer = setTimeout(() => { try { proc.kill(); } catch { } reject(new Error("yt-dlp timeout 30s")); }, 30000);
        let out = "";
        proc.stdout.on("data", d => { out += d.toString(); });
        proc.stderr.on("data", d => { const m = d.toString().trim(); if (m && !m.includes("WARNING")) console.warn("[yt-dlp] " + m); });
        proc.on("close", code => {
            clearTimeout(timer);
            const lines = out.trim().split("\n").filter(Boolean);
            if (!lines.length || code !== 0) { reject(new Error("yt-dlp échoué code=" + code)); return; }
            const resolved = lines[0].trim();
            _resolvedUrlCache.set(url, { resolved, ts: Date.now() });
            resolve(resolved);
        });
        proc.on("error", e => { clearTimeout(timer); reject(e); });
    });
}

setImmediate(() => {
    const ff = findFfmpeg();
    if (ff) {
        listDshowDevices(ff);
        findYtDlp();
        console.log("[GhostServer] Cache: ffmpeg=" + ff + " devices=" + (_dshowDevicesCache?.length ?? 0));
    }
});

const sessions = new Map();
const audioPipelines = new Map(); // Legacy: userId -> { udpTarget }
const sharedAudios = new Map(); // micDevice -> { proc, encoder, users: Map<userId, udpConn> }

// FIX streaming infini : état de chaque stream en cours de démarrage
// Permet à l'UI de poller /stream-status sans bloquer la requête /stream-start
const streamJobs = new Map(); // userId → { state: "resolving"|"starting"|"active"|"error", error?: string }

async function preconnectGhost({ userId, token, micLabel, micDevice }) {
    micLabel = micLabel || micDevice || "default";
    if (sessions.has(userId)) {
        return { ok: true, already: true };
    }
    if (!DVS) {
        for (let i = 0; i < 300; i++) {
            await new Promise(r => setTimeout(r, 200));
            if (DVS) break;
        }
    }
    if (!DVS) return { ok: false, error: "DVS non chargé" };
    if (!OpusScript) return { ok: false, error: "opusscript non chargé" };

    const client = new Client({ checkUpdate: false });
    const streamer = new DVS.Streamer(client);

    // Monkey-patch signalVideo to ensure ghost account is NEVER deafened in voice
    streamer.signalVideo = function (video_enabled) {
        if (!this.voiceConnection) return;
        const { guildId: guild_id, channelId: channel_id } = this.voiceConnection;
        this.sendOpcode(4, {
            guild_id: guild_id || null,
            channel_id: channel_id || null,
            self_mute: false,
            self_deaf: false,
            self_video: Boolean(video_enabled),
        });
    };

    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Login timeout")), 20000);
        client.once("ready", () => { clearTimeout(t); resolve(); });
        client.once("error", e => { clearTimeout(t); reject(e); });
        client.login(token).catch(reject);
    });
    console.log("[GhostServer] Pré-connecté: " + client.user.tag);

    const session = {
        client, streamer, userId,
        ffmpegProc: null, videoProc: null, ffmpegCommand: null,
        udpConn: null, streamUdp: null, streamAbort: null,
        micLabel, streaming: false,
    };
    sessions.set(userId, session);

    client.on("shardDisconnect", (event) => {
        console.warn(`[GhostServer] ${userId} shardDisconnect code=${event?.code}`);
    });
    client.on("error", e => console.error(`[GhostServer] ${userId} error: ${e.message}`));

    startPermanentAudio(session, null);
    return { ok: true, username: client.user.tag };
}

async function connectGhost({ userId, token, guildId, channelId, micLabel, micDevice }) {
    micLabel = micLabel || micDevice || "default";
    if (sessions.has(userId)) {
        return joinVoice(userId, guildId, channelId, micLabel, micDevice);
    }
    const pre = await preconnectGhost({ userId, token, micLabel, micDevice });
    if (!pre.ok) return pre;
    return joinVoice(userId, guildId, channelId, micLabel, micDevice);
}

async function joinVoice(userId, guildId, channelId, micLabel, micDevice) {
    const s = sessions.get(userId);
    if (!s) return { ok: false, error: "Session introuvable" };

    // Si déjà connecté, on force un leave propre d'abord pour reset l'audio
    if (s.udpConn) {
        await leaveVoice(userId);
        await new Promise(r => setTimeout(r, 500));
    }

    if (micLabel || micDevice) s.micLabel = micLabel || micDevice;
    try {
        await doJoinVoice(s, guildId, channelId);
        return { ok: true };
    } catch (e) {
        console.error("[GhostServer] joinVoice erreur: " + e.message);
        return { ok: false, error: e.message };
    }
}

function setSpeakingHelper(udpConn, session, enabled) {
    try {
        if (udpConn?.mediaConnection?.setSpeaking) {
            udpConn.mediaConnection.setSpeaking(enabled);
        } else if (session?.streamer?.voiceConnection?.setSpeaking) {
            session.streamer.voiceConnection.setSpeaking(enabled);
        }
    } catch { }
}

function unmuteAndUndeafen(session, guildId, channelId) {
    try {
        if (!session?.streamer) return;
        const gId = (guildId && guildId !== "") ? guildId : (session.streamer.voiceConnection?.guildId || null);
        const cId = (channelId && channelId !== "") ? channelId : (session.streamer.voiceConnection?.channelId || null);
        session.streamer.sendOpcode(4, {
            guild_id: gId,
            channel_id: cId,
            self_mute: false,
            self_deaf: false,
            self_video: false,
        });
        console.log(`[GhostServer] Voice state unmuted & undeafened for ${session.userId} (guild: ${gId}, channel: ${cId})`);
    } catch (e) {
        console.warn("[GhostServer] unmuteAndUndeafen error:", e?.message ?? e);
    }
}

function setupSpeakingHeartbeat(session, udpConn) {
    if (session._speakingHeartbeat) {
        clearInterval(session._speakingHeartbeat);
        session._speakingHeartbeat = null;
    }
    const sendSpeaking = () => {
        try {
            setSpeakingHelper(udpConn, session, true);
            // Do NOT send unmute opcode when fake-muted or fake-deafened — let the fake state hold
            if (!session._fakeMuted && !session._fakeDeafened) {
                unmuteAndUndeafen(session);
            }
        } catch { }
    };
    sendSpeaking();
    setTimeout(sendSpeaking, 500);
    setTimeout(sendSpeaking, 1500);
    session._speakingHeartbeat = setInterval(sendSpeaking, 3000);
}

async function doJoinVoice(session, guildId, channelId) {
    stopStream(session);
    session._lastGuildId = guildId;
    session._lastChannelId = channelId;
    session._isLeaving = false;

    // Tentative de récupération des noms pour les logs (optionnel)
    const guild = session.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (channel) console.log("[GhostServer] Rejoindre: " + channel.name);
    else console.log("[GhostServer] Rejoindre salon ID: " + channelId);

    if (session.udpConn) {
        const pipe = audioPipelines.get(session.userId);
        if (pipe) pipe.udpTarget = null;
        try { session.streamer.leaveVoice(); } catch { }
        session.udpConn = null;
        await new Promise(r => setTimeout(r, 150));
    }

    if (session._isLeaving) return;

    let udpConn = null;
    let attempts = 0;
    while (attempts < 2) {
        if (session._isLeaving) return;
        attempts++;
        try {
            udpConn = await Promise.race([
                session.streamer.joinVoice(guildId, channelId, { receiveAudio: true }),
                new Promise((_, r) => setTimeout(() => r(new Error("Timeout connexion WebRTC")), 15000))
            ]);
            break; // Succès
        } catch (e) {
            console.error(`[GhostServer] ❌ joinVoice tentative ${attempts} a echoue:`, e.message);
            if (attempts >= 2 || session._isLeaving) throw e;
            // Clean up et pause avant retry
            try { session.streamer.leaveVoice(); } catch { }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    if (session._isLeaving) {
        try { udpConn?.mediaConnection?.setSpeaking?.(false); } catch { }
        try { session.streamer?.leaveVoice?.(); } catch { }
        return;
    }

    session.udpConn = udpConn;
    try { udpConn.setPacketizer("H264"); } catch { }
    console.log("[GhostServer] Voice connecte (avec reception audio) ✓");
    unmuteAndUndeafen(session, guildId, channelId);

    // Activer l'audio ET setSpeaking seulement quand WebRTC est vraiment "connected"
    function activateAudio() {
        if (session._isLeaving) return;
        console.log("[GhostServer] ✅ WebRTC connected — audio + speaking actifs pour " + session.userId);
        try {
            if (!udpConn._audioPacketizer) {
                if (typeof udpConn.ensureAudioPacketizer === "function") udpConn.ensureAudioPacketizer();
                else udpConn.setPacketizer?.("H264");
            }
        } catch { }
        unmuteAndUndeafen(session, guildId, channelId);
        setupSpeakingHeartbeat(session, udpConn);
        audioPipelines.set(session.userId, { udpTarget: udpConn });
        startPermanentAudio(session, udpConn);
    }

    if (udpConn.ready) {
        activateAudio();
    } else {
        try {
            const webRtcConn = udpConn.webRtcConn;
            if (webRtcConn) {
                let activated = false;
                webRtcConn.onStateChange(async (state) => {
                    console.log("[GhostServer] WebRTC State:", state);
                    if (session._isLeaving) return;
                    if (state === "connected" && !activated) {
                        activated = true;
                        console.log("[GhostServer] ✅ WebRTC state=connected");
                        activateAudio();
                    } else if (state === "failed" || state === "closed") {
                        if (!activated && !session._isLeaving) {
                            console.error("[GhostServer] ❌ WebRTC Failed -> tentative de reconnexion");
                            try {
                                await new Promise(r => setTimeout(r, 500));
                                if (!session._isLeaving) {
                                    console.log("[GhostServer] 🔄 Reconnexion automatique relancée...");
                                    await doJoinVoice(session, guildId, channelId);
                                }
                            } catch (e) { console.error("[GhostServer] Echec du restart", e); }
                        }
                    }
                });

                // Fallback timeout
                setTimeout(() => {
                    if (!activated) {
                        activated = true;
                        console.warn("[GhostServer] ⚠️ WebRTC timeout 5s — activation forcee");
                        activateAudio();
                    }
                }, 5000);
            } else {
                activateAudio();
            }
        } catch {
            activateAudio();
        }
    }
}

async function joinVoiceSilent(userId, guildId, channelId, micLabel, micDevice) {
    const s = sessions.get(userId);
    if (!s) return { ok: false, error: "Session introuvable" };
    if (micLabel || micDevice) s.micLabel = micLabel || micDevice;
    s._lastGuildId = guildId;
    s._lastChannelId = channelId;
    s._isLeaving = false;

    let guild = s.client.guilds.cache.get(guildId);
    if (!guild) {
        for (let i = 0; i < 50; i++) {
            if (s._isLeaving) return { ok: false, error: "Annulé" };
            await new Promise(r => setTimeout(r, 200));
            guild = s.client.guilds.cache.get(guildId);
            if (guild) break;
        }
    }
    if (!guild) guild = await s.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { ok: false, error: "Guild introuvable: " + guildId };

    let channel = s.client.guilds.cache.get(guildId)?.channels.cache.get(channelId)
        ?? await s.client.guilds.cache.get(guildId)?.channels.fetch(channelId).catch(() => null);
    if (!channel) return { ok: false, error: "Channel introuvable: " + channelId };

    try {
        let udpConn = null;
        let attempts = 0;
        while (attempts < 2) {
            if (s._isLeaving) return { ok: false, error: "Annulé" };
            attempts++;
            try {
                udpConn = await Promise.race([
                    s.streamer.joinVoice(guildId, channelId, { receiveAudio: true }),
                    new Promise((_, r) => setTimeout(() => r(new Error("Timeout WebRTC")), 15000))
                ]);
                break;
            } catch (e) {
                if (attempts >= 2 || s._isLeaving) throw e;
                try { s.streamer.leaveVoice(); } catch { }
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        if (s._isLeaving) {
            try { udpConn?.mediaConnection?.setSpeaking?.(false); } catch { }
            try { s.streamer?.leaveVoice?.(); } catch { }
            return { ok: false, error: "Annulé" };
        }

        s.udpConn = udpConn;
        try { udpConn.setPacketizer("H264"); } catch { }
        unmuteAndUndeafen(s, guildId, channelId);

        function activateAudio() {
            if (s._isLeaving) return;
            try {
                if (!udpConn._audioPacketizer) {
                    if (typeof udpConn.ensureAudioPacketizer === "function") udpConn.ensureAudioPacketizer();
                    else udpConn.setPacketizer?.("H264");
                }
            } catch { }
            unmuteAndUndeafen(s, guildId, channelId);
            setupSpeakingHeartbeat(s, udpConn);
            audioPipelines.set(userId, { udpTarget: udpConn });
            startPermanentAudio(s, udpConn);
        }

        if (udpConn.ready) {
            activateAudio();
        } else {
            try {
                const webRtcConn = udpConn.webRtcConn;
                if (webRtcConn) {
                    let activated = false;
                    webRtcConn.onStateChange(async (state) => {
                        if (s._isLeaving) return;
                        if (state === "connected" && !activated) {
                            activated = true;
                            activateAudio();
                        } else if ((state === "failed" || state === "closed") && !activated && !s._isLeaving) {
                            try {
                                await new Promise(r => setTimeout(r, 500));
                                if (!s._isLeaving) {
                                    await joinVoiceSilent(userId, guildId, channelId, micLabel, micDevice);
                                }
                            } catch { }
                        }
                    });
                    setTimeout(() => { if (!activated && !s._isLeaving) { activated = true; activateAudio(); } }, 5000);
                } else activateAudio();
            } catch { activateAudio(); }
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function leaveVoice(userId) {
    const s = sessions.get(userId);
    if (!s) return;
    s._isLeaving = true;

    if (s._speakingHeartbeat) {
        clearInterval(s._speakingHeartbeat);
        s._speakingHeartbeat = null;
    }

    // Envoi explicite de l'Opcode Gateway 4 avec guild_id et channel_id: null
    // Discord EXIGE le guild_id pour déconnecter immédiatement un compte d'un salon vocal de serveur
    const gId = s.streamer.voiceConnection?.guildId || s._lastGuildId || null;
    try {
        s.streamer.sendOpcode(4, {
            guild_id: gId,
            channel_id: null,
            self_mute: false,
            self_deaf: false,
            self_video: false,
        });
    } catch { }

    stopMic(s);
    stopStream(s);

    try { s.udpConn?.mediaConnection?.setSpeaking?.(false); } catch { }
    try { s.streamer?.leaveVoice?.(); } catch { }
    s.udpConn = null;

    console.log(`[GhostServer] ${userId} quitté le salon (guild: ${gId}) ✓`);
}

async function destroyGhost(userId) {
    const s = sessions.get(userId);
    if (!s) return;
    stopAll(s);
    sessions.delete(userId);
    setImmediate(() => { try { s.client.destroy(); } catch { } });
}

const FRAME_SIZE = 960;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const PCM_BYTES = FRAME_SIZE * CHANNELS * 2;
const FRAME_DUR = 20;
const RING_SIZE = PCM_BYTES * 50;

function resolveDevice(session) {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return { ffmpeg: null, device: null };
    const devs = listDshowDevices(ffmpeg);
    let device = (session.micLabel && session.micLabel !== "default") ? session.micLabel : null;

    // Correspondance intelligente (casse, espaces, accents)
    if (device && devs.length > 0 && !devs.includes(device)) {
        const clean = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const targetClean = clean(device);
        const best = devs.find(d => clean(d).includes(targetClean) || targetClean.includes(clean(d)));
        if (best) device = best;
    }

    if (!device) {
        device = devs.find(d => /cable output/i.test(d))
            ?? devs.find(d => /virtual.*cable/i.test(d))
            ?? devs.find(d => /cable/i.test(d))
            ?? devs.find(d => /virtual/i.test(d))
            ?? devs.find(d => /vb-audio/i.test(d))
            ?? devs[0] ?? null;
    }
    return { ffmpeg, device };
}

function startPermanentAudio(session, initialUdpConn) {
    const { ffmpeg, device } = resolveDevice(session);
    if (!ffmpeg || !OpusScript || !device) {
        console.warn("[GhostServer] Pipeline impossible: ffmpeg=" + !!ffmpeg + " opus=" + !!OpusScript + " device=" + device);
        return;
    }

    // Gestion du Pipeline Partagé par micro
    if (sharedAudios.has(device)) {
        const shared = sharedAudios.get(device);
        if (shared.idleTimer) {
            clearTimeout(shared.idleTimer);
            shared.idleTimer = null;
        }
        if (initialUdpConn) {
            shared.users.set(session.userId, initialUdpConn);
        } else if (!shared.users.has(session.userId)) {
            shared.users.set(session.userId, null);
        }
        console.log(`[GhostServer] Micro ${device} déjà actif, rattaché ${session.userId} (${shared.users.size} auditeurs)`);
        return;
    }

    console.log("[GhostServer] Démarrage flux ffmpeg pour micro: " + device);

    const usersMap = new Map();
    if (initialUdpConn) usersMap.set(session.userId, initialUdpConn);
    else usersMap.set(session.userId, null);

    const shared = { proc: null, encoder: null, users: usersMap, idleTimer: null };
    sharedAudios.set(device, shared);

    function spawnFfmpeg(retryCount = 0) {
        try {
            const proc = spawn(ffmpeg, [
                "-fflags", "nobuffer+fastseek", "-flags", "low_delay", "-probesize", "32", "-analyzeduration", "0",
                "-thread_queue_size", "1024", "-f", "dshow", "-audio_buffer_size", "100", "-i", "audio=" + device,
                "-vn", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS), "-f", "s16le", "-loglevel", "error", "pipe:1",
            ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

            const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP);
            shared.proc = proc;
            shared.encoder = encoder;

            proc.stderr.on("data", d => {
                const msg = d.toString().trim();
                if (msg && !msg.includes("Guessed Channel Layout") && !msg.includes("size=")) console.warn("[ffmpeg] " + msg);
            });

            proc.on("error", err => {
                console.error(`[GhostServer] Erreur process ffmpeg pour ${device}:`, err.message);
                try { encoder.delete(); } catch { }
                if (sharedAudios.get(device) === shared) {
                    sharedAudios.delete(device);
                }
                if (shared.users.size > 0 && retryCount < 3) {
                    console.log(`[GhostServer] Retry spawn ffmpeg dans 600ms (tentative ${retryCount + 1})...`);
                    setTimeout(() => {
                        if (!sharedAudios.has(device)) {
                            sharedAudios.set(device, shared);
                            spawnFfmpeg(retryCount + 1);
                        }
                    }, 600);
                }
            });

            proc.on("exit", code => {
                try { encoder.delete(); } catch { }
                if (sharedAudios.get(device) === shared) {
                    sharedAudios.delete(device);
                }
                if (code !== 0 && code !== null) {
                    console.log(`[GhostServer] ffmpeg micro ${device} exit: ${code}`);
                    if (shared.users.size > 0 && retryCount < 3) {
                        console.log(`[GhostServer] Redémarrage automatique ffmpeg dans 600ms (tentative ${retryCount + 1})...`);
                        setTimeout(() => {
                            if (!sharedAudios.has(device)) {
                                sharedAudios.set(device, shared);
                                spawnFfmpeg(retryCount + 1);
                            }
                        }, 600);
                    }
                }
            });

            const ring = Buffer.allocUnsafe(RING_SIZE);
            let writePos = 0, dataLen = 0;

            proc.stdout.on("data", chunk => {
                if (shared.users.size === 0) { writePos = 0; dataLen = 0; return; }

                let srcPos = 0;
                while (srcPos < chunk.length) {
                    const space = RING_SIZE - writePos;
                    const toCopy = Math.min(chunk.length - srcPos, space);
                    chunk.copy(ring, writePos, srcPos, srcPos + toCopy);
                    srcPos += toCopy;
                    writePos = (writePos + toCopy) % RING_SIZE;
                    dataLen = Math.min(dataLen + toCopy, RING_SIZE);
                }

                const readStart = (writePos - dataLen + RING_SIZE) % RING_SIZE;
                let readPos = readStart;
                while (dataLen >= PCM_BYTES) {
                    let frame;
                    if (readPos + PCM_BYTES <= RING_SIZE) {
                        frame = ring.slice(readPos, readPos + PCM_BYTES);
                    } else {
                        frame = Buffer.allocUnsafe(PCM_BYTES);
                        const firstPart = RING_SIZE - readPos;
                        ring.copy(frame, 0, readPos, RING_SIZE);
                        ring.copy(frame, firstPart, 0, PCM_BYTES - firstPart);
                    }
                    readPos = (readPos + PCM_BYTES) % RING_SIZE;
                    dataLen -= PCM_BYTES;

                    const opusFrame = encoder.encode(frame, FRAME_SIZE);
                    // Broadcast aux utilisateurs actifs
                    for (const [uid, target] of shared.users) {
                        const currentTarget = (target?.ready) ? target : audioPipelines.get(uid)?.udpTarget;
                        if (currentTarget?.ready) {
                            if (target !== currentTarget) shared.users.set(uid, currentTarget);
                            if (!currentTarget._audioPacketizer) {
                                try { currentTarget.setPacketizer?.("H264"); } catch { }
                            }
                            try { currentTarget.sendAudioFrame(opusFrame, FRAME_DUR); } catch { }
                        }
                    }
                }
            });

            console.log("[GhostServer] Pipeline audio partagé actif ✓");
        } catch (err) {
            console.error("[GhostServer] Exception spawn ffmpeg:", err.message);
            if (sharedAudios.get(device) === shared) sharedAudios.delete(device);
        }
    }

    spawnFfmpeg();
}

function stopMic(session) {
    audioPipelines.delete(session.userId);
    // Retrait de l'utilisateur du flux partagé
    for (const [device, shared] of sharedAudios) {
        if (shared.users.has(session.userId)) {
            shared.users.delete(session.userId);
            console.log(`[GhostServer] Retrait de ${session.userId} du micro ${device} (${shared.users.size} restant(s))`);
            // Grace period: Ne pas tuer ffmpeg immédiatement pour éviter les conflits DirectShow
            if (shared.users.size === 0) {
                if (shared.idleTimer) clearTimeout(shared.idleTimer);
                shared.idleTimer = setTimeout(() => {
                    if (shared.users.size === 0) {
                        try { shared.proc?.kill("SIGKILL"); } catch { }
                        sharedAudios.delete(device);
                        console.log(`[GhostServer] Plus d'auditeurs pour ${device} (après délai de grâce), arrêt ffmpeg`);
                    }
                }, 8000);
            }
            break;
        }
    }
}

function stopStream(session) {
    if (session.videoProc) { try { process.kill(session.videoProc.pid, "SIGKILL"); } catch { } session.videoProc = null; }
    if (session.streamAbort) { try { session.streamAbort.abort(); } catch { } session.streamAbort = null; }
    if (session.ffmpegCommand) { try { session.ffmpegCommand.kill("SIGKILL"); } catch { } session.ffmpegCommand = null; }
    if (session.streamUdp && session.streamUdp !== session.udpConn) {
        try { session.streamer.stopStream(); } catch { }
        session.streamUdp = null;
    }
    session.streaming = false;
    // Nettoyer le job de stream si présent
    streamJobs.delete(session.userId);
}

function stopAll(session) {
    if (session._speakingHeartbeat) {
        clearInterval(session._speakingHeartbeat);
        session._speakingHeartbeat = null;
    }
    stopMic(session);
    stopStream(session);
    if (session.udpConn) {
        try { session.udpConn.mediaConnection?.setSpeaking(false); } catch { }
        try { session.streamer.leaveVoice(); } catch { }
        session.udpConn = null;
    }
    session.streaming = false;
}

async function startVideoStream(session, videoUrl) {
    if (!session.udpConn) throw new Error("Pas connecté au vocal");
    if (!DVS) throw new Error("DVS non chargé");
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) throw new Error("ffmpeg introuvable");
    stopStream(session);
    const resolvedUrl = await resolveVideoUrl(videoUrl);
    if (typeof DVS.prepareStream === "function" && typeof DVS.playStream === "function") {
        try { if (_fluentFfmpeg) { _fluentFfmpeg.setFfmpegPath(ffmpeg); } else { const { default: ff } = await import("fluent-ffmpeg"); ff.setFfmpegPath(ffmpeg); _fluentFfmpeg = ff; } } catch { }
        const abortCtrl = new AbortController();
        session.streamAbort = abortCtrl;
        session.streaming = true;
        const { command, output } = DVS.prepareStream(resolvedUrl, {
            width: 1280, height: 720, frameRate: 24, videoCodec: "H264",
            bitrateVideo: 2000, bitrateVideoMax: 2500, includeAudio: false, minimizeLatency: true,
        }, abortCtrl.signal);
        session.ffmpegCommand = command;
        DVS.playStream(output, session.streamer, {
            type: "go-live", format: "nut", width: 1280, height: 720, frameRate: 24,
        }, abortCtrl.signal).then(() => {
            session.streaming = false; session.streamAbort = null; session.ffmpegCommand = null;
            streamJobs.delete(session.userId);
        }).catch(e => {
            if (e?.name !== "AbortError") console.error("[GhostServer] playStream: " + (e?.message ?? e));
            session.streaming = false; session.streamAbort = null; session.ffmpegCommand = null;
            streamJobs.delete(session.userId);
        });
        return;
    }
    if (!OpusScript) throw new Error("opusscript introuvable");
    const streamConn = await session.streamer.createStream();
    session.streamUdp = streamConn;
    const FPS = 24, W = 1280, H = 720;
    streamConn.setPacketizer("H264");
    const vProc = spawn(ffmpeg, [
        "-re", "-i", resolvedUrl, "-an",
        "-vf", `scale=${W}:${H},format=yuv420p`,
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
        "-profile:v", "baseline", "-level", "3.1",
        "-b:v", "2000k", "-maxrate", "2500k", "-bufsize", "4000k",
        "-g", String(FPS * 2), "-f", "h264", "-loglevel", "error", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    session.videoProc = vProc;
    vProc.on("exit", () => {
        if (session.videoProc === vProc) {
            session.videoProc = null;
            session.streaming = false;
            streamJobs.delete(session.userId);
        }
    });
    vProc.stdout.on("data", chunk => { try { streamConn.sendVideoFrame(chunk, 1000 / FPS); } catch { } });
    session.streaming = true;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", c => body += c);
        req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
        req.on("error", reject);
    });
}

function send(res, code, data) {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { send(res, 200, {}); return; }
    try {
        if (req.url === "/status" && req.method === "GET") {
            send(res, 200, { ok: true, sessions: [...sessions.keys()], pipelines: [...audioPipelines.keys()], ffmpeg: !!findFfmpeg(), dvs: !!DVS, opus: !!OpusScript });
            return;
        }
        if (req.url === "/devices" && req.method === "GET") {
            const ff = findFfmpeg();
            _dshowDevicesCache = null;
            send(res, 200, { ok: true, devices: ff ? listDshowDevices(ff) : [] });
            return;
        }
        const body = await readBody(req);
        if (req.url === "/preconnect") { send(res, 200, await preconnectGhost(body)); return; }
        if (req.url === "/connect") { send(res, 200, await connectGhost(body)); return; }
        if (req.url === "/join") { send(res, 200, await joinVoice(body.userId, body.guildId, body.channelId, body.micLabel, body.micDevice)); return; }

        if (req.url === "/join-all") {
            const ids = Array.isArray(body.userIds) ? body.userIds : [];
            send(res, 200, { ok: true });
            (async () => {
                await Promise.allSettled(ids.map(id => {
                    const s = sessions.get(id);
                    if (!s?.udpConn) return Promise.resolve();
                    const pipe = audioPipelines.get(id);
                    if (pipe) pipe.udpTarget = null;
                    try { s.streamer.leaveVoice(); } catch { }
                    s.udpConn = null;
                    return new Promise(r => setTimeout(r, 150));
                }));
                const joinResults = await Promise.allSettled(
                    ids.map(id => joinVoiceSilent(id, body.guildId, body.channelId, body.micLabel, body.micDevice))
                );
                await new Promise(r => setTimeout(r, 500));
                const joined = ids.filter((_, i) => joinResults[i].status === "fulfilled" && joinResults[i].value?.ok);
                for (const userId of joined) {
                    const s = sessions.get(userId);
                    const pipe = audioPipelines.get(userId);
                    if (s?.udpConn) {
                        if (pipe) pipe.udpTarget = s.udpConn;
                        unmuteAndUndeafen(s, body.guildId, body.channelId);
                        setupSpeakingHeartbeat(s, s.udpConn);
                    }
                }
                console.log(`[GhostServer] Audio sync ${joined.length}/${ids.length} ✓`);
            })();
            return;
        }

        if (req.url === "/set-mic") {
            const newDevice = body.micDevice;
            console.log("[GhostServer] Changement de micro demandé:", newDevice);

            // 1. Retirer TOUS les utilisateurs de TOUS les anciens pipelines sharedAudios
            //    On ne conserve que les entrées qui correspondent déjà au nouveau périphérique.
            for (const [device, shared] of sharedAudios) {
                if (device === newDevice) continue; // garder le pipeline du nouveau périph s'il existe déjà
                for (const [userId] of sessions) {
                    if (shared.users.has(userId)) {
                        shared.users.delete(userId);
                        console.log(`[GhostServer] set-mic: retrait de ${userId} du périph ${device}`);
                    }
                }
                // Tuer le proc ffmpeg si plus personne dessus
                if (shared.users.size === 0) {
                    try { shared.proc.kill("SIGKILL"); } catch { }
                    sharedAudios.delete(device);
                    console.log(`[GhostServer] set-mic: arrêt ffmpeg pour périph ${device}`);
                }
            }

            // 2. Mettre à jour micLabel + vider audioPipelines pour tous les comptes
            for (const [userId, session] of sessions) {
                session.micLabel = newDevice;
                audioPipelines.delete(userId);
            }

            // 3. Démarrer le nouveau pipeline pour tous les comptes
            //    (udpConn est null pour les comptes pas encore en vocal → startPermanentAudio gère ce cas)
            for (const [userId, session] of sessions) {
                startPermanentAudio(session, session.udpConn ?? null);
            }

            send(res, 200, { ok: true });
            return;
        }

        // ── Fake voice state controls ──────────────────────────────────────────────
        if (req.url === "/fake-mute") {
            const targets = body.userIds?.length ? body.userIds : [...sessions.keys()];
            const muted = Boolean(body.muted);
            for (const uid of targets) {
                const s = sessions.get(uid);
                if (!s?.streamer) continue;
                s._fakeMuted = muted;
                const gId = s.streamer.voiceConnection?.guildId ?? null;
                const cId = s.streamer.voiceConnection?.channelId ?? null;
                try {
                    s.streamer.sendOpcode(4, {
                        guild_id: gId, channel_id: cId,
                        self_mute: muted, self_deaf: Boolean(s._fakeDeafened), self_video: Boolean(s._fakeStreaming || s._fakeCam),
                    });
                } catch (e) { console.warn("[GhostServer] fake-mute opcode error:", e?.message); }
            }
            send(res, 200, { ok: true }); return;
        }

        if (req.url === "/fake-deafen") {
            const targets = body.userIds?.length ? body.userIds : [...sessions.keys()];
            const deafened = Boolean(body.deafened);
            for (const uid of targets) {
                const s = sessions.get(uid);
                if (!s?.streamer) continue;
                s._fakeDeafened = deafened;
                const gId = s.streamer.voiceConnection?.guildId ?? null;
                const cId = s.streamer.voiceConnection?.channelId ?? null;
                try {
                    s.streamer.sendOpcode(4, {
                        guild_id: gId, channel_id: cId,
                        self_mute: Boolean(s._fakeMuted), self_deaf: deafened, self_video: Boolean(s._fakeStreaming || s._fakeCam),
                    });
                } catch (e) { console.warn("[GhostServer] fake-deafen opcode error:", e?.message); }
            }
            send(res, 200, { ok: true }); return;
        }

        if (req.url === "/fake-stream") {
            const targets = body.userIds?.length ? body.userIds : [...sessions.keys()];
            const streaming = Boolean(body.streaming);
            for (const uid of targets) {
                const s = sessions.get(uid);
                if (!s?.streamer) continue;
                s._fakeStreaming = streaming;
                const gId = s.streamer.voiceConnection?.guildId ?? null;
                const cId = s.streamer.voiceConnection?.channelId ?? null;
                try {
                    s.streamer.sendOpcode(4, {
                        guild_id: gId, channel_id: cId,
                        self_mute: Boolean(s._fakeMuted), self_deaf: Boolean(s._fakeDeafened), self_video: streaming || Boolean(s._fakeCam),
                    });
                } catch (e) { console.warn("[GhostServer] fake-stream opcode error:", e?.message); }
            }
            send(res, 200, { ok: true }); return;
        }

        if (req.url === "/fake-cam") {
            const targets = body.userIds?.length ? body.userIds : [...sessions.keys()];
            const camera = Boolean(body.camera);
            for (const uid of targets) {
                const s = sessions.get(uid);
                if (!s?.streamer) continue;
                s._fakeCam = camera;
                const gId = s.streamer.voiceConnection?.guildId ?? null;
                const cId = s.streamer.voiceConnection?.channelId ?? null;
                try {
                    s.streamer.sendOpcode(4, {
                        guild_id: gId, channel_id: cId,
                        self_mute: Boolean(s._fakeMuted), self_deaf: Boolean(s._fakeDeafened), self_video: Boolean(s._fakeStreaming) || camera,
                    });
                } catch (e) { console.warn("[GhostServer] fake-cam opcode error:", e?.message); }
            }
            send(res, 200, { ok: true }); return;
        }

        if (req.url === "/leave") { await leaveVoice(body.userId); send(res, 200, { ok: true }); return; }
        if (req.url === "/leave-all") { await Promise.all((body.userIds ?? []).map(id => leaveVoice(id))); send(res, 200, { ok: true }); return; }
        if (req.url === "/disconnect") { await leaveVoice(body.userId); send(res, 200, { ok: true }); return; }
        if (req.url === "/destroy") { await destroyGhost(body.userId); send(res, 200, { ok: true }); return; }

        // FIX STREAMING INFINI :
        // Avant ce fix, /stream-start attendait la résolution yt-dlp (jusqu'à 30s) DANS la requête HTTP.
        // Pendant ce temps, le serveur HTTP ne répondait plus à RIEN (Node.js single-thread),
        // donc l'UI Discord voyait toutes ses requêtes bloquer → "chargement infini" partout.
        //
        // Solution : répondre IMMÉDIATEMENT avec { ok: true, resolving: true }
        // et traiter la résolution + le démarrage ffmpeg en arrière-plan.
        // L'UI peut poller /stream-status pour suivre l'état.
        if (req.url === "/stream-start") {
            const s = sessions.get(body.userId);
            if (!s) { send(res, 200, { ok: false, error: "Session introuvable" }); return; }

            // Répondre immédiatement — ne pas bloquer le serveur HTTP
            const jobId = Date.now().toString();
            streamJobs.set(body.userId, { state: "resolving", jobId });
            send(res, 200, { ok: true, resolving: true, jobId });

            // Traitement asynchrone EN ARRIÈRE-PLAN
            setImmediate(async () => {
                try {
                    streamJobs.set(body.userId, { state: "starting", jobId });
                    await startVideoStream(s, body.url);
                    streamJobs.set(body.userId, { state: "active", jobId });
                    console.log("[GhostServer] Stream démarré pour " + body.userId);
                } catch (e) {
                    console.error("[GhostServer] stream-start erreur: " + (e?.message ?? e));
                    streamJobs.set(body.userId, { state: "error", error: e?.message ?? String(e), jobId });
                    if (s) s.streaming = false;
                }
            });
            return;
        }

        // Nouveau endpoint : l'UI polle cet endpoint pour savoir si le stream a démarré
        // { state: "resolving"|"starting"|"active"|"error", error?: string }
        if (req.url === "/stream-status") {
            const s = sessions.get(body.userId);
            if (!s) { send(res, 200, { ok: false, error: "Session introuvable" }); return; }
            const job = streamJobs.get(body.userId);
            if (!job) {
                // Pas de job en cours — vérifier si le stream est actif
                send(res, 200, { ok: true, state: s.streaming ? "active" : "idle" });
            } else {
                send(res, 200, { ok: true, ...job });
            }
            return;
        }

        if (req.url === "/stream-stop") {
            const s = sessions.get(body.userId);
            if (!s) { send(res, 200, { ok: false, error: "Session introuvable" }); return; }
            stopStream(s); send(res, 200, { ok: true }); return;
        }
        if (req.url?.startsWith("/playback/")) {
            const uid = req.url.split("/").pop();
            const s = sessions.get(uid);
            if (!s?.udpConn) { send(res, 404, { error: "Non connecté" }); return; }

            console.log("[GhostServer] Début streaming WAV playback pour " + uid);
            res.writeHead(200, {
                "Content-Type": "audio/wav",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            });

            // Header WAV pour stream "infini" (Data size = 0xFFFFFFFF)
            const wavHeader = Buffer.alloc(44);
            wavHeader.write("RIFF", 0);
            wavHeader.writeUInt32LE(0xFFFFFFFF, 4);
            wavHeader.write("WAVE", 8);
            wavHeader.write("fmt ", 12);
            wavHeader.writeUInt32LE(16, 16);
            wavHeader.writeUInt16LE(1, 20); // PCM
            wavHeader.writeUInt16LE(2, 22); // Channels
            wavHeader.writeUInt32LE(48000, 24); // Rate
            wavHeader.writeUInt32LE(48000 * 2 * 2, 28); // Byte rate
            wavHeader.writeUInt16LE(4, 32); // Block align
            wavHeader.writeUInt16LE(16, 34); // Bits per sample
            wavHeader.write("data", 36);
            wavHeader.writeUInt32LE(0xFFFFFFFF, 40);

            res.write(wavHeader);

            const decoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);

            // On s'abonne via le streamer si possible (plus propre sur DVS)
            const udp = s.udpConn;
            if (udp?.mediaConnection?.on) {
                udp.mediaConnection.on("audio", (id, frame) => {
                    if (!res.writable) return;
                    try {
                        const pcm = decoder.decode(frame, 960);
                        res.write(pcm);
                    } catch { }
                });
            } else {
                // Fallback silence pour tester si pas d'audio
                const silence = Buffer.alloc(960 * 4, 0);
                const int = setInterval(() => { if (!res.writable) clearInterval(int); else res.write(silence); }, 20);
                req.on("close", () => clearInterval(int));
            }

            req.on("close", () => {
                try { decoder.delete(); } catch { }
            });
            return;
        }
        if (req.url === "/shutdown") {
            send(res, 200, { ok: true });
            setTimeout(() => process.exit(0), 100);
            return;
        }
        send(res, 404, { ok: false, error: "Not found" });
    } catch (e) {
        console.error("[GhostServer] HTTP: " + e.message);
        send(res, 500, { ok: false, error: e.message });
    }
}).listen(PORT, "127.0.0.1", () => {
    console.log("[GhostServer] Prêt sur port " + PORT + " ✓");
});

process.on("uncaughtException", e => console.error("[GhostServer] Uncaught: " + e.message));
process.on("unhandledRejection", e => console.error("[GhostServer] Rejection: " + (e?.message ?? e)));
