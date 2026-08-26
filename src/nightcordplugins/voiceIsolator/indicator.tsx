/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Avatar, Button, React } from "@webpack/common";
import { voiceIsolatorEngine } from "./engine";
import { VoiceIsolatorState } from "./types";
import { t } from "../autoTranslateNightcord";

export function VoiceIsolatorFloatingHud() {
    const [state, setState] = React.useState<VoiceIsolatorState>(() => voiceIsolatorEngine.getState());

    React.useEffect(() => {
        const unsub = voiceIsolatorEngine.subscribe(setState);
        return () => unsub();
    }, []);

    if (!state.isolatedUserId) return null;

    return (
        <div style={{
            position: "fixed",
            top: "20px",
            right: "24px",
            zIndex: 100000,
            backgroundColor: "var(--background-floating, #111214)",
            border: "1px solid var(--brand-500, #5865f2)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
            borderRadius: "10px",
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            animation: "nc-fade-in 0.2s ease-out"
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {state.isolatedUserAvatar && (
                    <Avatar src={state.isolatedUserAvatar} size="SIZE_32" />
                )}
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "13px" }}>
                        {t("Voice Isolated:")} {state.isolatedUserName}
                    </span>
                    <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "11px" }}>
                        {t("All other members attenuated")}
                    </span>
                </div>
            </div>

            <Button
                variant="dangerPrimary"
                size="small"
                onClick={() => voiceIsolatorEngine.restoreAll()}
                style={{ fontSize: "11px", padding: "4px 10px", height: "28px" }}
            >
                {t("Restore All")}
            </Button>
        </div>
    );
}
