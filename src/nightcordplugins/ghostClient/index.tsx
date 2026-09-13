/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { DataStore } from "@api/index";
import { UserAreaButton as RawUserAreaButton } from "@api/UserArea";
import definePlugin, { PluginNative } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { React, ReactDOM, Toasts, useState, useEffect, useRef, SettingsRouter } from "@webpack/common";
import { t } from "../autoTranslateNightcord";

// UserAreaButton 100% sûr - aucun proxy lazy Webpack pour éviter les erreurs de type Reflect
const UserAreaButton: any = (props: any) => {
    const Comp = RawUserAreaButton
        ?? (Vencord as any)?.Api?.UserArea?.UserAreaButton
        ?? (window as any)?.Vencord?.Api?.UserArea?.UserAreaButton;
    if (typeof Comp === "function") {
        return <Comp {...props} />;
    }
    return (
        <div
            onClick={props.onClick}
            onContextMenu={props.onContextMenu}
            title={props.tooltipText}
            role="button"
            tabIndex={0}
            style={{
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 4,
            }}
        >
            {props.icon}
        </div>
    );
};

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelStore = findStoreLazy("ChannelStore");
const FluxDispatcher = findByPropsLazy("dispatch", "subscribe");
const UserStore = findStoreLazy("UserStore");

const DS_KEY_TOKENS = "nightcord-ghost-tokens";
const DS_KEY_AUTO_FOLLOW = "nightcord-ghost-autofollow";
const DS_KEY_MIC_DEVICE = "nightcord-ghost-mic-device-label";
const DS_KEY_SELECTED = "nightcord-ghost-selected";
const DS_KEY_JOIN_DELAY = "nightcord-ghost-join-delay";
const DS_KEY_VOLUME = "nightcord-ghost-volume-booster";
const TI_ACCOUNTS_KEY = "TokenImporter_accounts";

let ghostMicLabel: string = "default";
let ghostJoinDelay: number = 200;
let ghostVolumeMultiplier: number = 1.0;

// ─── Backend natif / HTTP ─────────────────────────────────────────────────────
const GHOST_SERVER = "http://127.0.0.1:47821";

function getNative(): any {
    return (VencordNative?.pluginHelpers as any)?.GhostClient
        ?? (VencordNative?.pluginHelpers as any)?.ghostClient
        ?? (VencordNative?.pluginHelpers as any)?.GhostClientV2
        ?? (VencordNative?.pluginHelpers as any)?.ghostClientV2;
}

async function sfetch(endpoint: string, body?: any, ms = 15000): Promise<any> {
    try {
        const res = await fetch(`${GHOST_SERVER}${endpoint}`, {
            method: body !== undefined ? "POST" : "GET",
            headers: { "Content-Type": "application/json" },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(ms),
        });
        return await res.json();
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

const Native = {
    async init(): Promise<void> {
        const n = getNative();
        if (n?.init) { try { await n.init(); } catch {} }
    },
    async isServerInstalled(): Promise<boolean> {
        const n = getNative();
        if (n?.isServerInstalled) { try { return Boolean(await n.isServerInstalled()); } catch {} }
        const r = await sfetch("/status", undefined, 2000);
        return r?.status === "online" || r?.ok === true || !r?.error;
    },
    async listAudioInputDevices(): Promise<Array<{ label: string; dshowName: string }>> {
        const n = getNative();
        if (n?.listAudioInputDevices) { try { const d = await n.listAudioInputDevices(); if (d?.length) return d; } catch {} }
        const res = await sfetch("/devices");
        return (res?.devices ?? []).map((d: string) => ({ label: d, dshowName: d }));
    },
    async connectGhost(userId: string, token: string, guildId: string, channelId: string, micDevice: string): Promise<{ ok: boolean; error?: string }> {
        const n = getNative();
        if (n?.connectGhost) { try { return await n.connectGhost(userId, token, guildId, channelId, micDevice); } catch {} }
        return await sfetch("/connect", { userId, token, guildId, channelId, micDevice }, 120000);
    },
    async preConnectGhost(userId: string, token: string, micDevice: string): Promise<{ ok: boolean; error?: string }> {
        const n = getNative();
        if (n?.preConnectGhost) { try { return await n.preConnectGhost(userId, token, micDevice); } catch {} }
        return await sfetch("/preconnect", { userId, token, micDevice }, 120000);
    },
    async joinVoiceAll(userIds: string[], guildId: string, channelId: string, micDevice: string): Promise<{ ok: boolean }> {
        const n = getNative();
        if (n?.joinVoiceAll) { try { return await n.joinVoiceAll(userIds, guildId, channelId, micDevice); } catch {} }
        return await sfetch("/join-all", { userIds, guildId, channelId, micDevice });
    },
    async leaveVoice(userId: string, guildId?: string): Promise<void> {
        const n = getNative();
        if (n?.leaveVoice) { try { await n.leaveVoice(userId); return; } catch {} }
        const gId = guildId ?? getMyVoiceState()?.guildId;
        await sfetch("/leave", { userId, guildId: gId });
    },
    async leaveVoiceAll(userIds: string[]): Promise<void> {
        const n = getNative();
        if (n?.leaveVoiceAll) { try { await n.leaveVoiceAll(userIds); return; } catch {} }
        await sfetch("/leave-all", { userIds });
    },
    async setMicDevice(micDevice: string): Promise<void> {
        const n = getNative();
        if (n?.setMicDevice) { try { await n.setMicDevice(micDevice); return; } catch {} }
        await sfetch("/set-mic", { micDevice });
    },
    async setVolume(volume: number): Promise<void> {
        const n = getNative();
        if (n?.setVolume) { try { await n.setVolume(volume); return; } catch {} }
        await sfetch("/set-volume", { volume });
    },
    async setMute(userId: string, muted: boolean): Promise<void> {
        const n = getNative();
        if (n?.setMute) { try { await n.setMute(userId, muted); return; } catch {} }
        if (n?.fakeMute) { try { await n.fakeMute([userId], muted); return; } catch {} }
        await sfetch("/set-mute", { userId, muted });
    },
    async setDeafen(userId: string, deafened: boolean): Promise<void> {
        const n = getNative();
        if (n?.setDeafen) { try { await n.setDeafen(userId, deafened); return; } catch {} }
        if (n?.fakeDeafen) { try { await n.fakeDeafen([userId], deafened); return; } catch {} }
        await sfetch("/set-deafen", { userId, deafened });
    },
    async setStream(userId: string, streaming: boolean): Promise<void> {
        const n = getNative();
        if (n?.setStream) { try { await n.setStream(userId, streaming); return; } catch {} }
        if (n?.fakeStream) { try { await n.fakeStream([userId], streaming); return; } catch {} }
        await sfetch("/set-stream", { userId, streaming });
    },
    async setCamera(userId: string, camera: boolean): Promise<void> {
        const n = getNative();
        if (n?.setCamera) { try { await n.setCamera(userId, camera); return; } catch {} }
        if (n?.fakeCam) { try { await n.fakeCam([userId], camera); return; } catch {} }
        await sfetch("/set-camera", { userId, camera });
    },
    async setMuteAll(userIds: string[], muted: boolean): Promise<void> {
        const n = getNative();
        if (n?.fakeMute) { try { await n.fakeMute(userIds, muted); return; } catch {} }
        await sfetch("/fake-mute", { userIds, muted });
    },
    async setDeafenAll(userIds: string[], deafened: boolean): Promise<void> {
        const n = getNative();
        if (n?.fakeDeafen) { try { await n.fakeDeafen(userIds, deafened); return; } catch {} }
        await sfetch("/fake-deafen", { userIds, deafened });
    },
    async setStreamAll(userIds: string[], streaming: boolean): Promise<void> {
        const n = getNative();
        if (n?.fakeStream) { try { await n.fakeStream(userIds, streaming); return; } catch {} }
        await sfetch("/fake-stream", { userIds, streaming });
    },
    async setCameraAll(userIds: string[], camera: boolean): Promise<void> {
        const n = getNative();
        if (n?.fakeCam) { try { await n.fakeCam(userIds, camera); return; } catch {} }
        await sfetch("/fake-cam", { userIds, camera });
    },
};

// ─── Icons (Strict Zero-Emoji, Minimalist SVG Primitives) ────────────────────
function GhostIcon({ width = 20, height = 20, className }: { width?: number; height?: number; className?: string; }) {
    return (
        <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} className={className} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" d="M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM2 20.53A9.53 9.53 0 0 1 11.53 11h.94c1.28 0 2.5.25 3.61.7.41.18.36.77-.05.96a7 7 0 0 0-3.65 8.6c.11.36-.13.74-.5.74H6.15a.5.5 0 0 1-.5-.55l.27-2.6c.02-.26-.27-.37-.41-.16-.48.74-1.03 1.8-1.32 2.9a.53.53 0 0 1-.5.41h-.22C2.66 22 2 21.34 2 20.53Z" />
            <path fill="currentColor" d="M24 19a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z" />
        </svg>
    );
}
function ChevronIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>; }
function MicIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4Zm0 17a7 7 0 0 1-7-7H3a9 9 0 0 0 8 8.94V22h2v-2.06A9 9 0 0 0 21 11h-2a7 7 0 0 1-7 7Z" /></svg>; }
function MicOffIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-2.21-1.79-4-4-4S7 2.79 7 5v.18l7.98 7.99zM4.27 3L3 4.27l6.01 6.01V11c0 2.21 1.79 4 4 4 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5-2.24-5-5H6c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c.57-.08 1.12-.24 1.64-.46L19.73 21 21 19.73 4.27 3z" />
        </svg>
    );
}
function DeafenIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.27 2L2 3.27l3.74 3.74A8.96 8.96 0 0 0 3 12v7c0 1.66 1.34 3 3 3h3a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-2c0-1.5.46-2.89 1.25-4.04l4.9 4.9A1 1 0 0 0 12 12h.17l8.56 8.56 1.27-1.27L3.27 2zM12 3a9 9 0 0 1 9 9v7c0 .4-.08.79-.22 1.14l-2.02-2.02V14h-3a1 1 0 0 1-.95-.68l-3.95-3.95A6.97 6.97 0 0 1 12 5a7 7 0 0 1 7 7v2h-2v-1a1 1 0 0 0-1-1h-.17l-2.83-2.83V9a1 1 0 0 0-1-1h-1.17l-3.9-3.9C9.36 3.43 10.63 3 12 3z" />
        </svg>
    );
}
function UndeafenIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-2a7 7 0 0 1 14 0v2h-4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9z" />
        </svg>
    );
}
function UserIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm-7 8a7 7 0 0 1 14 0H5Z" /></svg>; }
function CheckIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" /></svg>; }
function TrashIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.1l-.9 12.1A3 3 0 0 1 17 23H7a3 3 0 0 1-3-2.9L3.1 8H2a1 1 0 0 1 0-2h4V4Zm2 0v2h6V4H9ZM5.1 8l.9 11.9a1 1 0 0 0 1 .1h6a1 1 0 0 0 1-.1L14.9 8H5.1Z" /></svg>; }
function VideoIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.3l3.4 2.5A1 1 0 0 0 23 14V9a1 1 0 0 0-1.6-.8L18 10.7V6a2 2 0 0 0-2-2H4Z" /></svg>; }
function CamIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9.33 4h5.34L16 6h4v14H4V6h4l1.33-2zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
        </svg>
    );
}
function StreamIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 2.5A2.5 2.5 0 0 0 1.5 5v10A2.5 2.5 0 0 0 4 17.5h6V19H7a1 1 0 1 0 0 2h10a1 1 0 0 0 0-2h-3v-1.5h6a2.5 2.5 0 0 0 2.5-2.5V5A2.5 2.5 0 0 0 20 2.5H4zm-0.5 3c0-.28.22-.5.5-.5h16c.28 0 .5.22.5.5v10c0 .28-.22.5-.5.5H4a.5.5 0 0 1-.5-.5V5.5z" />
        </svg>
    );
}
function TimerIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61-1.42-1.42A8.953 8.953 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9a8.953 8.953 0 0 0-2.97-6.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
        </svg>
    );
}
function VolumeIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
        </svg>
    );
}
function SettingsGearIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
        </svg>
    );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface GhostAccount {
    token: string;
    userId: string;
    username: string;
    avatar: string | null;
}

interface GhostState {
    active: boolean;
    connecting: boolean;
    error: string | null;
    muted: boolean;
    deafened: boolean;
    streaming: boolean;
    camera: boolean;
}

function defaultState(): GhostState {
    return { active: false, connecting: false, error: null, muted: false, deafened: false, streaming: false, camera: false };
}

// ─── State global réactif ─────────────────────────────────────────────────────
const ghostStates = new Map<string, GhostState>();
let ghostListeners: Array<() => void> = [];
function notify() { ghostListeners.forEach(f => f()); }

function useGhostStates() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const fn = () => setTick(n => n + 1);
        ghostListeners.push(fn);
        return () => { ghostListeners = ghostListeners.filter(f => f !== fn); };
    }, []);
    return new Map(ghostStates);
}

function getMyId(): string {
    try { return UserStore?.getCurrentUser?.()?.id ?? ""; } catch { return ""; }
}

function getMyVoiceState() {
    try {
        const id = getMyId();
        if (!id) return null;
        const vs = VoiceStateStore?.getVoiceStateForUser?.(id);
        if (vs?.channelId) return { channelId: vs.channelId, guildId: vs.guildId ?? ChannelStore?.getChannel?.(vs.channelId)?.guild_id ?? "" };
        const chId = VoiceStateStore?.getCurrentClientVoiceChannelId?.();
        if (chId) { const ch = ChannelStore?.getChannel?.(chId); return { channelId: chId, guildId: ch?.guild_id ?? "" }; }
    } catch {}
    return null;
}

function avatarUrl(userId: string, avatar: string | null) {
    if (avatar) return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=80`;
    try {
        const idNum = userId ? BigInt(userId) : 0n;
        const idx = idNum ? Number(idNum >> 22n) % 6 : 0;
        return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    } catch { return "https://cdn.discordapp.com/embed/avatars/0.png"; }
}

function cleanToken(t: any): string {
    if (!t) return "";
    let s = String(t).trim();
    while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    s = s.replace(/^(Bot|Bearer)\s+/i, "");
    return s.trim();
}

async function decryptToken(rawToken: any): Promise<string> {
    if (!rawToken) return "";
    const s = cleanToken(rawToken);
    if (!s.startsWith("dQw4w9WgXcQ:")) return s;

    try {
        const ti = (VencordNative?.pluginHelpers as any)?.TokenImporter;
        if (ti?.decryptTokenNative) {
            const dec = await ti.decryptTokenNative(s);
            if (dec && typeof dec === "string" && !dec.startsWith("dQw4w9WgXcQ:")) {
                return cleanToken(dec);
            }
        }
    } catch {}

    try {
        const mi = (VencordNative?.pluginHelpers as any)?.MultiInstance;
        if (mi?.decryptToken) {
            const dec = await mi.decryptToken(s);
            if (dec && typeof dec === "string" && !dec.startsWith("dQw4w9WgXcQ:")) {
                return cleanToken(dec);
            }
        }
    } catch {}

    return s;
}

async function validateToken(rawToken: string): Promise<GhostAccount | null> {
    const token = await decryptToken(rawToken);
    if (!token || token.startsWith("dQw4w9WgXcQ:")) return null;

    try {
        const tiNative = (VencordNative?.pluginHelpers as any)?.TokenImporter;
        if (tiNative?.checkToken) {
            const res = await tiNative.checkToken(token);
            if (res?.valid && res?.user) {
                const u = res.user;
                return {
                    userId: u.id,
                    username: u.global_name || u.username,
                    avatar: u.avatar ? String(u.avatar).split("/").pop()?.split(".")[0] || null : null,
                    token
                };
            }
        }
    } catch {}

    try {
        const r = await fetch("https://discord.com/api/v9/users/@me", {
            headers: { Authorization: token },
            signal: AbortSignal.timeout(6000),
        });
        if (r.ok) {
            const d = await r.json();
            return {
                userId: d.id,
                username: d.global_name || d.username,
                avatar: d.avatar ? String(d.avatar).split("/").pop()?.split(".")[0] || null : null,
                token
            };
        }
    } catch {}

    return null;
}

let savedAccounts: GhostAccount[] = [];

// Récupère les comptes sauvegardés + scan local automatique des installations Discord
async function getAllSavedAccounts(): Promise<GhostAccount[]> {
    const combined = new Map<string, GhostAccount>();

    // 1. Lire les comptes de TokenImporter
    const tiAccsRaw = await DataStore.get<any[]>(TI_ACCOUNTS_KEY) ?? [];
    for (const a of tiAccsRaw) {
        const uid = a.id || a.userId;
        let tk = cleanToken(a.token);
        if (tk.startsWith("dQw4w9WgXcQ:")) {
            tk = await decryptToken(tk);
        }
        if (uid && tk && !tk.startsWith("dQw4w9WgXcQ:")) {
            combined.set(uid, {
                userId: uid,
                token: tk,
                username: a.username || "Ghost",
                avatar: a.avatar ? String(a.avatar).split("/").pop()?.split(".")[0] || null : null
            });
        }
    }

    // 2. Lire les comptes propres à GhostClient (anciennes et nouvelles clés)
    const gc1Accs = await DataStore.get<any[]>(DS_KEY_TOKENS) ?? [];
    const gc2Accs = await DataStore.get<any[]>("nightcord-ghost-v2-tokens") ?? [];
    for (const a of [...gc1Accs, ...gc2Accs]) {
        const uid = a.userId || a.id;
        let tk = cleanToken(a.token);
        if (tk.startsWith("dQw4w9WgXcQ:")) {
            tk = await decryptToken(tk);
        }
        if (uid && tk && !tk.startsWith("dQw4w9WgXcQ:")) {
            combined.set(uid, {
                userId: uid,
                token: tk,
                username: a.username || "Ghost",
                avatar: a.avatar ? String(a.avatar).split("/").pop()?.split(".")[0] || null : null
            });
        }
    }

    // 3. Scanner automatiquement les comptes Discord locaux (identique à TokenImporter)
    try {
        const tiNative = (VencordNative?.pluginHelpers as any)?.TokenImporter;
        if (tiNative?.findLocalTokens) {
            const localTokens: string[] = await tiNative.findLocalTokens().catch(() => []);
            if (Array.isArray(localTokens)) {
                for (const rawTok of localTokens) {
                    const decrypted = await decryptToken(rawTok);
                    if (!decrypted || decrypted.startsWith("dQw4w9WgXcQ:")) continue;

                    const alreadyPresent = Array.from(combined.values()).some(acc => acc.token === decrypted);
                    if (alreadyPresent) continue;

                    const verified = await validateToken(decrypted);
                    if (verified && verified.userId) {
                        combined.set(verified.userId, verified);
                    }
                }
            }
        }
    } catch (e) {
        console.error("[GhostClient] Auto-scan local tokens error:", e);
    }

    // Ne jamais inclure l'utilisateur actuel
    const myId = getMyId();
    if (myId) combined.delete(myId);

    const result = Array.from(combined.values());
    savedAccounts = result;
    DataStore.set(DS_KEY_TOKENS, result).catch(() => {});
    return result;
}

async function ghostDeactivate(userId: string) {
    ghostStates.delete(userId);
    notify();
    Native.leaveVoice(userId).catch(() => {});
}

async function ghostDisableClean(targetIds?: string[]): Promise<{ forcedIds: string[] }> {
    const ids = targetIds && targetIds.length > 0
        ? targetIds
        : Array.from(new Set([...ghostStates.keys(), ...savedAccounts.map(a => a.userId)]));
    if (!ids.length) return { forcedIds: [] };

    const curVoice = getMyVoiceState();
    const guildId = curVoice?.guildId;

    for (const userId of ids) {
        ghostStates.delete(userId);
    }
    notify();

    for (let i = 0; i < ids.length; i++) {
        const userId = ids[i];
        Native.leaveVoice(userId, guildId).catch(() => {});
        if (i < ids.length - 1 && ghostJoinDelay > 0) {
            await new Promise(r => setTimeout(r, ghostJoinDelay));
        }
    }

    return { forcedIds: [] };
}

// ─── Auto-follow ─────────────────────────────────────────────────────────────
let voiceUnsub: (() => void) | null = null;
let globalAutoFollow = false;
let myLastChannelId: string | null = null;
let _followDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function startFollowing() {
    if (voiceUnsub) return;
    globalAutoFollow = true;
    myLastChannelId = getMyVoiceState()?.channelId ?? null;

    const triggerFollow = () => {
        if (_followDebounceTimer !== null) clearTimeout(_followDebounceTimer);
        _followDebounceTimer = setTimeout(async () => {
            _followDebounceTimer = null;
            const curVoice = getMyVoiceState();
            const newCh: string | null = curVoice?.channelId ?? null;
            if (newCh === myLastChannelId) return;
            myLastChannelId = newCh;

            const accounts: GhostAccount[] = savedAccounts.length > 0 ? savedAccounts : (await getAllSavedAccounts());
            if (savedAccounts.length === 0 && accounts.length > 0) savedAccounts = accounts;

            const activeAccs = accounts.filter(a => ghostStates.get(a.userId)?.active === true || ghostStates.get(a.userId)?.connecting === true);
            if (!activeAccs.length) return;

            const guild: string = curVoice?.guildId ?? (newCh ? ChannelStore?.getChannel?.(newCh)?.guild_id ?? "" : "");

            for (let i = 0; i < activeAccs.length; i++) {
                const acc = activeAccs[i];
                if (newCh) {
                    let realToken = acc.token;
                    try { realToken = await decryptToken(acc.token); } catch {}
                    ghostStates.set(acc.userId, { ...(ghostStates.get(acc.userId) ?? defaultState()), connecting: true });
                    notify();
                    Native.connectGhost(acc.userId, realToken, guild, newCh, ghostMicLabel)
                        .then(result => {
                            ghostStates.set(acc.userId, { ...(ghostStates.get(acc.userId) ?? defaultState()), active: result.ok, connecting: false, error: result.ok ? null : (result.error ?? "Error") });
                            notify();
                        })
                        .catch(e => {
                            ghostStates.set(acc.userId, { ...(ghostStates.get(acc.userId) ?? defaultState()), active: false, connecting: false, error: String(e) });
                            notify();
                        });
                } else {
                    Native.leaveVoice(acc.userId).catch(() => {});
                    ghostStates.set(acc.userId, defaultState());
                    notify();
                }
                if (i < activeAccs.length - 1 && ghostJoinDelay > 0) {
                    await new Promise(r => setTimeout(r, ghostJoinDelay));
                }
            }
        }, 30);
    };

    const handler = (data: any) => {
        if (!data) return;
        const myId = getMyId();
        if (data.channelId !== undefined) {
            triggerFollow();
            return;
        }
        let statesList: any[] = [];
        try {
            if (data?.voiceStates != null) statesList = Array.isArray(data.voiceStates) ? data.voiceStates : Array.from(data.voiceStates as any);
            else if (data?.userId != null) statesList = [data];
        } catch { statesList = []; }
        const myState = statesList.find((s: any) => s.userId === myId);
        if (!myState) return;
        triggerFollow();
    };

    FluxDispatcher?.subscribe?.("VOICE_CHANNEL_SELECT", triggerFollow);
    FluxDispatcher?.subscribe?.("VOICE_STATE_UPDATES", handler);
    FluxDispatcher?.subscribe?.("VOICE_STATE_UPDATE", handler);
    FluxDispatcher?.subscribe?.("RTC_CONNECTION_STATE", triggerFollow);

    voiceUnsub = () => {
        FluxDispatcher?.unsubscribe?.("VOICE_CHANNEL_SELECT", triggerFollow);
        FluxDispatcher?.unsubscribe?.("VOICE_STATE_UPDATES", handler);
        FluxDispatcher?.unsubscribe?.("VOICE_STATE_UPDATE", handler);
        FluxDispatcher?.unsubscribe?.("RTC_CONNECTION_STATE", triggerFollow);
        if (_followDebounceTimer !== null) { clearTimeout(_followDebounceTimer); _followDebounceTimer = null; }
        myLastChannelId = null;
    };
}

function stopFollowing() {
    globalAutoFollow = false;
    voiceUnsub?.();
    voiceUnsub = null;
}

// ─── Stream Poller ───────────────────────────────────────────────────────────
function useStreamPoller(userId: string | null, active: boolean) {
    const [status, setStatus] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!active || !userId) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            return;
        }
        pollRef.current = setInterval(async () => {
            try {
                const r = await fetch("http://127.0.0.1:47821/stream-status", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId }),
                });
                const d = await r.json();
                if (d.state === "resolving") setStatus(t("Resolving stream URL..."));
                else if (d.state === "starting") setStatus(t("Starting stream..."));
                else if (d.state === "active") { setStatus(t("Stream active")); if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }
                else if (d.state === "error") { setStatus(`${t("Stream error: ")}${d.error ?? "unknown"}`); if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }
                else if (d.state === "idle") { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }
            } catch {}
        }, 800);
        return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    }, [userId, active]);

    return [status, setStatus] as const;
}

// ─── Dropdown Component ──────────────────────────────────────────────────────
function Dropdown({ icon, label, value, options, onChange }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    options: Array<{ value: string; label: string; avatar?: string | null; userId?: string; }>;
    onChange: (v: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [listStyle, setListStyle] = useState<React.CSSProperties>({});
    const btnRef = useRef<HTMLButtonElement>(null);
    const selected = options.find(o => o.value === value);

    useEffect(() => {
        const h = (e: MouseEvent) => {
            const tgt = e.target as HTMLElement;
            if (!tgt || !document.body.contains(tgt)) return;
            if (!tgt.closest(".gc-dropdown-wrap") && !tgt.closest(".gc-dropdown-list")) setOpen(false);
        };
        if (open) {
            const timer = setTimeout(() => document.addEventListener("mousedown", h), 10);
            return () => { clearTimeout(timer); document.removeEventListener("mousedown", h); };
        }
    }, [open]);

    function openDropdown(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!btnRef.current) { setOpen(v => !v); return; }
        const rect = btnRef.current.getBoundingClientRect();
        const listH = Math.min(200, options.length * 40);
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;
        let top = (spaceBelow >= listH || spaceBelow >= spaceAbove) ? rect.bottom + 4 : rect.top - listH - 4;
        top = Math.max(8, Math.min(top, window.innerHeight - listH - 8));
        setListStyle({ top, left: rect.left, width: rect.width });
        setOpen(v => !v);
    }

    return (
        <div className="gc-dropdown-wrap">
            <div className="gc-dropdown-label">{icon}<span>{label}</span></div>
            <button ref={btnRef} className={`gc-dropdown-btn ${open ? "gc-dropdown-btn--open" : ""}`} onClick={openDropdown}>
                <div className="gc-dropdown-selected">
                    {selected?.avatar !== undefined && (selected.avatar
                        ? <img src={avatarUrl(selected.userId!, selected.avatar)} className="gc-dropdown-avatar" alt="" />
                        : <div className="gc-dropdown-avatar-placeholder">{selected.label[0]?.toUpperCase()}</div>)}
                    <span className="gc-dropdown-selected-label">{selected?.label ?? "—"}</span>
                </div>
                <ChevronIcon />
            </button>
            {open && (
                <div className="gc-dropdown-list" style={listStyle}>
                    {options.map(opt => (
                        <div
                            key={opt.value}
                            className={`gc-dropdown-item ${opt.value === value ? "gc-dropdown-item--selected" : ""}`}
                            onMouseDown={e => { e.preventDefault(); onChange(opt.value); setOpen(false); }}
                        >
                            {opt.avatar !== undefined && (opt.avatar
                                ? <img src={avatarUrl(opt.userId!, opt.avatar)} className="gc-dropdown-avatar" alt="" />
                                : <div className="gc-dropdown-avatar-placeholder">{opt.label[0]?.toUpperCase()}</div>)}
                            <span className="gc-dropdown-item-label">{opt.label}</span>
                            {opt.value === value && <span className="gc-dropdown-check"><CheckIcon /></span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Contrôles rapides par compte ─────────────────────────────────────────────
function TokenControls({ acc, state }: { acc: GhostAccount; state: GhostState }) {
    const [busy, setBusy] = useState<string | null>(null);

    async function toggle(action: "mute" | "deafen" | "stream" | "camera") {
        if (busy) return;
        setBusy(action);
        try {
            const cur = ghostStates.get(acc.userId) ?? defaultState();
            if (action === "mute") {
                const next = !cur.muted;
                await Native.setMute(acc.userId, next);
                ghostStates.set(acc.userId, { ...cur, muted: next });
            } else if (action === "deafen") {
                const next = !cur.deafened;
                await Native.setDeafen(acc.userId, next);
                ghostStates.set(acc.userId, { ...cur, deafened: next });
            } else if (action === "stream") {
                const next = !cur.streaming;
                await Native.setStream(acc.userId, next);
                ghostStates.set(acc.userId, { ...cur, streaming: next });
            } else if (action === "camera") {
                const next = !cur.camera;
                await Native.setCamera(acc.userId, next);
                ghostStates.set(acc.userId, { ...cur, camera: next });
            }
            notify();
        } catch {}
        setBusy(null);
    }

    return (
        <>
            <button
                className={`gc-ctrl-btn ${state.muted ? "gc-ctrl-btn--muted" : ""}`}
                title={state.muted ? t("Unmute") : t("Mute")}
                onClick={() => toggle("mute")}
                disabled={!!busy}
            >
                {state.muted ? <MicOffIcon /> : <MicIcon />}
            </button>
            <button
                className={`gc-ctrl-btn ${state.deafened ? "gc-ctrl-btn--deafened" : ""}`}
                title={state.deafened ? t("Undeafen") : t("Deafen")}
                onClick={() => toggle("deafen")}
                disabled={!!busy}
            >
                {state.deafened ? <DeafenIcon /> : <UndeafenIcon />}
            </button>
            <button
                className={`gc-ctrl-btn ${state.streaming ? "gc-ctrl-btn--streaming" : ""}`}
                title={state.streaming ? t("Stop stream") : t("Start stream")}
                onClick={() => toggle("stream")}
                disabled={!!busy}
            >
                <StreamIcon />
            </button>
            <button
                className={`gc-ctrl-btn ${state.camera ? "gc-ctrl-btn--cam" : ""}`}
                title={state.camera ? t("Turn off camera") : t("Turn on camera")}
                onClick={() => toggle("camera")}
                disabled={!!busy}
            >
                <CamIcon />
            </button>
        </>
    );
}

// ─── Popover Principal ────────────────────────────────────────────────────────
function GhostPopover({ onClose, anchorRect }: { onClose: () => void; anchorRect: DOMRect | null; }) {
    const [accounts, setAccounts] = useState<GhostAccount[]>([]);
    const [selectedId, setSelectedId] = useState<string>("all");
    const [autoFollow, setAutoFollowState] = useState(globalAutoFollow);
    const [micLabel, setMicLabel] = useState(ghostMicLabel);
    const [joinDelay, setJoinDelay] = useState(ghostJoinDelay);
    const [volumeMultiplier, setVolumeMultiplier] = useState(ghostVolumeMultiplier);
    const [dshowDevices, setDshowDevices] = useState<string[]>([]);
    const [streamingUserId, setStreamingUserId] = useState<string | null>(null);
    const [streamInput, setStreamInput] = useState("");
    const [isPolling, setIsPolling] = useState(false);
    const [serverInstalled, setServerInstalled] = useState<boolean>(true);
    const [streamStatus, setStreamStatusDirect] = useState<string | null>(null);
    const [pollStatus, setPollStatus] = useStreamPoller(streamingUserId, isPolling);
    const states = useGhostStates();
    const popoverRef = useRef<HTMLDivElement>(null);

    const displayStatus = isPolling ? pollStatus : streamStatus;
    function setStreamStatus(msg: string | null) {
        setStreamStatusDirect(msg);
        if (!msg) setPollStatus(null);
    }

    const style = React.useMemo<React.CSSProperties>(() => {
        if (!anchorRect) return { position: "fixed", bottom: 60, left: 8, zIndex: 2147483647 };
        const PW = 480, margin = 10;
        let left = anchorRect.left;
        if (left + PW > window.innerWidth - margin) left = window.innerWidth - PW - margin;
        if (left < margin) left = margin;

        const bottom = Math.max(margin, window.innerHeight - anchorRect.top + 8);
        const maxHeight = Math.max(260, anchorRect.top - 16);
        return {
            position: "fixed",
            left,
            bottom,
            maxHeight,
            zIndex: 2147483647
        };
    }, [anchorRect]);

    useEffect(() => {
        Native.isServerInstalled().then(v => setServerInstalled(Boolean(v))).catch(() => setServerInstalled(true));

        getAllSavedAccounts().then(async v => {
            setAccounts(v);
            savedAccounts = v;
            for (const acc of v) {
                const info = await validateToken(acc.token);
                const cur = ghostStates.get(acc.userId) ?? defaultState();
                if (info) {
                    if (cur.error && (cur.error.toLowerCase().includes("invalid token") || cur.error.toLowerCase().includes("token invalide"))) {
                        ghostStates.set(acc.userId, { ...cur, error: null });
                    }
                }
            }
            notify();
        });

        DataStore.get(DS_KEY_AUTO_FOLLOW).then((v: boolean | null) => {
            const f = v ?? true;
            setAutoFollowState(f);
            if (f) startFollowing();
        });

        DataStore.get(DS_KEY_SELECTED).then((v: string | null) => {
            if (v) setSelectedId(v);
        });

        DataStore.get(DS_KEY_JOIN_DELAY).then((v: number | null) => {
            if (v != null) { setJoinDelay(v); ghostJoinDelay = v; }
        });

        DataStore.get(DS_KEY_VOLUME).then((v: number | null) => {
            if (v != null) {
                setVolumeMultiplier(v);
                ghostVolumeMultiplier = v;
                Native.setVolume(v).catch(() => {});
            }
        });

        Native.listAudioInputDevices().catch(() => []).then(async (devs: any[]) => {
            const names = (devs as any[])?.map((d: any) => d.dshowName ?? d.name ?? d.label ?? "").filter(Boolean) ?? [];
            if (names.length) {
                setDshowDevices(names);
                const savedMic = await DataStore.get(DS_KEY_MIC_DEVICE);
                if (!savedMic || savedMic === "default") {
                    const virtualMic = names.find((n: string) =>
                        n.toLowerCase().includes("cable output") ||
                        n.toLowerCase().includes("vb-audio virtual cable") ||
                        n.toLowerCase().includes("cable")
                    );
                    if (virtualMic) {
                        setMicLabel(virtualMic);
                        ghostMicLabel = virtualMic;
                        DataStore.set(DS_KEY_MIC_DEVICE, virtualMic);
                        Native.setMicDevice(virtualMic).catch(() => {});
                    }
                } else {
                    setMicLabel(savedMic as string);
                    ghostMicLabel = savedMic as string;
                    Native.setMicDevice(savedMic as string).catch(() => {});
                }
            }
        }).catch(() => {});
    }, []);

    async function saveAccounts(next: GhostAccount[]) {
        setAccounts(next);
        savedAccounts = next;
        await DataStore.set(DS_KEY_TOKENS, next);
    }

    function toggleAutoFollow(v: boolean) {
        setAutoFollowState(v);
        DataStore.set(DS_KEY_AUTO_FOLLOW, v);
        if (v) startFollowing(); else stopFollowing();
    }

    async function startStream(url: string, userId: string) {
        if (!url.trim()) return;
        setStreamStatus(t("Sending stream request..."));
        setIsPolling(false);
        try {
            const r = await fetch("http://127.0.0.1:47821/stream-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, url: url.trim() }),
                signal: AbortSignal.timeout(5000),
            });
            const d = await r.json();
            if (!d.ok) {
                setStreamStatus(`${t("Stream error: ")}${d.error ?? "unknown"}`);
                setIsPolling(false);
            } else {
                setStreamStatusDirect(null);
                setIsPolling(true);
            }
        } catch (e: any) {
            setStreamStatus(`${t("Companion server unreachable: ")}${e?.message ?? String(e)}`);
            setIsPolling(false);
        }
    }

    const accountOptions = [
        { value: "all", label: t("All accounts"), avatar: undefined },
        ...accounts.map(a => ({ value: a.userId, label: a.username, avatar: a.avatar, userId: a.userId }))
    ];
    const micOptions = [
        { value: "default", label: t("Default microphone") },
        ...dshowDevices.map(d => ({ value: d, label: d }))
    ];

    return (
        <div ref={popoverRef} className="gc-popover" style={style}>
            <div className="gc-popover-header">
                <GhostIcon width={16} height={16} />
                <span className="gc-popover-title">{t("Ghost Accounts")}</span>
                <button
                    className="gc-header-action"
                    title={t("Open GhostInstaller")}
                    onClick={() => {
                        onClose();
                        SettingsRouter.openUserSettings("nightcord_ghost_client_installer_panel");
                    }}
                >
                    <SettingsGearIcon />
                </button>
                <button className="gc-popover-close" onClick={onClose} title={t("Close")}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
                </button>
            </div>

            <div className="gc-popover-body">
                {/* Server alert banner */}
                {!serverInstalled && (
                    <div className="gc-server-alert">
                        <div className="gc-server-alert-title">{t("Companion Server Required")}</div>
                        <div className="gc-server-alert-desc">{t("The background ghost-server is required to connect voice and stream audio.")}</div>
                        <button
                            className="gc-server-install-btn"
                            onClick={() => {
                                onClose();
                                SettingsRouter.openUserSettings("nightcord_ghost_client_installer_panel");
                            }}
                        >
                            {t("Open Installer")}
                        </button>
                    </div>
                )}

                {/* Dropdowns */}
                <Dropdown
                    icon={<UserIcon />}
                    label={t("Active account")}
                    value={selectedId}
                    options={accountOptions}
                    onChange={v => {
                        if (v !== "all" && v === getMyId()) {
                            Toasts.show({ message: t("You cannot connect your own account as a ghost"), type: Toasts.Type.FAILURE, id: Toasts.genId() });
                            return;
                        }
                        setSelectedId(v);
                        DataStore.set(DS_KEY_SELECTED, v);
                    }}
                />
                <Dropdown
                    icon={<MicIcon />}
                    label={t("Source microphone")}
                    value={micLabel}
                    options={micOptions}
                    onChange={v => {
                        setMicLabel(v);
                        ghostMicLabel = v;
                        DataStore.set(DS_KEY_MIC_DEVICE, v);
                        Native.setMicDevice(v).catch(() => {});
                    }}
                />

                <div className="gc-popover-divider" />

                {/* Auto-follow toggle */}
                <div className="gc-follow-row" onClick={() => toggleAutoFollow(!autoFollow)}>
                    <div className="gc-follow-info">
                        <span className="gc-follow-title">{t("Automatic voice tracking")}</span>
                        <span className="gc-follow-sub">{t("Ghosts join your channel in real time")}</span>
                    </div>
                    <div className={`gc-toggle ${autoFollow ? "gc-toggle--on" : ""}`}><div className="gc-toggle-thumb" /></div>
                </div>

                {/* Join delay */}
                <div className="gc-delay-row">
                    <div className="gc-delay-info">
                        <span className="gc-delay-title"><TimerIcon /> {t("Join delay")}</span>
                        <span className="gc-delay-sub">{t("Delay between each token connection")}</span>
                    </div>
                    <div className="gc-delay-ctrl">
                        <button className="gc-delay-btn" onClick={() => {
                            const v = Math.max(0, joinDelay - 100);
                            setJoinDelay(v); ghostJoinDelay = v; DataStore.set(DS_KEY_JOIN_DELAY, v);
                        }}>−</button>
                        <span className="gc-delay-val">{joinDelay}ms</span>
                        <button className="gc-delay-btn" onClick={() => {
                            const v = Math.min(5000, joinDelay + 100);
                            setJoinDelay(v); ghostJoinDelay = v; DataStore.set(DS_KEY_JOIN_DELAY, v);
                        }}>+</button>
                    </div>
                </div>

                {/* Volume Booster */}
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                    padding: "9px 11px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1.5px solid rgba(255,255,255,0.06)",
                    borderRadius: 6,
                    boxSizing: "border-box"
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div className="gc-delay-info">
                            <span className="gc-delay-title"><VolumeIcon /> {t("Volume Booster")}</span>
                            <span className="gc-delay-sub">{t("Radically amplifies or lowers selected device volume")}</span>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: volumeMultiplier > 1 ? "#faa61a" : "#fff", minWidth: 44, textAlign: "right" }}>
                            {Math.round(volumeMultiplier * 100)}%
                        </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                            type="range"
                            min="0"
                            max="500"
                            step="5"
                            value={Math.round(volumeMultiplier * 100)}
                            onChange={e => {
                                const val = Number(e.target.value) / 100;
                                setVolumeMultiplier(val);
                                ghostVolumeMultiplier = val;
                                DataStore.set(DS_KEY_VOLUME, val);
                                Native.setVolume(val).catch(() => {});
                            }}
                            style={{
                                flex: 1,
                                height: 6,
                                borderRadius: 3,
                                cursor: "pointer",
                                accentColor: "#5865f2",
                                background: "rgba(255,255,255,0.15)",
                            }}
                        />
                        <button
                            className="gc-delay-btn"
                            title={t("Reset volume")}
                            style={{ width: "auto", padding: "2px 8px", fontSize: 11 }}
                            onClick={() => {
                                setVolumeMultiplier(1.0);
                                ghostVolumeMultiplier = 1.0;
                                DataStore.set(DS_KEY_VOLUME, 1.0);
                                Native.setVolume(1.0).catch(() => {});
                            }}
                        >
                            {t("Reset")}
                        </button>
                    </div>
                </div>

                <div className="gc-popover-divider" />

                {/* Accounts list header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div className="gc-section-label">{t("Accounts (Native + Imported)")}</div>
                    <button
                        style={{ background: "none", border: "none", color: "#5865f2", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: "2px 4px" }}
                        onClick={async () => {
                            Toasts.show({ message: t("Checking tokens..."), type: Toasts.Type.INFO, id: Toasts.genId() });
                            let ok = 0;
                            const refreshed = await getAllSavedAccounts();
                            setAccounts(refreshed);
                            for (const acc of refreshed) {
                                const v = await validateToken(acc.token);
                                const cur = ghostStates.get(acc.userId) ?? defaultState();
                                if (v) {
                                    ghostStates.set(acc.userId, { ...cur, error: null });
                                    ok++;
                                } else {
                                    ghostStates.set(acc.userId, { ...cur, error: "Invalid token" });
                                }
                                notify();
                            }
                            Toasts.show({ message: `${ok}/${refreshed.length} ${t("tokens verified valid")}`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                        }}
                    >
                        {t("Re-verify")}
                    </button>
                </div>

                {/* Batch controls */}
                {accounts.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
                        <button
                            className="gc-batch-btn"
                            title={t("Mute / Unmute all tokens")}
                            onClick={async () => {
                                const anyMuted = accounts.some(a => ghostStates.get(a.userId)?.muted);
                                const next = !anyMuted;
                                const ids = accounts.map(a => a.userId);
                                Native.setMuteAll(ids, next).catch(() => {});
                                for (const a of accounts) {
                                    const cur = ghostStates.get(a.userId) ?? defaultState();
                                    ghostStates.set(a.userId, { ...cur, muted: next });
                                }
                                notify();
                            }}
                        >
                            {accounts.some(a => ghostStates.get(a.userId)?.muted) ? t("Unmute All") : t("Mute All")}
                        </button>
                        <button
                            className="gc-batch-btn"
                            title={t("Deafen / Undeafen all tokens")}
                            onClick={async () => {
                                const anyDeaf = accounts.some(a => ghostStates.get(a.userId)?.deafened);
                                const next = !anyDeaf;
                                const ids = accounts.map(a => a.userId);
                                Native.setDeafenAll(ids, next).catch(() => {});
                                for (const a of accounts) {
                                    const cur = ghostStates.get(a.userId) ?? defaultState();
                                    ghostStates.set(a.userId, { ...cur, deafened: next });
                                }
                                notify();
                            }}
                        >
                            {accounts.some(a => ghostStates.get(a.userId)?.deafened) ? t("Undeaf All") : t("Deafen All")}
                        </button>
                        <button
                            className="gc-batch-btn"
                            title={t("Start / Stop stream for all tokens")}
                            onClick={async () => {
                                const anyStream = accounts.some(a => ghostStates.get(a.userId)?.streaming);
                                const next = !anyStream;
                                const ids = accounts.map(a => a.userId);
                                Native.setStreamAll(ids, next).catch(() => {});
                                for (const a of accounts) {
                                    const cur = ghostStates.get(a.userId) ?? defaultState();
                                    ghostStates.set(a.userId, { ...cur, streaming: next });
                                }
                                notify();
                            }}
                        >
                            {accounts.some(a => ghostStates.get(a.userId)?.streaming) ? t("Stop All") : t("Stream All")}
                        </button>
                        <button
                            className="gc-batch-btn"
                            title={t("Turn on / off camera for all tokens")}
                            onClick={async () => {
                                const anyCam = accounts.some(a => ghostStates.get(a.userId)?.camera);
                                const next = !anyCam;
                                const ids = accounts.map(a => a.userId);
                                Native.setCameraAll(ids, next).catch(() => {});
                                for (const a of accounts) {
                                    const cur = ghostStates.get(a.userId) ?? defaultState();
                                    ghostStates.set(a.userId, { ...cur, camera: next });
                                }
                                notify();
                            }}
                        >
                            {accounts.some(a => ghostStates.get(a.userId)?.camera) ? t("Cam Off All") : t("Cam All")}
                        </button>
                    </div>
                )}

                {/* Accounts list */}
                <div className="gc-accounts">
                    {accounts.length === 0 && (
                        <div className="gc-empty">
                            {t("No accounts — tokens are automatically scanned from local Discord clients or imported from TokenImporter.")}
                        </div>
                    )}
                    {accounts.map(acc => {
                        const state = states.get(acc.userId) ?? defaultState();
                        const isActive = state.active;
                        const isConnecting = state.connecting;
                        const isStreaming = streamingUserId === acc.userId;
                        return (
                            <div key={acc.userId} className={`gc-account ${isActive ? "gc-account--on" : ""}`}>
                                <div className="gc-account-left">
                                    <div className="gc-avatar-wrap">
                                        <img src={avatarUrl(acc.userId, acc.avatar)} className="gc-avatar" alt="" />
                                        <div className={`gc-status-dot ${isStreaming ? "gc-dot--stream" : isActive ? "gc-dot--voice" : isConnecting ? "gc-dot--connecting" : "gc-dot--off"}`} />
                                    </div>
                                    <div className="gc-account-info">
                                        <span className="gc-account-name" title={acc.username}>{acc.username}</span>
                                        <span className="gc-account-status">
                                            {isConnecting
                                                ? t("Connecting to voice...")
                                                : state.streaming
                                                    ? t("Streaming")
                                                    : state.camera
                                                        ? t("Camera on")
                                                        : isStreaming
                                                            ? t("Stream active")
                                                            : isActive
                                                                ? t("Active in voice")
                                                                : state.error
                                                                    ? `${t("Error: ")}${state.error.slice(0, 35)}`
                                                                    : t("Disconnected")}
                                        </span>
                                    </div>
                                </div>
                                <div className="gc-account-actions">
                                    <TokenControls acc={acc} state={state} />
                                    {isActive && (
                                        <button
                                            className={`gc-btn-video ${isStreaming ? "gc-btn-video--on" : ""}`}
                                            title={isStreaming ? t("Stop stream") : t("Start video stream")}
                                            onClick={async () => {
                                                if (isStreaming) {
                                                    setIsPolling(false);
                                                    setStreamStatus(t("Stopping..."));
                                                    await fetch("http://127.0.0.1:47821/stream-stop", {
                                                        method: "POST",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({ userId: acc.userId }),
                                                    }).catch(() => {});
                                                    setStreamingUserId(null);
                                                    setStreamStatus(null);
                                                } else {
                                                    setStreamingUserId(acc.userId);
                                                    setStreamInput("");
                                                    setStreamStatus(null);
                                                    setIsPolling(false);
                                                }
                                            }}
                                        >
                                            <VideoIcon />
                                        </button>
                                    )}
                                    <button
                                        className="gc-btn-del"
                                        title={t("Delete account")}
                                        onClick={async () => {
                                            await ghostDeactivate(acc.userId);
                                            await saveAccounts(accounts.filter(a => a.userId !== acc.userId));
                                        }}
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Video stream modal inline input */}
                {streamingUserId && (() => {
                    const acc = accounts.find(a => a.userId === streamingUserId);
                    if (!acc) return null;
                    return (
                        <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: ".06em" }}>
                                {t("Stream for")} {acc.username}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                                <input
                                    className="gc-input"
                                    style={{ flex: 1, fontSize: 12, fontFamily: "monospace" }}
                                    placeholder={t("YouTube, MP4, M3U8...")}
                                    value={streamInput}
                                    onChange={e => setStreamInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter" && streamInput.trim()) startStream(streamInput, streamingUserId); }}
                                />
                                <button
                                    className="gc-add-btn"
                                    style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                                    disabled={!streamInput.trim() || isPolling}
                                    onClick={() => startStream(streamInput, streamingUserId)}
                                >
                                    {isPolling ? t("Starting...") : t("Start")}
                                </button>
                                <button
                                    style={{ background: "rgba(237,66,69,.1)", border: "none", borderRadius: 6, color: "#ed4245", padding: "4px 8px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}
                                    onClick={() => { setStreamingUserId(null); setIsPolling(false); setStreamStatus(null); }}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
                                </button>
                            </div>
                            {displayStatus && (
                                <div style={{ fontSize: 11, color: displayStatus.toLowerCase().includes("error") || displayStatus.toLowerCase().includes("unreachable") ? "#ed4245" : displayStatus.toLowerCase().includes("active") ? "#3ba55c" : "rgba(255,255,255,0.6)" }}>
                                    {displayStatus}
                                </div>
                            )}
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>{t("YouTube, MP4 direct, M3U8, Twitch (requires yt-dlp)")}</div>
                        </div>
                    );
                })()}

                {/* TokenImporter helper notice text (replaces manual token textarea) */}
                <div className="gc-popover-divider" />
                <div style={{
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.05)"
                }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.4 }}>
                        {t("Manage and add accounts from the TokenImporter plugin.")}
                    </span>
                    <button
                        className="gc-batch-btn"
                        style={{ whiteSpace: "nowrap", flexShrink: 0, padding: "4px 8px" }}
                        onClick={() => {
                            onClose();
                            SettingsRouter.openUserSettings("nightcord_plugins_panel");
                        }}
                    >
                        TokenImporter
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── UserArea Button Component ────────────────────────────────────────────────
const GhostUserAreaButton = ({ iconForeground, hideTooltips, nameplate }: any) => {
    const states = useGhostStates();
    const [showPopover, setShowPopover] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const btnRef = useRef<HTMLDivElement>(null);
    const anyActive = Array.from(states.values()).some(s => s.active || s.connecting);

    useEffect(() => {
        if (!showPopover) return;
        const handler = (e: MouseEvent) => {
            const tgt = e.target as HTMLElement;
            if (tgt.closest(".gc-popover")) return;
            if (btnRef.current?.contains(tgt)) return;
            setShowPopover(false);
        };
        const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
        return () => { clearTimeout(timer); document.removeEventListener("mousedown", handler); };
    }, [showPopover]);

    async function handleLeftClick() {
        const isInstalled = await Native.isServerInstalled().catch(() => true);
        if (!isInstalled) {
            Toasts.show({ message: t("GhostClient companion server is not installed. Open GhostInstaller to install it."), type: Toasts.Type.FAILURE, id: Toasts.genId() });
            openPopover();
            return;
        }

        const storedAccounts = await getAllSavedAccounts();
        const storedSelected = await DataStore.get(DS_KEY_SELECTED) as string | null ?? "all";
        const myId = getMyId();
        const filteredAccounts = storedAccounts.filter(a => a.userId !== myId);
        const targets = storedSelected === "all" ? filteredAccounts : filteredAccounts.filter(a => a.userId === storedSelected);

        if (targets.length === 0) {
            if (storedSelected !== "all" && storedSelected === myId) {
                Toasts.show({ message: t("You cannot connect your own account as a ghost"), type: Toasts.Type.FAILURE, id: Toasts.genId() });
            }
            openPopover();
            return;
        }

        const vs = getMyVoiceState();
        const anyActiveNow = targets.some(a => {
            if (ghostStates.get(a.userId)?.active || ghostStates.get(a.userId)?.connecting) return true;
            try {
                const userVs = VoiceStateStore?.getVoiceStateForUser?.(a.userId);
                if (userVs?.channelId) return true;
            } catch {}
            return false;
        });

        if (anyActiveNow) {
            await ghostDisableClean(targets.map(a => a.userId));
        } else {
            if (!vs?.channelId) {
                Toasts.show({ message: t("Join a voice channel first"), type: Toasts.Type.FAILURE, id: Toasts.genId() });
                return;
            }
            for (let i = 0; i < targets.length; i++) {
                const acc = targets[i];
                let realToken = acc.token;
                try { realToken = await decryptToken(acc.token); } catch {}
                ghostStates.set(acc.userId, { ...defaultState(), connecting: true });
                notify();
                try {
                    const result = await Native.connectGhost(acc.userId, realToken, vs.guildId, vs.channelId, ghostMicLabel);
                    ghostStates.set(acc.userId, {
                        ...defaultState(),
                        active: result.ok,
                        error: result.ok ? null : (result.error ?? t("Connection error"))
                    });
                } catch (e) {
                    ghostStates.set(acc.userId, { ...defaultState(), error: String(e) });
                }
                notify();
                if (i < targets.length - 1 && ghostJoinDelay > 0) {
                    await new Promise(r => setTimeout(r, ghostJoinDelay));
                }
            }
        }
    }

    function openPopover() {
        const rect = btnRef.current?.getBoundingClientRect() ?? null;
        setAnchorRect(rect);
        setShowPopover(v => !v);
    }

    return (
        <div ref={btnRef} style={{ position: "relative" }}>
            <UserAreaButton
                tooltipText={hideTooltips ? undefined : t("GhostClient — left-click: enable/disable | right-click: settings & controls")}
                icon={<GhostIcon className={`${iconForeground} ${anyActive ? "gc-icon--active" : ""}`} />}
                plated={nameplate != null}
                redGlow={false}
                onClick={handleLeftClick}
                onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); openPopover(); }}
            />
            {showPopover && (ReactDOM as any).createPortal(
                <GhostPopover onClose={() => setShowPopover(false)} anchorRect={anchorRect} />,
                document.body
            )}
        </div>
    );
};

// ─── Plugin Definition ────────────────────────────────────────────────────────
export default definePlugin({
    name: "GhostClient",
    description: "Discord ghost accounts — left-click to enable/disable, right-click to configure. Mute/deafen/stream/cam controls per token.",
    authors: [{ name: "Nightcord", id: 0n }],
    enabledByDefault: false,
    userPlugin: true as any,
    isUserPlugin: true as any,
    userAreaButton: { icon: GhostIcon, render: GhostUserAreaButton, priority: 1 },

    async start() {
        const autoFollow = await DataStore.get(DS_KEY_AUTO_FOLLOW);
        if (autoFollow === true) startFollowing();

        const mic = await DataStore.get(DS_KEY_MIC_DEVICE);
        if (mic && mic !== "default") ghostMicLabel = mic;
        else {
            Native.listAudioInputDevices().catch(() => []).then((devs: any[]) => {
                const names = (devs as any[])?.map((d: any) => d.dshowName ?? d.name ?? d.label ?? "").filter(Boolean) ?? [];
                const virtualMic = names.find((n: string) =>
                    n.toLowerCase().includes("cable output") ||
                    n.toLowerCase().includes("vb-audio virtual cable") ||
                    n.toLowerCase().includes("cable")
                );
                if (virtualMic) {
                    ghostMicLabel = virtualMic;
                    DataStore.set(DS_KEY_MIC_DEVICE, virtualMic);
                }
            }).catch(() => {});
        }

        const delay = await DataStore.get(DS_KEY_JOIN_DELAY);
        if (delay != null) ghostJoinDelay = delay;

        const vol = await DataStore.get(DS_KEY_VOLUME);
        if (vol != null) {
            ghostVolumeMultiplier = vol;
            Native.setVolume(vol).catch(() => {});
        }

        const allAccs = await getAllSavedAccounts();
        if (allAccs.length > 0) savedAccounts = allAccs;

        setTimeout(() => {
            Native.init().catch(() => {});
            (async () => {
                if (savedAccounts.length === 0) return;
                for (const acc of savedAccounts) {
                    Native.preConnectGhost(acc.userId, acc.token, ghostMicLabel).catch(() => {});
                    await new Promise(r => setTimeout(r, 800));
                }
            })();
        }, 1500);

        try {
            if (typeof (VencordNative as any)?.ipc?.on === "function") {
                (VencordNative as any).ipc.on("ghost-client-disconnected", (_: any, userId: string, code: number, reason: string) => {
                    ghostStates.set(userId, { ...defaultState(), error: `Disconnected (${code})` });
                    notify();
                });
            }
        } catch {}
    },

    stop() {
        ghostDisableClean();
        stopFollowing();
    },
});
