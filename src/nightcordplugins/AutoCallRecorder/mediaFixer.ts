/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fixWebmDuration from "fix-webm-duration";

/**
 * Patches MP4 (ISO BMFF / fMP4) headers in-place so standard media players
 * (Windows Media Player, VLC, QuickTime, etc.) can read the total duration
 * and seek/scrub throughout the recording.
 */
export function fixMp4Duration(buffer: Buffer | Uint8Array, durationMs: number): Buffer {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let movieTimescale = 1000;

    function scanBox(start: number, end: number, path: string) {
        let pos = start;
        while (pos + 8 <= end) {
            const size = buf.readUInt32BE(pos);
            const type = buf.toString("ascii", pos + 4, pos + 8);
            const boxEnd = size === 1 ? pos + Number(buf.readBigUInt64BE(pos + 8)) : (size === 0 ? end : pos + size);
            const headerSize = size === 1 ? 16 : 8;
            const currentPath = path ? `${path}.${type}` : type;

            if (currentPath === "moov.mvhd") {
                const version = buf.readUInt8(pos + headerSize);
                if (version === 0) {
                    movieTimescale = buf.readUInt32BE(pos + headerSize + 12) || 1000;
                    const durationUnits = Math.round((durationMs / 1000) * movieTimescale);
                    buf.writeUInt32BE(durationUnits, pos + headerSize + 16);
                } else if (version === 1) {
                    movieTimescale = buf.readUInt32BE(pos + headerSize + 20) || 1000;
                    const durationUnits = BigInt(Math.round((durationMs / 1000) * movieTimescale));
                    buf.writeBigUInt64BE(durationUnits, pos + headerSize + 24);
                }
            } else if (currentPath.endsWith("tkhd")) {
                const version = buf.readUInt8(pos + headerSize);
                const durationUnits = Math.round((durationMs / 1000) * movieTimescale);
                if (version === 0) {
                    buf.writeUInt32BE(durationUnits, pos + headerSize + 20);
                } else if (version === 1) {
                    buf.writeBigUInt64BE(BigInt(durationUnits), pos + headerSize + 28);
                }
            } else if (currentPath.endsWith("mdhd")) {
                const version = buf.readUInt8(pos + headerSize);
                if (version === 0) {
                    const mediaTimescale = buf.readUInt32BE(pos + headerSize + 12) || movieTimescale;
                    const durationUnits = Math.round((durationMs / 1000) * mediaTimescale);
                    buf.writeUInt32BE(durationUnits, pos + headerSize + 16);
                } else if (version === 1) {
                    const mediaTimescale = buf.readUInt32BE(pos + headerSize + 20) || movieTimescale;
                    const durationUnits = BigInt(Math.round((durationMs / 1000) * mediaTimescale));
                    buf.writeBigUInt64BE(durationUnits, pos + headerSize + 24);
                }
            } else if (["moov", "trak", "mdia", "minf"].includes(type)) {
                scanBox(pos + headerSize, Math.min(boxEnd, end), currentPath);
            }

            if (boxEnd <= pos) break;
            pos = boxEnd;
        }
    }

    try {
        scanBox(0, buf.length, "");
    } catch (err) {
        console.warn("[AutoCallRecorder] MP4 duration patch warning:", err);
    }

    return buf;
}

/**
 * Patches WebM/MKV buffer duration metadata.
 */
export async function fixWebmBufferDuration(buffer: Buffer | Uint8Array, durationMs: number): Promise<Buffer> {
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const blob = new Blob([uint8], { type: "video/webm" });
    const fixedBlob = await fixWebmDuration(blob, durationMs);
    const arrayBuffer = await fixedBlob.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/**
 * Fixes media duration for any supported container (MP4, M4A, WebM, MKV, OGG).
 */
export async function fixMediaFileDuration(buffer: Buffer | Uint8Array, filename: string, durationMs: number): Promise<Buffer> {
    if (durationMs <= 0) {
        return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    const lower = filename.toLowerCase();
    if (lower.endsWith(".mp4") || lower.endsWith(".m4a")) {
        return fixMp4Duration(buffer, durationMs);
    } else if (lower.endsWith(".webm") || lower.endsWith(".mkv") || lower.endsWith(".ogg")) {
        try {
            return await fixWebmBufferDuration(buffer, durationMs);
        } catch {
            return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        }
    }

    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
