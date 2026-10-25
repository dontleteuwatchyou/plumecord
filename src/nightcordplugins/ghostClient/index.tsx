/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { isPluginEnabled } from "@api/PluginManager";
import { DataStore } from "@api/index";
import { UserAreaButton as RawUserAreaButton } from "@api/UserArea";
import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { ModalCloseButton } from "@utils/modal";
import definePlugin, { PluginNative } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { React, ReactDOM, Toasts, useState, useEffect, useRef, useCallback, SettingsRouter, Slider, Select, Text, Tooltip } from "@webpack/common";
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
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const GuildStore = findStoreLazy("GuildStore");
const FluxDispatcher = findByPropsLazy("dispatch", "subscribe");
const UserStore = findStoreLazy("UserStore");

const DS_KEY_TOKENS = "nightcord-ghost-tokens";
const DS_KEY_AUTO_FOLLOW = "nightcord-ghost-autofollow";
const DS_KEY_MIC_DEVICE = "nightcord-ghost-mic-device-label";
const DS_KEY_SELECTED = "nightcord-ghost-selected";
const DS_KEY_JOIN_DELAY = "nightcord-ghost-join-delay";
const DS_KEY_VOLUME = "nightcord-ghost-volume-booster";
const DS_KEY_VOCAL_BOOST = "nightcord-ghost-vocal-boost";
const DS_KEY_EQ_BASS = "nightcord-ghost-eq-bass";
const DS_KEY_EQ_TREBLE = "nightcord-ghost-eq-treble";
const DS_KEY_EQ_MID = "nightcord-ghost-eq-mid";
const DS_KEY_EQ_ENABLED = "nightcord-ghost-eq-enabled";
const DS_KEY_SHOW_EQ = "nightcord-ghost-show-eq";

const DS_KEY_SHOW_AMP_PAN = "nightcord-ghost-show-amp-pan";
const DS_KEY_AMP_CONFIG = "nightcord-ghost-amp-config";
const DS_KEY_CUSTOM_PANS = "nightcord-ghost-custom-pans";
const DS_KEY_CUSTOM_OPUS = "nightcord-ghost-custom-opus";

let ghostShowAmpPan: boolean = false;
let ghostAmpConfig: any = null;

const STEREO_MODES = [
    "BetterDiscord Stereo", "Lightcord Stereo", "Ethercord Stereo",
    "Dream Stereo", "PxCord Stereo", "Justice Stereo",
    "Ascend Lightcord Stereo", "Premium Lightcord Stereo",
    "Ripcord Stereo", "Skenzo Lightcord Stereo", "Ultimate HyperStereo", "JJK Stereo *"
];

const BASE_PAN_TYPES = [
    "Balance", "Equal Power", "Linear", "QuickHaas", "Pancake",
    "Polarity", "Mid-Side", "LCR", "Circular", "Auto Pan", "10D Hyper",
    "Center", "Left", "Right", "Inhead", "Overhead", "Below Head",
    "Far Right", "Far Left", "Center Left", "Center Right",
    "Center Far Right", "Center Far Left",
    "Inhead Left", "Inhead Right", "Inhead Far Right", "Inhead Far Left",
    "Overhead Left", "Overhead Right", "Overhead Far Right", "Overhead Far Left",
    "Upfront Center", "Upfront Center Right", "Upfront Center Left",
    "Upfront Center Far Right", "Upfront Center Far Left",
    "Upfront Overhead", "Upfront Overhead Center",
    "Upfront Overhead Center Left", "Upfront Overhead Center Right",
    "Upfront Overhead Center Far Right", "Upfront Overhead Center Far Left",
    "Behind Head", "Behind Head Right", "Behind Head Far Right", "Behind Head Far Left",
    "Mono", "Wide", "Narrow", "Close", "Deep",
    "Dolby Cinema Wide", "Piercing", "QuickHass Deluxe", "Polarity v2",
    "Premium Pancake", "Wide (Both Ears)", "Mono (Both Ears)",
    "Narrow (Both Ears)", "Piercing (Both Ears)", "Piercing Mono", "Piercing Wide",
    "Overhead (Both Ears)", "IMAX x Dolby Cinema Wide (Both Ears)",
    "Infinite Wideness", "Infinite Wideness (Both Ears)",
    "Piercing Infinite Wideness (Both Ears)", "Mono Wide", "Narrow Wide",
    "Dolby Cinema Mono", "Quickhass Deluxe x IMAX (Both Ears)",
    "Deluxe Wide x Infinite Wideness"
];

const SUPER_PANS = [
    "None", "Gojo Infinity", "Upgraded Infinity *", "JJK Pattern",
    "Domain Expansion", "Hollow Purple", "Ultra Instinct", "Paradox Chaos"
];

const NOT_NATTY_MODES = [
    "Off", "Raw Loudness", "Soft Clip", "Upmix Stereo",
    "Raw + Soft Clip", "Raw + Upmix", "Soft Clip + Upmix", "All Combined",
    "Aggressive Soft Clipping", "Aggressive Upmix", "Aggressive Raw Loudness",
    "Aggressive Combination", "Filterless Soft Clipping",
    "Filterless Raw Loudness", "Filterless Upmix", "Filterless Combination",
    "Filterless Aggressive Raw Loudness X4", "Filterless Aggressive Soft Clipping X4",
    "Filterless Aggressive Upmix X4", "Filterless Aggressive Combination X4"
];

const BASE_OPUS_BITRATES = [
    { id: "12000", label: "12k  Voice" },
    { id: "24000", label: "24k  Qualite" },
    { id: "64000", label: "64k  Discord defaut" },
    { id: "128000", label: "128k Haute qualite" },
    { id: "256000", label: "256k Ultra" },
    { id: "510000", label: "510k MAX BLOW" }
];

const defaultAmpConfig = {
    enabled: false,
    deess: false,
    vocalBoost: false,
    stereoMode: 0,
    panType: 0,
    superPan: 0,
    panManual: 0.0,
    stereoWidth: 0.0,
    reverb: 0.0,
    spatialExpander: 0.0,
    notNatty: 0,
    masterBoost: 0.0,
    preGain: 0.0,
    postGain: 0.0,
    saturation: 0.0,
    codecGain: 0.0,
    presenceDb: 0.0,
    airDb: 0.0,
    bodyDb: 0.0,
    rumbleHz: 0.0,
    echoCancel: false,
    noiseSup: false,
    highpass: false,
    hardClip: false,
    softClip: false,
    compressor: false,
    limiter: false,
    opusBitrate: 64000,
    opusBoost: false,
    pitchEnabled: false,
    pitchSemitones: 0.0,
    eightD: false,
    eightDSpeed: 1.0
};

const TI_ACCOUNTS_KEY = "TokenImporter_accounts";

let ghostMicLabel: string = "default";
let ghostJoinDelay: number = 0;
let isConnectingBatch = false;
let ghostVolumeMultiplier: number = 1.0;
let ghostEqBass: number = 0.0;
let ghostEqTreble: number = 0.0;
let ghostEqMid: number = 0.0;
let ghostEqEnabled: boolean = false;
let ghostShowEq: boolean = false;
let ghostVocalBoost: boolean = false;
let _voiceSyncUnsub: (() => void) | null = null;

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
    async setVolume(volume: number, vocalBoost = false): Promise<void> {
        const n = getNative();
        if (n?.setVolume) { try { await n.setVolume(volume, vocalBoost); return; } catch {} }
        await sfetch("/set-volume", { volume, vocalBoost });
    },
    
    async setAmpPanParams(params: any): Promise<void> {
        const n = getNative();
        if (n?.setAmpPanParams) { try { await n.setAmpPanParams(params); return; } catch {} }
        await sfetch("/set-amp-pan", params);
    },
    async getAmpPanParams(): Promise<any> {
        const n = getNative();
        if (n?.getAmpPanParams) { try { return await n.getAmpPanParams(); } catch {} }
        return await sfetch("/get-amp-pan");
    },
async setEq(bass: number, treble: number, mid: number, enabled = true): Promise<void> {
        const n = getNative();
        if (n?.setEq) { try { await n.setEq(bass, treble, mid, enabled); return; } catch {} }
        await sfetch("/set-eq", { bass, treble, mid, enabled });
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
    },
};

// ─── Icons (Strict Zero-Emoji, Minimalist SVG Primitives) ────────────────────
function GhostIcon({ width = 20, height = 20, className }: { width?: number; height?: number; className?: string; }) {
    return (
        <svg className={`vc-ic-save-icon ${className ?? ""}`} aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12.47 11c1.17 0 2.3.21 3.33.6.42.16.38.8.01 1.06-.9.63-1.5 1.67-1.5 2.9v1.58c0 .4-.25.76-.6.97l-.33.23A3.4 3.4 0 0 0 12 20.79l-.01.22v.22l.01.1c.04.34-.2.67-.54.67H6.15a.5.5 0 0 1-.5-.55l.27-2.6c.02-.26-.28-.37-.41-.16-.48.74-1.03 1.8-1.32 2.9a.53.53 0 0 1-.5.41h-.22C2.66 22 2 21.34 2 20.53A9.53 9.53 0 0 1 11.53 11h.94ZM12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM16.31 15.55c0-1.06 1.05-1.8 2.05-1.46l4.66 1.59c.58.2.98.75.98 1.37v5.47c-.04.82-.92 1.48-2 1.48-1.11 0-2.01-.68-2.01-1.53 0-.84.9-1.52 2-1.52l.3.01v-3l-4.28-1.46v4.52c0 .84-.9 1.52-2 1.52-1.11 0-2.01-.69-2.01-1.53 0-.84.9-1.53 2-1.53l.31.02v-3.95Z" />
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
const _leavingUsers = new Set<string>();
const _manuallyDisabledUsers = new Set<string>();
const _cachedGuildsMap = new Map<string, Set<string>>();
let _cancelBatch = false;

function boostLocalGhostVolume(userId: string) {
    try {
        const MediaEngineActions = findByProps("setLocalVolume");
        if (MediaEngineActions?.setLocalVolume) {
            MediaEngineActions.setLocalVolume(userId, 200);
        }
    } catch {}
}

let ghostListeners: Array<() => void> = [];
function notify() { ghostListeners.forEach(f => f()); }

const _pendingDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

function syncGhostStateFromDiscord(userId: string) {
    try {
        const myId = getMyId();
        if (myId && userId === myId) return;
        const cur = ghostStates.get(userId) ?? defaultState();
        if (_manuallyDisabledUsers.has(userId)) {
            if (cur.active || cur.connecting) {
                ghostStates.set(userId, { ...cur, active: false, connecting: false });
                notify();
            }
            return;
        }
        if (_leavingUsers.has(userId)) {
            const vs = VoiceStateStore?.getVoiceStateForUser?.(userId);
            if (!vs || !vs.channelId) {
                _leavingUsers.delete(userId);
                ghostStates.set(userId, { ...cur, active: false, connecting: false });
                notify();
            }
            return;
        }
        // Ne bloquer que si un batch est véritablement en cours d'exécution
        if (cur.connecting && isConnectingBatch) return;

        const vs = VoiceStateStore?.getVoiceStateForUser?.(userId);
        if (!vs || !vs.channelId) {
            if (cur.active || cur.connecting) {
                if (_pendingDisconnectTimers.has(userId)) {
                    clearTimeout(_pendingDisconnectTimers.get(userId)!);
                }
                const timer = setTimeout(() => {
                    _pendingDisconnectTimers.delete(userId);
                    const freshVs = VoiceStateStore?.getVoiceStateForUser?.(userId);
                    if (!freshVs || !freshVs.channelId) {
                        const freshCur = ghostStates.get(userId) ?? defaultState();
                        ghostStates.set(userId, { ...freshCur, active: false, connecting: false, streaming: false, camera: false });
                        notify();
                    }
                }, 5000);
                _pendingDisconnectTimers.set(userId, timer);
            }
            return;
        }

        // Si le vocal est confirmé par Discord, on annule tout timer de déconnexion en attente
        if (_pendingDisconnectTimers.has(userId)) {
            clearTimeout(_pendingDisconnectTimers.get(userId)!);
            _pendingDisconnectTimers.delete(userId);
        }

        const active = true;
        const muted = Boolean(vs.selfMute || vs.mute);
        const deafened = Boolean(vs.selfDeaf || vs.deaf);
        const camera = Boolean(vs.selfVideo);
        const streaming = Boolean(vs.selfStream);

        if (cur.active !== active || cur.connecting || cur.muted !== muted || cur.deafened !== deafened || cur.camera !== camera || cur.streaming !== streaming) {
            ghostStates.set(userId, {
                ...cur,
                active,
                connecting: false,
                muted,
                deafened,
                camera,
                streaming,
            });
            notify();
        }
    } catch { }
}

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

function getMyVoiceState(): { channelId: string; guildId: string; isDM?: boolean } | null {
    try {
        const id = getMyId();
        let channelId = "";
        let guildId = "";

        if (id) {
            const vs = VoiceStateStore?.getVoiceStateForUser?.(id);
            if (vs?.channelId) {
                channelId = vs.channelId;
                guildId = vs.guildId ?? "";
            }
        }

        if (!channelId) {
            channelId = SelectedChannelStore?.getVoiceChannelId?.() ?? "";
        }

        if (!channelId) return null;

        const ch = ChannelStore?.getChannel?.(channelId);
        if (ch) {
            guildId = guildId || ch.guild_id || (typeof ch.getGuildId === "function" ? ch.getGuildId() : "") || "";
            const isDM = ch.type === 1 || ch.type === 3 || Boolean(ch.isDM?.()) || Boolean(ch.isGroupDM?.());
            return { channelId, guildId: guildId || "", isDM: Boolean(isDM) };
        }

        return { channelId, guildId: guildId || "" };
    } catch {
        return null;
    }
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
            return null;
        }
    } catch {}

    try {
        const netFetch = (VencordNative as any)?.nightcord?.netFetch;
        if (typeof netFetch === "function") {
            const r = await netFetch("https://discord.com/api/v9/users/@me", {
                headers: { Authorization: token },
                timeout: 6000,
            });
            if (r?.ok && r.body) {
                const d = JSON.parse(r.body);
                return {
                    userId: d.id,
                    username: d.global_name || d.username,
                    avatar: d.avatar ? String(d.avatar).split("/").pop()?.split(".")[0] || null : null,
                    token
                };
            }
            return null;
        }
    } catch {}

    return null;
}

let savedAccounts: GhostAccount[] = [];
let _isScanningAccounts = false;

// Récupère les comptes sauvegardés + scan local automatique des installations Discord
async function getAllSavedAccounts(forceScan = false): Promise<GhostAccount[]> {
    if (!forceScan && savedAccounts.length > 0) {
        return savedAccounts;
    }

    const myId = getMyId();
    const combined = new Map<string, GhostAccount>();

    // 1. Lire les comptes de TokenImporter
    const tiAccsRaw = await DataStore.get<any[]>(TI_ACCOUNTS_KEY) ?? [];
    for (const a of tiAccsRaw) {
        const uid = a.id || a.userId;
        if (myId && uid === myId) continue;
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
        if (myId && uid === myId) continue;
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

    // 3. Scanner automatiquement les comptes Discord locaux lors d'un scan complet
    if (forceScan && !_isScanningAccounts) {
        _isScanningAccounts = true;
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
        } finally {
            _isScanningAccounts = false;
        }
    }

    // Ne jamais inclure l'utilisateur actuel
    if (myId) combined.delete(myId);

    const result = Array.from(combined.values());
    savedAccounts = result;
    DataStore.set(DS_KEY_TOKENS, result).catch(() => {});
    return result;
}

async function ghostDeactivate(userId: string) {
    _manuallyDisabledUsers.add(userId);
    if (_pendingDisconnectTimers.has(userId)) {
        clearTimeout(_pendingDisconnectTimers.get(userId)!);
        _pendingDisconnectTimers.delete(userId);
    }
    ghostStates.delete(userId);
    notify();
    Native.leaveVoice(userId).catch(() => {});
}

async function ghostDisableClean(targetIds?: string[]): Promise<{ forcedIds: string[] }> {
    _cancelBatch = true;
    isConnectingBatch = false;

    const ids = targetIds && targetIds.length > 0
        ? targetIds
        : Array.from(new Set([...ghostStates.keys(), ...savedAccounts.map(a => a.userId)]));
    if (!ids.length) return { forcedIds: [] };

    const curVoice = getMyVoiceState();
    const guildId = curVoice?.guildId;

    for (const userId of ids) {
        _manuallyDisabledUsers.add(userId);
        if (_pendingDisconnectTimers.has(userId)) {
            clearTimeout(_pendingDisconnectTimers.get(userId)!);
            _pendingDisconnectTimers.delete(userId);
        }
        _leavingUsers.add(userId);
        ghostStates.set(userId, defaultState());
    }
    notify();

    if (ghostJoinDelay === 0) {
        try {
            await Native.leaveVoiceAll(ids);
        } catch {
            ids.forEach(uid => Native.leaveVoice(uid, guildId).catch(() => {}));
        }
    } else {
        for (let i = 0; i < ids.length; i++) {
            const userId = ids[i];
            Native.leaveVoice(userId, guildId).catch(() => {});
            if (i < ids.length - 1 && ghostJoinDelay > 0) {
                await new Promise(r => setTimeout(r, ghostJoinDelay));
            }
        }
    }

    for (const userId of ids) {
        ghostStates.set(userId, defaultState());
    }
    notify();

    setTimeout(() => {
        for (const userId of ids) {
            _leavingUsers.delete(userId);
        }
    }, 2500);

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
            if (!globalAutoFollow) return;
            const curVoice = getMyVoiceState();
            const newCh: string | null = curVoice?.channelId ?? null;
            if (newCh === myLastChannelId) return;
            myLastChannelId = newCh;

            const accounts: GhostAccount[] = savedAccounts.length > 0 ? savedAccounts : (await getAllSavedAccounts(false));
            if (savedAccounts.length === 0 && accounts.length > 0) savedAccounts = accounts;

            const activeAccs = accounts.filter(a =>
                !_leavingUsers.has(a.userId) &&
                !_manuallyDisabledUsers.has(a.userId) &&
                (ghostStates.get(a.userId)?.active === true || ghostStates.get(a.userId)?.connecting === true)
            );
            if (!activeAccs.length) return;

            const guild: string = curVoice?.guildId ?? (newCh ? ChannelStore?.getChannel?.(newCh)?.guild_id ?? "" : "");

            if (ghostJoinDelay === 0) {
                await Promise.all(activeAccs.map(async acc => {
                    if (newCh) {

                        let realToken = acc.token;
                        try { realToken = await decryptToken(acc.token); } catch {}
                        const cur = ghostStates.get(acc.userId) ?? defaultState();
                        ghostStates.set(acc.userId, { ...cur, connecting: true });
                        notify();
                        try {
                            const result = await Native.connectGhost(acc.userId, realToken, guild, newCh, ghostMicLabel);
                            const updated = ghostStates.get(acc.userId) ?? defaultState();
                            const notInServer = result?.notInServer || result?.error === "Not in server";
                            ghostStates.set(acc.userId, {
                                ...updated,
                                active: Boolean(result?.ok),
                                connecting: false,
                                error: result?.ok ? null : (notInServer ? t("Not in server") : (result?.error ?? "Error"))
                            });
                        } catch (e) {
                            const updated = ghostStates.get(acc.userId) ?? defaultState();
                            ghostStates.set(acc.userId, { ...updated, active: false, connecting: false, error: String(e) });
                        }
                        notify();
                    } else {
                        Native.leaveVoice(acc.userId).catch(() => {});
                        const cur = ghostStates.get(acc.userId) ?? defaultState();
                        ghostStates.set(acc.userId, { ...cur, active: false, connecting: false, streaming: false, camera: false });
                        notify();
                    }
                }));
            } else {
                for (let i = 0; i < activeAccs.length; i++) {
                    const acc = activeAccs[i];
                    if (newCh) {

                        let realToken = acc.token;
                        try { realToken = await decryptToken(acc.token); } catch {}
                        const cur = ghostStates.get(acc.userId) ?? defaultState();
                        ghostStates.set(acc.userId, { ...cur, connecting: true });
                        notify();
                        Native.connectGhost(acc.userId, realToken, guild, newCh, ghostMicLabel)
                            .then(result => {
                                const updated = ghostStates.get(acc.userId) ?? defaultState();
                                const notInServer = result?.notInServer || result?.error === "Not in server";
                                ghostStates.set(acc.userId, {
                                    ...updated,
                                    active: Boolean(result?.ok),
                                    connecting: false,
                                    error: result?.ok ? null : (notInServer ? t("Not in server") : (result?.error ?? "Error"))
                                });
                                notify();
                            })
                            .catch(e => {
                                const updated = ghostStates.get(acc.userId) ?? defaultState();
                                ghostStates.set(acc.userId, { ...updated, active: false, connecting: false, error: String(e) });
                                notify();
                            });
                    } else {
                        Native.leaveVoice(acc.userId).catch(() => {});
                        const cur = ghostStates.get(acc.userId) ?? defaultState();
                        ghostStates.set(acc.userId, { ...cur, active: false, connecting: false, streaming: false, camera: false });
                        notify();
                    }
                    if (i < activeAccs.length - 1 && ghostJoinDelay > 0) {
                        await new Promise(r => setTimeout(r, ghostJoinDelay));
                    }
                }
            }
        }, 30);
    };

    const handler = (data: any) => {
        if (!data) return;
        const myId = getMyId();
        if (!myId) return;

        // If this voice state update belongs to one of our ghost accounts, sync its real-time state!
        if (data.userId && data.userId !== myId) {
            if (ghostStates.has(data.userId)) {
                syncGhostStateFromDiscord(data.userId);
            }
            return;
        }

        let statesList: any[] = [];
        try {
            if (data?.voiceStates != null) statesList = Array.isArray(data.voiceStates) ? data.voiceStates : Array.from(data.voiceStates as any);
            else if (data?.userId != null) statesList = [data];
        } catch { statesList = []; }

        for (const s of statesList) {
            if (s?.userId && s.userId !== myId && ghostStates.has(s.userId)) {
                syncGhostStateFromDiscord(s.userId);
            }
        }

        if (statesList.length > 0) {
            const myState = statesList.find((s: any) => s.userId === myId);
            if (!myState) return;
        }

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
        <div className="gc-account-actions">
            <Tooltip text={state.muted ? t("Unmute") : t("Mute")}>
                {(props: any) => (
                    <Button
                        {...props}
                        size="iconOnly"
                        variant={state.muted ? "dangerPrimary" : "secondary"}
                        className="gc-action-btn"
                        onClick={() => toggle("mute")}
                        disabled={!!busy}
                        aria-label={state.muted ? t("Unmute") : t("Mute")}
                    >
                        {state.muted ? <MicOffIcon width={14} height={14} /> : <MicIcon width={14} height={14} />}
                    </Button>
                )}
            </Tooltip>
            <Tooltip text={state.deafened ? t("Undeafen") : t("Deafen")}>
                {(props: any) => (
                    <Button
                        {...props}
                        size="iconOnly"
                        variant={state.deafened ? "dangerPrimary" : "secondary"}
                        className="gc-action-btn"
                        onClick={() => toggle("deafen")}
                        disabled={!!busy}
                        aria-label={state.deafened ? t("Undeafen") : t("Deafen")}
                    >
                        {state.deafened ? <DeafenIcon width={14} height={14} /> : <UndeafenIcon width={14} height={14} />}
                    </Button>
                )}
            </Tooltip>
            <Tooltip text={state.streaming ? t("Stop stream") : t("Start stream")}>
                {(props: any) => (
                    <Button
                        {...props}
                        size="iconOnly"
                        variant={state.streaming ? "primary" : "secondary"}
                        className="gc-action-btn"
                        onClick={() => toggle("stream")}
                        disabled={!!busy}
                        aria-label={state.streaming ? t("Stop stream") : t("Start stream")}
                    >
                        <StreamIcon width={14} height={14} />
                    </Button>
                )}
            </Tooltip>
            <Tooltip text={state.camera ? t("Turn off camera") : t("Turn on camera")}>
                {(props: any) => (
                    <Button
                        {...props}
                        size="iconOnly"
                        variant={state.camera ? "primary" : "secondary"}
                        className="gc-action-btn"
                        onClick={() => toggle("camera")}
                        disabled={!!busy}
                        aria-label={state.camera ? t("Turn off camera") : t("Turn on camera")}
                    >
                        <CamIcon width={14} height={14} />
                    </Button>
                )}
            </Tooltip>
        </div>
    );
}

// ─── Popover Principal ────────────────────────────────────────────────────────
function GhostPopover({ onClose, anchorRect }: { onClose: () => void; anchorRect: DOMRect | null; }) {
    const [accounts, setAccounts] = useState<GhostAccount[]>(savedAccounts);
    const [selectedId, setSelectedId] = useState<string>("all");
    const [autoFollow, setAutoFollowState] = useState(globalAutoFollow);
    const [micLabel, setMicLabel] = useState(ghostMicLabel);
    const [joinDelay, setJoinDelay] = useState(ghostJoinDelay);
    const [volumeMultiplier, setVolumeMultiplier] = useState(ghostVolumeMultiplier);
    const [sliderKey, setSliderKey] = useState(0);
    const [dshowDevices, setDshowDevices] = useState<string[]>([]);
    const [serverInstalled, setServerInstalled] = useState<boolean>(true);
    const [showEq, setShowEq] = useState(false);
    const [eqBass, setEqBass] = useState(ghostEqBass);
    const [eqTreble, setEqTreble] = useState(ghostEqTreble);
    const [eqMid, setEqMid] = useState(ghostEqMid);
    const [eqEnabled, setEqEnabled] = useState(ghostEqEnabled);
    const [showAmpPan, setShowAmpPan] = useState(false);
    const [ampConfig, setAmpConfig] = useState<any>(ghostAmpConfig || defaultAmpConfig);
    const [customPans, setCustomPans] = useState<string[]>([]);
    const [customOpus, setCustomOpus] = useState<{ id: string; label: string }[]>([]);

    const updateAmp = (partial: any) => {
        setAmpConfig((prev: any) => {
            const next = { ...prev, ...partial };
            ghostAmpConfig = next;
            DataStore.set(DS_KEY_AMP_CONFIG, next).catch(() => {});
            Native.setAmpPanParams(next).catch(() => {});
            return next;
        });
    };

    const resetAllAmpSettings = () => {
        const fresh = { ...defaultAmpConfig, enabled: false };
        setAmpConfig(fresh);
        ghostAmpConfig = fresh;
        DataStore.set(DS_KEY_AMP_CONFIG, fresh).catch(() => {});
        Native.setAmpPanParams(fresh).catch(() => {});
    };

    const addCustomPan = () => {
        const name = window.prompt(t("Name of custom pan (e.g. 8D Extreme):"));
        if (name && name.trim()) {
            const trimmed = name.trim();
            const next = [...customPans, trimmed];
            setCustomPans(next);
            DataStore.set(DS_KEY_CUSTOM_PANS, next).catch(() => {});
            updateAmp({ panType: BASE_PAN_TYPES.length + customPans.length });
        }
    };

    const addCustomOpus = () => {
        const bpsStr = window.prompt(t("Bitrate in bps (e.g. 320000):"));
        if (!bpsStr) return;
        const bps = parseInt(bpsStr.trim(), 10);
        if (isNaN(bps) || bps <= 0) return;
        const lbl = window.prompt(t("Label (e.g. 320k Custom):")) || `${Math.round(bps / 1000)}k Custom`;
        const next = [...customOpus, { id: String(bps), label: lbl }];
        setCustomOpus(next);
        DataStore.set(DS_KEY_CUSTOM_OPUS, next).catch(() => {});
        updateAmp({ opusBitrate: bps });
    };


    const applyEq = (bass: number, treble: number, mid: number, enabled: boolean) => {
        setEqBass(bass);
        setEqTreble(treble);
        setEqMid(mid);
        setEqEnabled(enabled);
        ghostEqBass = bass;
        ghostEqTreble = treble;
        ghostEqMid = mid;
        ghostEqEnabled = enabled;
        DataStore.set(DS_KEY_EQ_BASS, bass);
        DataStore.set(DS_KEY_EQ_TREBLE, treble);
        DataStore.set(DS_KEY_EQ_MID, mid);
        DataStore.set(DS_KEY_EQ_ENABLED, enabled);
        Native.setEq(bass, treble, mid, enabled).catch(() => {});
    };
    const states = useGhostStates();
    const popoverRef = useRef<HTMLDivElement>(null);
    const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

    useEffect(() => {
        const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const style = React.useMemo<React.CSSProperties>(() => {
        const margin = 10;
        const PW = 380 + (showEq ? 260 : 0) + (showAmpPan ? 390 : 0);

        let left = anchorRect ? anchorRect.left : margin;
        if (left + PW > window.innerWidth - margin) left = window.innerWidth - PW - margin;
        if (left < margin) left = margin;

        let bottom = anchorRect ? Math.max(margin, window.innerHeight - anchorRect.top + 8) : 60;
        const maxAllowed = Math.min(window.innerHeight - 20, 680);

        // Clamping: ensure the popover wrapper NEVER extends beyond the top of the window!
        if (bottom + maxAllowed > window.innerHeight - margin) {
            bottom = Math.max(margin, window.innerHeight - maxAllowed - margin);
        }

        const maxHeight = Math.max(220, window.innerHeight - bottom - margin);

        return {
            position: "fixed",
            left,
            bottom,
            maxHeight,
            maxWidth: `calc(100vw - ${left + margin}px)`,
            zIndex: 995
        };
    }, [anchorRect, showEq, showAmpPan, windowSize]);

    const handleWrapperWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        const isInsideVerticalScroller = target.closest(".gc-popover-body, .gc-amp-panel, .gc-vm-panel, .gc-accounts");
        if (!isInsideVerticalScroller && popoverRef.current) {
            popoverRef.current.scrollLeft += e.deltaY;
        }
    };

    useEffect(() => {
        Native.isServerInstalled().then(v => setServerInstalled(Boolean(v))).catch(() => setServerInstalled(true));
        Native.setEq(ghostEqBass, ghostEqTreble, ghostEqMid, ghostEqEnabled).catch(() => {});
        Native.setAmpPanParams(ghostAmpConfig || defaultAmpConfig).catch(() => {});

        const syncStates = (accs: GhostAccount[]) => {
            for (const a of accs) {
                syncGhostStateFromDiscord(a.userId);
            }
            fetch("http://127.0.0.1:47821/status").then(r => r.json()).then(d => {
                if (d?.ok && d.sessionDetails) {
                    for (const [uid, det] of Object.entries(d.sessionDetails as Record<string, any>)) {
                        if (Array.isArray(det.guilds)) {
                            _cachedGuildsMap.set(uid, new Set(det.guilds));
                        }
                        if (_leavingUsers.has(uid)) continue;
                        const cur = ghostStates.get(uid) ?? defaultState();
                        ghostStates.set(uid, {
                            ...cur,
                            active: Boolean(det.connected),
                            muted: Boolean(det.fakeMuted),
                            deafened: Boolean(det.fakeDeafened),
                            camera: Boolean(det.fakeCam),
                            streaming: Boolean(det.fakeStreaming),
                        });
                    }
                    notify();
                }
            }).catch(() => {});
        };

        if (savedAccounts.length > 0) {
            setAccounts(savedAccounts);
            syncStates(savedAccounts);
        } else {
            getAllSavedAccounts(false).then(v => {
                setAccounts(v);
                savedAccounts = v;
                syncStates(v);
            });
        }

        setShowAmpPan(false);
        ghostShowAmpPan = false;
        setShowEq(false);
        ghostShowEq = false;
        Promise.all([
            DataStore.get(DS_KEY_EQ_BASS),
            DataStore.get(DS_KEY_EQ_TREBLE),
            DataStore.get(DS_KEY_EQ_MID),
            DataStore.get(DS_KEY_EQ_ENABLED),
        ]).then(([b, tr, m, en]) => {
            const nextBass = typeof b === "number" ? b : ghostEqBass;
            const nextTreble = typeof tr === "number" ? tr : ghostEqTreble;
            const nextMid = typeof m === "number" ? m : ghostEqMid;
            const nextEn = typeof en === "boolean" ? en : ghostEqEnabled;
            setEqBass(nextBass);
            setEqTreble(nextTreble);
            setEqMid(nextMid);
            setEqEnabled(nextEn);
            ghostEqBass = nextBass;
            ghostEqTreble = nextTreble;
            ghostEqMid = nextMid;
            ghostEqEnabled = nextEn;
            Native.setEq(nextBass, nextTreble, nextMid, nextEn).catch(() => {});
        }).catch(() => {});
        DataStore.get(DS_KEY_AMP_CONFIG).then((v: any) => {
            if (v && typeof v === "object") {
                const merged = { ...defaultAmpConfig, ...v };
                setAmpConfig(merged);
                ghostAmpConfig = merged;
                Native.setAmpPanParams(merged).catch(() => {});
            }
        }).catch(() => {});
        DataStore.get(DS_KEY_CUSTOM_PANS).then((v: any) => {
            if (Array.isArray(v)) setCustomPans(v);
        }).catch(() => {});
        DataStore.get(DS_KEY_CUSTOM_OPUS).then((v: any) => {
            if (Array.isArray(v)) setCustomOpus(v);
        }).catch(() => {});
        Native.getAmpPanParams().then((res: any) => {
            if (res?.config) {
                setAmpConfig(res.config);
                ghostAmpConfig = res.config;
            }
        }).catch(() => {});

        DataStore.get(DS_KEY_AUTO_FOLLOW).then((v: boolean | null) => {
            const f = v ?? false;
            setAutoFollowState(f);
            if (f) startFollowing();
        });

        DataStore.get(DS_KEY_SELECTED).then((v: any) => {
            if (Array.isArray(v) && v.length > 0) {
                setSelectedId(v[0] || "all");
            } else if (typeof v === "string" && v) {
                setSelectedId(v);
            } else {
                setSelectedId("all");
            }
        });

        DataStore.get(DS_KEY_JOIN_DELAY).then((v: number | null) => {
            const d = v ?? 0;
            setJoinDelay(d);
            ghostJoinDelay = d;
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

    function handleOpenTokenImporter() {
        onClose();
        if (isPluginEnabled("TokenImporter")) {
            try {
                openTokenImporterModal();
            } catch {
                SettingsRouter.openUserSettings("equicord_plugins_panel");
            }
        } else {
            SettingsRouter.openUserSettings("equicord_plugins_panel");
        }
    }

    const myId = getMyId();
    const validAccounts = accounts.filter(a => a.userId !== myId);
    const isAll = selectedId === "all";

    function extractOptionValue(raw: any): string {
        if (raw === undefined || raw === null) return "";
        if (typeof raw === "number") return String(raw);
        if (typeof raw === "string") return raw;
        if (raw instanceof Set) {
            const first = raw.values().next().value;
            return extractOptionValue(first);
        }
        if (Array.isArray(raw)) {
            return extractOptionValue(raw[0]);
        }
        if (typeof raw === "object") {
            if ("value" in raw && raw.value !== undefined) return extractOptionValue(raw.value);
            if ("id" in raw && raw.id !== undefined) return extractOptionValue(raw.id);
            if ("key" in raw && raw.key !== undefined) return extractOptionValue(raw.key);
            if ("userId" in raw && raw.userId !== undefined) return extractOptionValue(raw.userId);
        }
        return String(raw);
    }

    function handleAccountSelect(raw: any) {
        const val = extractOptionValue(raw) || "all";
        if (val !== "all" && val === myId) {
            Toasts.show({ message: t("You cannot connect your own account as a ghost"), type: Toasts.Type.FAILURE, id: Toasts.genId() });
            return;
        }

        setSelectedId(val);
        DataStore.set(DS_KEY_SELECTED, val);
    }

    const renderAccountOptionValue = (selected?: any) => {
        let val = selectedId;
        if (selected && !Array.isArray(selected)) {
            const v = extractOptionValue(selected);
            if (v) val = v;
        }

        if (validAccounts.length === 0) {
            return (
                <span style={{ color: "var(--text-muted, #949ba4)", pointerEvents: "none" }}>
                    {t("No accounts found")}
                </span>
            );
        }

        if (val === "all") {
            return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "none" }}>
                    <div style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "var(--brand-500, #5865f2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        flexShrink: 0
                    }}>
                        <GhostIcon width={12} height={12} />
                    </div>
                    <span style={{ color: "var(--text-normal, #fff)", fontWeight: 500 }}>
                        {t("All accounts")} ({validAccounts.length})
                    </span>
                </div>
            );
        }

        const acc = validAccounts.find(a => String(a.userId) === String(val));
        const name = acc?.username ?? val;
        const avatar = acc?.avatar;
        const uid = acc?.userId ?? val;

        return (
            <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "none" }}>
                {avatar ? (
                    <img
                        src={avatarUrl(uid, avatar)}
                        style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                        alt=""
                    />
                ) : (
                    <div
                        className="gc-dropdown-avatar-placeholder"
                        style={{ width: 20, height: 20, fontSize: 10, flexShrink: 0 }}
                    >
                        {name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                )}
                <span style={{ color: "var(--text-normal, #fff)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                </span>
            </div>
        );
    };

    const renderAccountOptionLabel = (opt: any) => {
        if (!opt) return null;
        const val = extractOptionValue(opt);

        if (val === "all") {
            return (
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "2px 0", pointerEvents: "none" }}>
                    <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "var(--brand-500, #5865f2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        flexShrink: 0
                    }}>
                        <GhostIcon width={14} height={14} />
                    </div>
                    <span style={{ flex: 1, fontWeight: 600, color: "var(--text-normal, #fff)" }}>
                        {opt.label ?? t("All accounts")}
                    </span>
                    {validAccounts.length > 0 && (
                        <span style={{ fontSize: 12, color: "var(--text-muted, #949ba4)", paddingRight: 4 }}>
                            ({validAccounts.length})
                        </span>
                    )}
                </div>
            );
        }

        const acc = validAccounts.find(a => String(a.userId) === String(val));
        const avatar = acc?.avatar ?? opt.avatar;
        const uid = acc?.userId ?? opt.userId ?? val;
        const name = acc?.username ?? opt.label ?? val;

        return (
            <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "2px 0", pointerEvents: "none" }}>
                {avatar ? (
                    <img
                        src={avatarUrl(uid, avatar)}
                        style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                        alt=""
                    />
                ) : (
                    <div
                        className="gc-dropdown-avatar-placeholder"
                        style={{ width: 24, height: 24, fontSize: 11, flexShrink: 0 }}
                    >
                        {name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                )}
                <span style={{ flex: 1, color: "var(--text-normal, #fff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                </span>
            </div>
        );
    };

    const accountOptions = [
        { key: "all", value: "all", label: t("All accounts") },
        ...validAccounts.map(a => ({
            key: String(a.userId),
            value: String(a.userId),
            label: a.username,
            avatar: a.avatar,
            userId: String(a.userId)
        }))
    ];
    const micOptions = [
        { key: "default", value: "default", label: t("Default microphone") },
        ...dshowDevices.map(d => ({ key: d, value: d, label: d }))
    ];

    const handleMicSelect = (raw: any) => {
        const v = extractOptionValue(raw) || "default";
        setMicLabel(v);
        ghostMicLabel = v;
        DataStore.set(DS_KEY_MIC_DEVICE, v);
        Native.setMicDevice(v).catch(() => {});
    };

    const stereoOptions = STEREO_MODES.map((mode, i) => ({
        key: String(i),
        value: i,
        label: mode,
    }));

    const panOptions = [
        ...BASE_PAN_TYPES.map((pt, i) => ({ key: String(i), value: i, label: pt })),
        ...customPans.map((pt, i) => ({ key: String(BASE_PAN_TYPES.length + i), value: BASE_PAN_TYPES.length + i, label: pt })),
    ];

    const notNattyOptions = NOT_NATTY_MODES.map((nn, i) => ({
        key: String(i),
        value: i,
        label: nn,
    }));

    const opusBitrateOptions = [
        ...BASE_OPUS_BITRATES.map(br => ({ key: br.id, value: parseInt(br.id, 10), label: br.label })),
        ...customOpus.map(br => ({ key: br.id, value: parseInt(br.id, 10), label: br.label })),
    ];

    const handleStereoSelect = (raw: any) => {
        const num = parseInt(extractOptionValue(raw), 10);
        if (!isNaN(num)) updateAmp({ stereoMode: num });
    };

    const handlePanTypeSelect = (raw: any) => {
        const num = parseInt(extractOptionValue(raw), 10);
        if (!isNaN(num)) updateAmp({ panType: num });
    };

    const handleNotNattySelect = (raw: any) => {
        const num = parseInt(extractOptionValue(raw), 10);
        if (!isNaN(num)) updateAmp({ notNatty: num });
    };

    const handleOpusBitrateSelect = (raw: any) => {
        const num = parseInt(extractOptionValue(raw), 10);
        if (!isNaN(num)) updateAmp({ opusBitrate: num });
    };

    return (
        <div ref={popoverRef} className="gc-popover-wrapper" style={style} onWheel={handleWrapperWheel}>
            <div className="gc-popover">
            <div className="gc-popover-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                    <GhostIcon width={16} height={16} />
                    <Text variant="text-md/bold" color="header-primary" className="gc-popover-title">
                        {t("Ghost Accounts")}
                    </Text>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Tooltip text={t("Amp & Pan Engine")}>
                        {(props: any) => (
                            <button
                                {...props}
                                className={`gc-amp-header-btn ${showAmpPan ? "gc-amp-header-btn--active" : ""}`}
                                onClick={() => {
                                    const next = !showAmpPan;
                                    setShowAmpPan(next);
                                    ghostShowAmpPan = next;
                                    DataStore.set(DS_KEY_SHOW_AMP_PAN, next);
                                }}
                                aria-label={t("Amp & Pan Engine")}
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                                    <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                                    <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                                    <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                                </svg>
                            </button>
                        )}
                    </Tooltip>
                    <Tooltip text={t("Equalizer")}>
                        {(props: any) => (
                            <button
                                {...props}
                                className={`gc-eq-header-btn ${showEq ? "gc-eq-header-btn--active" : ""}`}
                                onClick={() => {
                                    const next = !showEq;
                                    setShowEq(next);
                                    ghostShowEq = next;
                                    DataStore.set(DS_KEY_SHOW_EQ, next);
                                }}
                                aria-label={t("Equalizer")}
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="20" x2="18" y2="10" />
                                    <line x1="12" y1="20" x2="12" y2="4" />
                                    <line x1="6" y1="20" x2="6" y2="14" />
                                </svg>
                            </button>
                        )}
                    </Tooltip>
                    <ModalCloseButton onClick={onClose} />
                </div>
            </div>

            <div className="gc-popover-body">
                {/* Server alert banner */}
                {!serverInstalled && (
                    <div className="gc-server-alert">
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                            <Text variant="text-xs/bold" color="text-danger" style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
                                {t("Companion Server Required")}
                            </Text>
                            <Text variant="text-xs/normal" color="text-muted">
                                {t("The background ghost-server is required to connect voice and stream audio.")}
                            </Text>
                        </div>
                        <Button
                            size="small"
                            variant="dangerPrimary"
                            onClick={() => {
                                onClose();
                                SettingsRouter.openUserSettings("nightcord_ghost_client_installer_panel");
                            }}
                        >
                            {t("Open Installer")}
                        </Button>
                    </div>
                )}

                {/* Account and Mic Selectors */}
                <div className="gc-dropdown-wrap">
                    <div className="gc-dropdown-label">
                        <UserIcon />
                        <Text variant="eyebrow" color="header-secondary">{t("Active accounts")}</Text>
                    </div>
                    <Select
                        options={accountOptions}
                        value={selectedId}
                        isSelected={(item: any) => extractOptionValue(item) === selectedId}
                        select={(val: any) => handleAccountSelect(val)}
                        onSelectionChange={(val: any) => handleAccountSelect(val)}
                        onChange={(val: any) => handleAccountSelect(val)}
                        serialize={(val: any) => extractOptionValue(val)}
                        placeholder={t("Select account...")}
                        closeOnSelect={true}
                        maxVisibleItems={8}
                        popoutPosition="bottom"
                        renderOptionLabel={(opt: any) => renderAccountOptionLabel(opt)}
                        renderOptionValue={() => renderAccountOptionValue()}
                    />
                </div>
                <div className="gc-dropdown-wrap">
                    <div className="gc-dropdown-label">
                        <MicIcon />
                        <Text variant="eyebrow" color="header-secondary">{t("Source microphone")}</Text>
                    </div>
                    <Select
                        options={micOptions}
                        value={micLabel}
                        isSelected={(item: any) => extractOptionValue(item) === micLabel}
                        select={handleMicSelect}
                        onSelectionChange={handleMicSelect}
                        onChange={handleMicSelect}
                        serialize={(v: any) => extractOptionValue(v)}
                        closeOnSelect={true}
                        maxVisibleItems={8}
                        popoutPosition="bottom"
                    />
                </div>

                <div className="gc-popover-divider" />

                {/* Auto-follow toggle (Discord native FormSwitch) */}
                <FormSwitch
                    title={t("Automatic voice tracking")}
                    description={t("Ghosts join your channel in real time")}
                    value={autoFollow}
                    onChange={toggleAutoFollow}
                    hideBorder={true}
                    className="gc-form-switch"
                />

                {/* Join delay */}
                <div className="gc-delay-row">
                    <div className="gc-delay-info">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <TimerIcon width={14} height={14} />
                            <Text variant="text-sm/semibold" color="header-primary">{t("Join delay")}</Text>
                        </div>
                        <Text variant="text-xs/normal" color="text-muted">{t("Delay between each token connection")}</Text>
                    </div>
                    <div className="gc-delay-ctrl">
                        <Button
                            size="small"
                            variant="secondary"
                            className="gc-stepper-btn"
                            onClick={() => {
                                const v = Math.max(0, joinDelay - 50);
                                setJoinDelay(v); ghostJoinDelay = v; DataStore.set(DS_KEY_JOIN_DELAY, v);
                            }}
                        >
                            −
                        </Button>
                        <Text variant="text-xs/bold" color="header-primary" className="gc-delay-val">
                            {joinDelay}ms
                        </Text>
                        <Button
                            size="small"
                            variant="secondary"
                            className="gc-stepper-btn"
                            onClick={() => {
                                const v = Math.min(5000, joinDelay + 50);
                                setJoinDelay(v); ghostJoinDelay = v; DataStore.set(DS_KEY_JOIN_DELAY, v);
                            }}
                        >
                            +
                        </Button>
                    </div>
                </div>

                {/* Volume Booster */}
                <div className="gc-booster-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div className="gc-delay-info">
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <VolumeIcon width={14} height={14} />
                                <Text variant="text-sm/semibold" color="header-primary">{t("Volume Booster")}</Text>
                            </div>
                            <Text variant="text-xs/normal" color="text-muted">{t("Radically amplifies or lowers selected device volume")}</Text>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Text
                                variant="text-xs/bold"
                                color={volumeMultiplier > 1 ? "status-warning" : "header-primary"}
                                style={{ minWidth: 40, textAlign: "right", fontFamily: "var(--font-code, monospace)" }}
                            >
                                {Math.round(volumeMultiplier * 100)}%
                            </Text>
                            <Button
                                size="small"
                                variant="secondary"
                                className="gc-reset-btn"
                                onClick={() => {
                                    setVolumeMultiplier(1.0);
                                    ghostVolumeMultiplier = 1.0;
                                    DataStore.set(DS_KEY_VOLUME, 1.0);
                                    Native.setVolume(1.0).catch(() => {});
                                    setSliderKey(k => k + 1);
                                }}
                            >
                                {t("Reset")}
                            </Button>
                        </div>
                    </div>
                    {Slider ? (
                        <div style={{ padding: "6px 2px 2px" }}>
                            <Slider
                                key={sliderKey}
                                minValue={0}
                                maxValue={500}
                                initialValue={Math.round(volumeMultiplier * 100)}
                                asValueChanges={(val: number) => {
                                    const v = Math.round(val) / 100;
                                    setVolumeMultiplier(v);
                                    ghostVolumeMultiplier = v;
                                    DataStore.set(DS_KEY_VOLUME, v);
                                    Native.setVolume(v).catch(() => {});
                                }}
                                onValueRender={(v: number) => `${Math.round(v)}%`}
                                markers={[0, 100, 200, 300, 400, 500]}
                                equidistant={true}
                            />
                        </div>
                    ) : (
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
                                width: "100%",
                                height: 6,
                                borderRadius: 3,
                                cursor: "pointer",
                                accentColor: "var(--brand-500, #5865f2)",
                                background: "var(--background-modifier-accent)",
                            }}
                        />
                    )}
                </div>

                <div className="gc-popover-divider" />

                {/* Accounts list header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2, flexShrink: 0 }}>
                    <Text variant="eyebrow" color="header-secondary">
                        {t("Accounts (Native + Imported)")}
                    </Text>
                    <Button
                        size="small"
                        variant="link"
                        className="gc-reverify-btn"
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
                    </Button>
                </div>

                {/* Batch controls */}
                {accounts.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, flexShrink: 0 }}>
                        <Button
                            size="small"
                            variant={accounts.some(a => ghostStates.get(a.userId)?.muted) ? "dangerPrimary" : "secondary"}
                            className="gc-batch-button"
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
                        </Button>
                        <Button
                            size="small"
                            variant={accounts.some(a => ghostStates.get(a.userId)?.deafened) ? "dangerPrimary" : "secondary"}
                            className="gc-batch-button"
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
                        </Button>
                        <Button
                            size="small"
                            variant={accounts.some(a => ghostStates.get(a.userId)?.camera) ? "primary" : "secondary"}
                            className="gc-batch-button"
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
                        </Button>
                    </div>
                )}

                {/* Accounts list */}
                <div className="gc-accounts">
                    {accounts.length === 0 && (
                        <div className="gc-empty">
                            <Text variant="text-xs/normal" color="text-muted">
                                {t("No accounts — tokens are automatically scanned from local Discord clients or imported from TokenImporter.")}
                            </Text>
                        </div>
                    )}
                    {accounts.map(acc => {
                        const state = states.get(acc.userId) ?? defaultState();
                        const isActive = state.active;
                        const isConnecting = state.connecting;
                        const isStreaming = Boolean(state.streaming);
                        return (
                            <div key={acc.userId} className={`gc-account ${isActive ? "gc-account--on" : ""}`}>
                                <div className="gc-account-left">
                                    <div className="gc-avatar-wrap">
                                        <img src={avatarUrl(acc.userId, acc.avatar)} className="gc-avatar" alt="" />
                                        <div className={`gc-status-dot ${isStreaming ? "gc-dot--stream" : isActive ? "gc-dot--voice" : isConnecting ? "gc-dot--connecting" : "gc-dot--off"}`} />
                                    </div>
                                    <div className="gc-account-info">
                                        <Text variant="text-sm/semibold" color="header-primary" className="gc-account-name" title={acc.username}>
                                            {acc.username}
                                        </Text>
                                        <Text variant="text-xs/normal" color="text-muted" className="gc-account-status">
                                            {isConnecting
                                                ? t("Connecting to voice...")
                                                : isStreaming
                                                    ? t("Streaming")
                                                    : state.camera
                                                        ? t("Camera on")
                                                        : isActive
                                                            ? t("Active in voice")
                                                            : (state.error === "Not in server" || state.error === t("Not in server"))
                                                                ? t("Not in server")
                                                                : state.error
                                                                    ? `${t("Error: ")}${state.error.slice(0, 35)}`
                                                                    : t("Disconnected")}
                                        </Text>
                                    </div>
                                </div>
                                <div className="gc-account-actions-wrap">
                                    <TokenControls acc={acc} state={state} />
                                    <Tooltip text={t("Delete account")}>
                                        {(props: any) => (
                                            <Button
                                                {...props}
                                                size="iconOnly"
                                                variant="dangerSecondary"
                                                className="gc-action-btn gc-action-del-btn"
                                                onClick={async () => {
                                                    await ghostDeactivate(acc.userId);
                                                    await saveAccounts(accounts.filter(a => a.userId !== acc.userId));
                                                }}
                                                aria-label={t("Delete account")}
                                            >
                                                <TrashIcon width={14} height={14} />
                                            </Button>
                                        )}
                                    </Tooltip>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* TokenImporter helper notice text (replaces manual token textarea) */}
                <div className="gc-popover-divider" />
                <div className="gc-importer-card" onClick={handleOpenTokenImporter}>
                    <Text variant="text-xs/normal" color="text-muted" style={{ lineHeight: 1.4 }}>
                        {t("Manage and add accounts from the TokenImporter plugin.")}
                    </Text>
                    <Button
                        size="small"
                        variant="primary"
                        className="gc-importer-btn"
                        onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            handleOpenTokenImporter();
                        }}
                    >
                        TokenImporter
                    </Button>
                </div>
            </div>
        </div>

        {/* ⚡ 1:1 AUTHENTIC AMP & PAN ENGINE PANEL */}
        {showAmpPan && (
            <div className="gc-amp-panel">
                {/* Note supérieure */}
                <div className="gc-amp-note">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <span>{t("The amp panel never touches the system microphone - only the Discord audio stream")}</span>
                </div>

                {/* Titre et switch ON/OFF principal */}
                <div className="gc-amp-title-row">
                    <span className="gc-amp-title">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                            <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                            <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                        </svg>
                        <span>{t("Amp & Pan Engine")}</span>
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                            className={`gc-amp-switch ${ampConfig.enabled ? "gc-amp-switch--on" : ""}`}
                            onClick={() => updateAmp({ enabled: !ampConfig.enabled })}
                            title={ampConfig.enabled ? t("Disable Amp Engine") : t("Enable Amp Engine")}
                        >
                            <div className="gc-amp-switch-knob" />
                        </button>
                        <ModalCloseButton
                            onClick={() => {
                                setShowAmpPan(false);
                                ghostShowAmpPan = false;
                                DataStore.set(DS_KEY_SHOW_AMP_PAN, false);
                            }}
                        />
                    </div>
                </div>

                {/* TRAITEMENT VOCAL */}
                <div className="gc-amp-section-lbl">{t("Vocal Processing")}</div>
                <div className="gc-amp-btn-grid">
                    <button
                        className={`gc-amp-btn ${ampConfig.deess ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ deess: !ampConfig.deess })}
                    >
                        De-Esser
                    </button>
                    <button
                        className={`gc-amp-btn ${ampConfig.vocalBoost ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ vocalBoost: !ampConfig.vocalBoost })}
                    >
                        Vocal Forward
                    </button>
                </div>

                {/* STEREO & PANS */}
                <div className="gc-amp-field-row" style={{ marginTop: 8 }}>
                    <span className="gc-amp-field-lbl">{t("Stereo Mode")}</span>
                    <div className="gc-amp-select-wrap">
                        <div className="gc-amp-select-inner">
                            <Select
                                options={stereoOptions}
                                value={ampConfig.stereoMode}
                                isSelected={(item: any) => extractOptionValue(item) === String(ampConfig.stereoMode)}
                                select={handleStereoSelect}
                                onSelectionChange={handleStereoSelect}
                                onChange={handleStereoSelect}
                                serialize={(v: any) => extractOptionValue(v)}
                                closeOnSelect={true}
                                maxVisibleItems={8}
                                popoutPosition="bottom"
                            />
                        </div>
                    </div>
                </div>

                <div className="gc-amp-field-row">
                    <span className="gc-amp-field-lbl">{t("Pan Type")}</span>
                    <div className="gc-amp-select-wrap">
                        <div className="gc-amp-select-inner">
                            <Select
                                options={panOptions}
                                value={ampConfig.panType}
                                isSelected={(item: any) => extractOptionValue(item) === String(ampConfig.panType)}
                                select={handlePanTypeSelect}
                                onSelectionChange={handlePanTypeSelect}
                                onChange={handlePanTypeSelect}
                                serialize={(v: any) => extractOptionValue(v)}
                                closeOnSelect={true}
                                maxVisibleItems={8}
                                popoutPosition="bottom"
                            />
                        </div>
                        <button className="gc-amp-plus-btn" onClick={addCustomPan} title={t("Add Custom Pan Type")}>+</button>
                    </div>
                </div>

                <div className="gc-amp-section-lbl" style={{ marginTop: 8 }}>{t("8D Audio Orbit")}</div>
                <button
                    className={`gc-amp-btn gc-amp-btn-full ${ampConfig.eightD ? "gc-amp-btn--active" : ""}`}
                    onClick={() => updateAmp({ eightD: !ampConfig.eightD })}
                    title={t("360° binaural rotation: sound slowly rotates front, back, left, and right around your head")}
                >
                    {t("360° 8D Audio Rotation (Slow Head Orbit)")}
                </button>
                <div className="gc-amp-slider-row" style={{ marginTop: 4 }}>
                    <span className="gc-amp-slider-lbl">{t("Orbit Speed")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0.2"
                            max="5.0"
                            step="0.1"
                            value={ampConfig.eightDSpeed ?? 1.0}
                            onChange={e => updateAmp({ eightDSpeed: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{(ampConfig.eightDSpeed ?? 1.0).toFixed(1)}x</span>
                    </div>
                </div>

                <div className="gc-amp-section-lbl" style={{ marginTop: 8 }}>{t("Super Pan")}</div>
                <div className="gc-superpan-grid">
                    {SUPER_PANS.map((sp, i) => (
                        <button
                            key={sp}
                            className={`gc-superpan-box ${ampConfig.superPan === i ? "gc-superpan-box--active" : ""}`}
                            onClick={() => updateAmp({ superPan: i })}
                            title={sp}
                        >
                            {sp}
                        </button>
                    ))}
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Manual Pan")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="-1"
                            max="1"
                            step="0.01"
                            value={ampConfig.panManual}
                            onChange={e => updateAmp({ panManual: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.panManual * 100) / 100}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Stereo Width")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="5"
                            step="0.01"
                            value={ampConfig.stereoWidth}
                            onChange={e => updateAmp({ stereoWidth: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.stereoWidth * 10) / 10}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Reverb / Spatial")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={ampConfig.reverb}
                            onChange={e => updateAmp({ reverb: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.reverb * 100) / 100}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Spatial Expander")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="5"
                            step="0.01"
                            value={ampConfig.spatialExpander}
                            onChange={e => updateAmp({ spatialExpander: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.spatialExpander * 10) / 10}</span>
                    </div>
                </div>

                <div className="gc-amp-field-row" style={{ marginTop: 4 }}>
                    <span className="gc-amp-field-lbl">{t("Not Natty Mode")}</span>
                    <div className="gc-amp-select-wrap">
                        <div className="gc-amp-select-inner">
                            <Select
                                options={notNattyOptions}
                                value={ampConfig.notNatty}
                                isSelected={(item: any) => extractOptionValue(item) === String(ampConfig.notNatty)}
                                select={handleNotNattySelect}
                                onSelectionChange={handleNotNattySelect}
                                onChange={handleNotNattySelect}
                                serialize={(v: any) => extractOptionValue(v)}
                                closeOnSelect={true}
                                maxVisibleItems={8}
                                popoutPosition="bottom"
                            />
                        </div>
                    </div>
                </div>

                {/* GAINS */}
                <div className="gc-amp-section-lbl">{t("Gains")}</div>
                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Master Boost")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="20"
                            step="0.1"
                            value={ampConfig.masterBoost}
                            onChange={e => updateAmp({ masterBoost: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.masterBoost)}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Pre-Amplifier")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="10"
                            step="0.1"
                            value={ampConfig.preGain}
                            onChange={e => updateAmp({ preGain: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.preGain)}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Post Gain")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="15"
                            step="0.1"
                            value={ampConfig.postGain}
                            onChange={e => updateAmp({ postGain: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.postGain)}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Saturation")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="10"
                            step="0.1"
                            value={ampConfig.saturation}
                            onChange={e => updateAmp({ saturation: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.saturation)}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Codec Gain")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="8"
                            step="0.1"
                            value={ampConfig.codecGain}
                            onChange={e => updateAmp({ codecGain: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.codecGain)}</span>
                    </div>
                </div>

                {/* EQ CLARTE */}
                <div className="gc-amp-slider-row" style={{ marginTop: 8 }}>
                    <span className="gc-amp-slider-lbl">{t("Presence (3kHz)")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="20"
                            step="0.5"
                            value={ampConfig.presenceDb}
                            onChange={e => updateAmp({ presenceDb: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.presenceDb)}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Air (10kHz+)")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="20"
                            step="0.5"
                            value={ampConfig.airDb}
                            onChange={e => updateAmp({ airDb: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.airDb)}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Body (800Hz)")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="-12"
                            max="12"
                            step="0.5"
                            value={ampConfig.bodyDb}
                            onChange={e => updateAmp({ bodyDb: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.bodyDb)}</span>
                    </div>
                </div>

                <div className="gc-amp-slider-row">
                    <span className="gc-amp-slider-lbl">{t("Low-cut")}</span>
                    <div className="gc-amp-range-wrap">
                        <input
                            type="range"
                            className="gc-amp-range"
                            min="0"
                            max="300"
                            step="10"
                            value={ampConfig.rumbleHz}
                            onChange={e => updateAmp({ rumbleHz: parseFloat(e.target.value) })}
                        />
                        <span className="gc-amp-slider-val">{Math.round(ampConfig.rumbleHz)}</span>
                    </div>
                </div>

                {/* ECHO & BRUIT */}
                <div className="gc-amp-section-lbl" style={{ marginTop: 8 }}>{t("Echo & Noise")}</div>
                <div className="gc-amp-btn-grid">
                    <button
                        className={`gc-amp-btn ${ampConfig.echoCancel ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ echoCancel: !ampConfig.echoCancel })}
                    >{t("Echo cancel")}</button>
                    <button
                        className={`gc-amp-btn ${ampConfig.noiseSup ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ noiseSup: !ampConfig.noiseSup })}
                    >{t("Noise suppression")}</button>
                    <button
                        className={`gc-amp-btn ${ampConfig.highpass ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ highpass: !ampConfig.highpass })}
                    >
                        High-Pass 200Hz
                    </button>
                </div>

                {/* DROWN & OVERRIDE */}
                <div className="gc-amp-section-lbl" style={{ marginTop: 8 }}>{t("Drown & Override")}</div>
                <div className="gc-amp-btn-grid">
                    <button
                        className={`gc-amp-btn ${ampConfig.hardClip ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ hardClip: !ampConfig.hardClip })}
                    >
                        Hard Clip +70dB
                    </button>
                    <button
                        className={`gc-amp-btn ${ampConfig.softClip ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ softClip: !ampConfig.softClip })}
                    >
                        Soft Clip Amp
                    </button>
                    <button
                        className={`gc-amp-btn ${ampConfig.compressor ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ compressor: !ampConfig.compressor })}
                    >{t("Compressor x4")}</button>
                    <button
                        className={`gc-amp-btn ${ampConfig.limiter ? "gc-amp-btn--active" : ""}`}
                        onClick={() => updateAmp({ limiter: !ampConfig.limiter })}
                    >{t("Lookahead limiter")}</button>
                </div>

                {/* OPUS CODEC */}
                <div className="gc-amp-section-lbl" style={{ marginTop: 8 }}>{t("Opus Codec")}</div>
                <div className="gc-amp-field-row">
                    <span className="gc-amp-field-lbl">{t("Opus Bitrate")}</span>
                    <div className="gc-amp-select-wrap">
                        <div className="gc-amp-select-inner">
                            <Select
                                options={opusBitrateOptions}
                                value={ampConfig.opusBitrate}
                                isSelected={(item: any) => extractOptionValue(item) === String(ampConfig.opusBitrate)}
                                select={handleOpusBitrateSelect}
                                onSelectionChange={handleOpusBitrateSelect}
                                onChange={handleOpusBitrateSelect}
                                serialize={(v: any) => extractOptionValue(v)}
                                closeOnSelect={true}
                                maxVisibleItems={8}
                                popoutPosition="bottom"
                            />
                        </div>
                        <button className="gc-amp-plus-btn" onClick={addCustomOpus} title={t("Add Custom Bitrate")}>+</button>
                    </div>
                </div>
                <button
                    className={`gc-amp-btn gc-amp-btn-full ${ampConfig.opusBoost ? "gc-amp-btn--active" : ""}`}
                    onClick={() => updateAmp({ opusBoost: !ampConfig.opusBoost })}
                >
                    Opus 510k Boost MAX
                </button>

                {/* PITCH SHIFTER */}
                <div className="gc-amp-section-lbl" style={{ marginTop: 8 }}>{t("Pitch Shifter")}</div>
                <div className="gc-amp-pitch-container">
                    <div className="gc-amp-title-row" style={{ borderBottom: "none", paddingBottom: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#dbdee1" }}>{t("Pitch Shifter (system mic)")}</span>
                        <button
                            className={`gc-amp-switch ${ampConfig.pitchEnabled ? "gc-amp-switch--on" : ""}`}
                            onClick={() => updateAmp({ pitchEnabled: !ampConfig.pitchEnabled })}
                            title={ampConfig.pitchEnabled ? "Désactiver le pitch shifter" : "Activer le pitch shifter"}
                        >
                            <div className="gc-amp-switch-knob" />
                        </button>
                    </div>

                    <div className="gc-amp-pitch-track-wrap">
                        <span className="gc-amp-pitch-bound-lbl" style={{ textAlign: "left" }}>{t("Low")}</span>
                        <div className="gc-amp-pitch-slider-area">
                            <span className="gc-amp-pitch-thumb-val">
                                {ampConfig.pitchSemitones.toFixed(1).replace(".", ",")}
                            </span>
                            <input
                                type="range"
                                className="gc-amp-range"
                                min="-12"
                                max="12"
                                step="0.5"
                                value={ampConfig.pitchSemitones}
                                onChange={e => updateAmp({ pitchSemitones: parseFloat(e.target.value) })}
                                style={{ width: "100%" }}
                            />
                            <div className="gc-amp-pitch-marks">
                                <span>-12</span>
                                <span>-6</span>
                                <span>0</span>
                                <span>+6</span>
                                <span>+12</span>
                            </div>
                        </div>
                        <span className="gc-amp-pitch-bound-lbl" style={{ textAlign: "right" }}>{t("High")}</span>
                    </div>

                    <div className="gc-amp-pitch-sub">
                        {ampConfig.pitchSemitones.toFixed(1)} {t("semitones")}
                    </div>

                    <div className="gc-amp-pitch-footer">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#f0b232"/></svg>
                        <span>{t("Applied to the microphone selected in Settings")}</span>
                    </div>
                </div>

                {/* FOOTER RESET ALL SETTINGS */}
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: 10,
                    marginTop: 6,
                    borderTop: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))"
                }}>
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={resetAllAmpSettings}
                        title={t("Reset all Amp & Pan Engine settings to default (0)")}
                    >
                        {t("Reset all settings to 0")}
                    </Button>
                    <span style={{ fontSize: 10, color: "var(--text-muted, #949ba4)", fontWeight: 600 }}>
                        AMP & PAN ENGINE
                    </span>
                </div>
            </div>
        )}

        {/* 1:1 AUTHENTIC VOICEMEETER EQUALIZER PANEL */}
        {showEq && (
            <div className="gc-vm-panel">


                <div className="gc-vm-title-bar">
                    <span className="gc-vm-title-text">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg><span>EQUALIZER</span>
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <button
                            className={`gc-vm-power-btn ${eqEnabled ? "gc-vm-power-btn--on" : ""}`}
                            onClick={() => applyEq(eqBass, eqTreble, eqMid, !eqEnabled)}
                            title={eqEnabled ? "Bypass" : "Activer"}
                        >
                            {eqEnabled ? "ON" : "BYP"}
                        </button>
                        <ModalCloseButton
                            onClick={() => {
                                setShowEq(false);
                                ghostShowEq = false;
                                DataStore.set(DS_KEY_SHOW_EQ, false);
                            }}
                        />
                    </div>
                </div>

                {/* 3 KNOBS (EXACTEMENT COMME LA PHOTO) */}
                <div className="gc-vm-knobs-area">
                    {/* HAUT : TREBLE KNOB (Gaucher) + LABEL & VALEUR ORANGE (Droite) */}
                    <div className="gc-vm-row-treble">
                        <div
                            className="gc-vm-knob"
                            title="Treble : Glisser haut/bas (-12.0 à +12.0 dB)"
                            onMouseDown={(e) => {
                                const startY = e.clientY;
                                const startVal = eqTreble;
                                const onMove = (ev: MouseEvent) => {
                                    const diff = (startY - ev.clientY) * 0.25;
                                    const next = Math.max(-12, Math.min(12, Math.round((startVal + diff) * 10) / 10));
                                    applyEq(eqBass, next, eqMid, eqEnabled);
                                };
                                const onUp = () => {
                                    window.removeEventListener("mousemove", onMove);
                                    window.removeEventListener("mouseup", onUp);
                                };
                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                            }}
                        >
                            <div
                                className="gc-vm-knob-dot-container"
                                style={{ transform: `rotate(${(eqTreble / 12) * 135}deg)` }}
                            >
                                <div className="gc-vm-knob-dot" />
                            </div>
                        </div>
                        <div className="gc-vm-text-block">
                            <span className="gc-vm-text-label">Treble</span>
                            <span className={`gc-vm-text-val ${eqTreble > 0 ? "gc-vm-val--orange" : eqTreble < 0 ? "gc-vm-val--cyan" : "gc-vm-val--neutral"}`}>
                                {eqTreble.toFixed(1)}
                            </span>
                        </div>
                    </div>

                    {/* MILIEU : VALEUR BLEUE/CYAN (Gauche) + MID KNOB (Droite) -> ZIGZAG COMME LA PHOTO */}
                    <div className="gc-vm-row-mid">
                        <div className="gc-vm-text-block" style={{ alignItems: "flex-end", textAlign: "right" }}>
                            <span className={`gc-vm-text-val ${eqMid > 0 ? "gc-vm-val--orange" : eqMid < 0 ? "gc-vm-val--cyan" : "gc-vm-val--neutral"}`}>
                                {eqMid.toFixed(1)}
                            </span>
                        </div>
                        <div
                            className="gc-vm-knob"
                            title="Mid : Glisser haut/bas (-12.0 à +12.0 dB)"
                            onMouseDown={(e) => {
                                const startY = e.clientY;
                                const startVal = eqMid;
                                const onMove = (ev: MouseEvent) => {
                                    const diff = (startY - ev.clientY) * 0.25;
                                    const next = Math.max(-12, Math.min(12, Math.round((startVal + diff) * 10) / 10));
                                    applyEq(eqBass, eqTreble, next, eqEnabled);
                                };
                                const onUp = () => {
                                    window.removeEventListener("mousemove", onMove);
                                    window.removeEventListener("mouseup", onUp);
                                };
                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                            }}
                        >
                            <div
                                className="gc-vm-knob-dot-container"
                                style={{ transform: `rotate(${(eqMid / 12) * 135}deg)` }}
                            >
                                <div className="gc-vm-knob-dot" />
                            </div>
                        </div>
                    </div>

                    {/* BAS : BASS KNOB (Gaucher) + VALEUR ORANGE & LABEL (Droite) */}
                    <div className="gc-vm-row-bass">
                        <div
                            className="gc-vm-knob"
                            title="Bass : Glisser haut/bas (-12.0 à +12.0 dB)"
                            onMouseDown={(e) => {
                                const startY = e.clientY;
                                const startVal = eqBass;
                                const onMove = (ev: MouseEvent) => {
                                    const diff = (startY - ev.clientY) * 0.25;
                                    const next = Math.max(-12, Math.min(12, Math.round((startVal + diff) * 10) / 10));
                                    applyEq(next, eqTreble, eqMid, eqEnabled);
                                };
                                const onUp = () => {
                                    window.removeEventListener("mousemove", onMove);
                                    window.removeEventListener("mouseup", onUp);
                                };
                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                            }}
                        >
                            <div
                                className="gc-vm-knob-dot-container"
                                style={{ transform: `rotate(${(eqBass / 12) * 135}deg)` }}
                            >
                                <div className="gc-vm-knob-dot" />
                            </div>
                        </div>
                        <div className="gc-vm-text-block">
                            <span className={`gc-vm-text-val ${eqBass > 0 ? "gc-vm-val--orange" : eqBass < 0 ? "gc-vm-val--cyan" : "gc-vm-val--neutral"}`}>
                                {eqBass.toFixed(1)}
                            </span>
                            <span className="gc-vm-text-label">Bass</span>
                        </div>
                    </div>
                </div>

                {/* PRESETS VOICEMEETER */}
                <div className="gc-vm-presets">
                    <span className="gc-vm-presets-title">{t("Quick Presets")}</span>
                    <div className="gc-vm-preset-grid">
                        <button
                            className="gc-vm-preset-item"
                            style={{ borderColor: "#3ea08f", color: "#e85d4e" }}
                            onClick={() => applyEq(12.0, 12.0, -3.9, true)}
                            title="Treble 12.0 | Bass 12.0 | Mid -3.9"
                        >
                            Photo 12dB
                        </button>
                        <button
                            className="gc-vm-preset-item"
                            onClick={() => applyEq(12.0, 6.0, 0.0, true)}
                        >
                            Bass Boost
                        </button>
                        <button
                            className="gc-vm-preset-item"
                            onClick={() => applyEq(4.0, 10.0, 1.5, true)}
                        >
                            Clarté Hi-Fi
                        </button>
                        <button
                            className="gc-vm-preset-item"
                            onClick={() => applyEq(0.0, 0.0, 0.0, true)}
                        >
                            Flat (0.0)
                        </button>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="gc-vm-footer">
                    <button
                        className="gc-vm-reset-btn"
                        onClick={() => applyEq(0.0, 0.0, 0.0, true)}
                        title={t("Reset all potentiometers to zero")}
                    >{t("Reset 0 dB")}</button>
                    <span className="gc-vm-limiter-badge">
                        ● LIMITER TANH
                    </span>
                </div>
            </div>
        )}
    </div>
);
}

// ─── UserArea Button Component ────────────────────────────────────────────────
const GhostUserAreaButton = ({ iconForeground, hideTooltips, nameplate }: any) => {
    const states = useGhostStates();
    const [showPopover, setShowPopover] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const btnRef = useRef<HTMLDivElement>(null);

    const myId = getMyId();
    const myVs = getMyVoiceState();

    // Actif UNIQUEMENT si une connexion est activement en cours pour un compte fantôme (exclut myId),
    // ou si au moins un compte fantôme est véritablement connecté DANS MON SALON VOCAL ACTUEL
    const anyActive = Boolean(
        (isConnectingBatch && Array.from(states.entries()).some(([uid, s]) => (!myId || uid !== myId) && s.connecting)) ||
        (myVs?.channelId && Array.from(states.entries()).some(([uid, s]) => {
            if (!uid || (myId && uid === myId)) return false;
            if (!s.active) return false;
            try {
                const vs = VoiceStateStore?.getVoiceStateForUser?.(uid);
                return vs?.channelId === myVs.channelId;
            } catch {
                return false;
            }
        }))
    );

    useEffect(() => {
        if (!showPopover) return;
        const handler = (e: Event) => {
            const tgt = e.target as HTMLElement;
            if (!tgt) return;
            if (tgt.closest(".gc-popover") || tgt.closest(".gc-popover-wrapper") || tgt.closest(".gc-vm-panel") || tgt.closest(".gc-amp-panel")) return;
            if (tgt.closest("[role='listbox']") || tgt.closest("[role='option']") || tgt.closest("[class*='popout']") || tgt.closest("[class*='layerContainer']")) return;

            if (btnRef.current?.contains(tgt)) {
                e.preventDefault();
                e.stopPropagation();
            }
            setShowPopover(false);
        };
        const timer = setTimeout(() => {
            document.addEventListener("pointerdown", handler, true);
            document.addEventListener("contextmenu", handler, true);
        }, 50);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("pointerdown", handler, true);
            document.removeEventListener("contextmenu", handler, true);
        };
    }, [showPopover]);

    async function handleLeftClick(e?: any) {
        if (e && e.button !== undefined && e.button !== 0) return;
        if (showPopover) setShowPopover(false);

        if (isConnectingBatch) {
            _cancelBatch = true;
            isConnectingBatch = false;
            await ghostDisableClean();
            return;
        }

        const vs = getMyVoiceState();
        if (!vs?.channelId) {
            Toasts.show({ message: t("Join a voice channel first"), type: Toasts.Type.FAILURE, id: Toasts.genId() });
            openPopover();
            return;
        }

        const isInstalled = await Native.isServerInstalled().catch(() => true);
        if (!isInstalled) {
            Toasts.show({ message: t("GhostClient companion server is not installed. Open GhostInstaller to install it."), type: Toasts.Type.FAILURE, id: Toasts.genId() });
            openPopover();
            return;
        }

        const storedAccounts = await getAllSavedAccounts(false);
        const storedSelected = await DataStore.get(DS_KEY_SELECTED) as any ?? "all";
        const myId = getMyId();
        const filteredAccounts = storedAccounts.filter(a => a.userId !== myId);

        let selectedArray: string[] = [];
        if (Array.isArray(storedSelected)) {
            selectedArray = storedSelected;
        } else if (typeof storedSelected === "string" && storedSelected) {
            selectedArray = [storedSelected];
        } else {
            selectedArray = ["all"];
        }

        const isAll = selectedArray.includes("all");
        const targets = isAll
            ? filteredAccounts
            : filteredAccounts.filter(a => selectedArray.includes(a.userId));

        if (targets.length === 0) {
            Toasts.show({ message: t("No accounts selected"), type: Toasts.Type.FAILURE, id: Toasts.genId() });
            openPopover();
            return;
        }

        // Si au moins un compte cible est actif ou en cours de connexion, le clic gauche sert de toggle pour déconnecter
        const anyTargetActive = targets.some(a => {
            const s = ghostStates.get(a.userId);
            const userVs = VoiceStateStore?.getVoiceStateForUser?.(a.userId);
            return s?.active || s?.connecting || userVs?.channelId === vs.channelId;
        });

        if (anyTargetActive) {
            await ghostDisableClean(targets.map(a => a.userId));
            Toasts.show({ message: t("Ghost accounts disconnected"), type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            return;
        }

        if (vs.isDM && ChannelStore?.getChannel?.(vs.channelId)?.type === 1) {
            Toasts.show({
                message: t("Ghost accounts cannot join private 1-on-1 DMs. Please join a server voice channel or group call."),
                type: Toasts.Type.FAILURE,
                id: Toasts.genId()
            });
            return;
        }

        // Sinon, connecter tous les comptes cibles dans mon salon vocal !
        _cancelBatch = false;
        _leavingUsers.clear();

        Toasts.show({
            message: `${t("Connecting")} ${targets.length} ghost account${targets.length > 1 ? "s" : ""}...`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });

        const connectSingleAccount = async (acc: GhostAccount) => {
            if (_cancelBatch) return;
            _manuallyDisabledUsers.delete(acc.userId);

            let realToken = acc.token;
            try { realToken = await decryptToken(acc.token); } catch {}
            if (_cancelBatch) return;

            const cur = ghostStates.get(acc.userId) ?? defaultState();
            ghostStates.set(acc.userId, { ...cur, connecting: true, error: null });
            notify();
            try {
                const result = await Native.connectGhost(acc.userId, realToken, vs.guildId || "", vs.channelId, ghostMicLabel);
                if (_cancelBatch) {
                    Native.leaveVoice(acc.userId, vs.guildId).catch(() => {});
                    const updated = ghostStates.get(acc.userId) ?? defaultState();
                    ghostStates.set(acc.userId, { ...updated, active: false, connecting: false });
                    notify();
                    return;
                }
                const updated = ghostStates.get(acc.userId) ?? defaultState();
                const notInServer = result?.notInServer || result?.error === "Not in server";
                if (result?.ok) { boostLocalGhostVolume(acc.userId); }
                ghostStates.set(acc.userId, {
                    ...updated,
                    active: Boolean(result?.ok),
                    connecting: false,
                    error: result?.ok ? null : (notInServer ? t("Not in server") : (result?.error ?? t("Connection error")))
                });
            } catch (e) {
                if (_cancelBatch) return;
                const updated = ghostStates.get(acc.userId) ?? defaultState();
                ghostStates.set(acc.userId, { ...updated, active: false, connecting: false, error: String(e) });
            } finally {
                const fresh = ghostStates.get(acc.userId);
                if (fresh?.connecting) {
                    ghostStates.set(acc.userId, { ...fresh, connecting: false });
                }
                notify();
            }
        };

        isConnectingBatch = true;
        try {
            if (ghostJoinDelay === 0) {
                await Promise.all(targets.map(connectSingleAccount));
            } else {
                for (let i = 0; i < targets.length; i++) {
                    if (_cancelBatch) break;
                    connectSingleAccount(targets[i]);
                    if (i < targets.length - 1 && ghostJoinDelay > 0) {
                        await new Promise(r => setTimeout(r, ghostJoinDelay));
                    }
                }
            }
        } finally {
            isConnectingBatch = false;
        }
    }

    function openPopover() {
        const rect = btnRef.current?.getBoundingClientRect() ?? null;
        setAnchorRect(rect);
        setShowPopover(v => !v);
    }

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        if (showPopover) {
            e.preventDefault();
            e.stopPropagation();
            setShowPopover(false);
            return;
        }
        handleLeftClick(e);
    };

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (showPopover) {
            setShowPopover(false);
            return;
        }
        openPopover();
    };

    return (
        <div ref={btnRef} style={{ position: "relative" }} onContextMenu={handleContextMenu}>
            <UserAreaButton
                tooltipText={hideTooltips ? undefined : t("GhostClient — left-click: enable/disable | right-click: settings & controls")}
                icon={<GhostIcon className={`${iconForeground} ${anyActive ? "gc-icon--active" : ""}`} />}
                plated={nameplate != null}
                redGlow={false}
                onClick={handleClick}
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
        if (delay != null) ghostJoinDelay = Number(delay) || 0;
        else ghostJoinDelay = 0;

        const vb = await DataStore.get(DS_KEY_VOCAL_BOOST);
        if (vb != null) ghostVocalBoost = Boolean(vb);
        else ghostVocalBoost = false;

        const vol = await DataStore.get(DS_KEY_VOLUME);
        if (vol != null) {
            ghostVolumeMultiplier = vol;
            Native.setVolume(vol, ghostVocalBoost).catch(() => {});
        }

        const eqB = await DataStore.get(DS_KEY_EQ_BASS);
        if (eqB != null) ghostEqBass = Number(eqB);
        const eqT = await DataStore.get(DS_KEY_EQ_TREBLE);
        if (eqT != null) ghostEqTreble = Number(eqT);
        const eqM = await DataStore.get(DS_KEY_EQ_MID);
        if (eqM != null) ghostEqMid = Number(eqM);
        const eqEn = await DataStore.get(DS_KEY_EQ_ENABLED);
        if (eqEn != null) ghostEqEnabled = Boolean(eqEn);

        const ampCfg = await DataStore.get(DS_KEY_AMP_CONFIG);
        if (ampCfg != null) ghostAmpConfig = ampCfg;

        Native.setEq(ghostEqBass, ghostEqTreble, ghostEqMid, ghostEqEnabled).catch(() => {});
        Native.setAmpPanParams(ghostAmpConfig || defaultAmpConfig).catch(() => {});

        const allAccs = await getAllSavedAccounts(false);
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

        const onVoiceUpdate = (data: any) => {
            if (!data) return;
            const myId = getMyId();
            if (myId && data.userId === myId) {
                const myVs = getMyVoiceState();
                if (!myVs || !myVs.channelId) {
                    for (const [uid, st] of ghostStates.entries()) {
                        if (st.active || st.connecting) {
                            const cur = ghostStates.get(uid) ?? defaultState();
                            ghostStates.set(uid, { ...cur, active: false, connecting: false });
                        }
                    }
                }
                notify();
            }
            if (data.userId && data.userId !== myId && ghostStates.has(data.userId)) {
                syncGhostStateFromDiscord(data.userId);
            }
            if (Array.isArray(data.voiceStates)) {
                for (const s of data.voiceStates) {
                    if (s?.userId && s.userId !== myId && ghostStates.has(s.userId)) {
                        syncGhostStateFromDiscord(s.userId);
                    }
                }
            }
        };
        FluxDispatcher?.subscribe?.("VOICE_STATE_UPDATE", onVoiceUpdate);
        FluxDispatcher?.subscribe?.("VOICE_STATE_UPDATES", onVoiceUpdate);
        _voiceSyncUnsub = () => {
            FluxDispatcher?.unsubscribe?.("VOICE_STATE_UPDATE", onVoiceUpdate);
            FluxDispatcher?.unsubscribe?.("VOICE_STATE_UPDATES", onVoiceUpdate);
        };
    },

    stop() {
        isConnectingBatch = false;
        _voiceSyncUnsub?.();
        _voiceSyncUnsub = null;
        ghostDisableClean();
        stopFollowing();
    },
});
