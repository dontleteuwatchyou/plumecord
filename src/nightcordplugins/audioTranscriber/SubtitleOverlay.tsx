/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Avatar, Button, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal, React, ScrollerThin, Text } from "@webpack/common";
import { ModalSize } from "@utils/modal";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { transcriberEngine } from "./engine";
import { SubtitleEntry, TranscriberSettings } from "./types";
import { t } from "../autoTranslateNightcord";

export function SubtitleHistoryModal({ onClose, transitionState }: { onClose: () => void; transitionState: any; }) {
    const [history, setHistory] = React.useState<SubtitleEntry[]>(() => transcriberEngine.getHistory());

    const handleClear = () => {
        transcriberEngine.clearHistory();
        setHistory([]);
    };

    return (
        <ModalRoot transitionState={transitionState} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false} style={{ padding: "20px 24px 12px 24px" }}>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <div>
                        <h2 style={{ color: "#ffffff", fontSize: "18px", fontWeight: 700, margin: 0 }}>
                            {t("Voice Subtitle History")}
                        </h2>
                        <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "13px" }}>
                            {history.length} {history.length === 1 ? t("entry") : t("entries")}
                        </span>
                    </div>
                    <ModalCloseButton onClick={onClose} />
                </Flex>
            </ModalHeader>

            <ModalContent style={{ padding: "12px 24px 24px 24px" }}>
                {history.length === 0 ? (
                    <Card variant="primary" style={{ padding: "24px", textAlign: "center", color: "var(--text-muted, #949ba4)" }}>
                        <span style={{ fontSize: "13px" }}>{t("No voice transcript history recorded yet.")}</span>
                    </Card>
                ) : (
                    <ScrollerThin fade style={{ maxHeight: "360px", paddingRight: "6px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {history.map((entry) => (
                                <div
                                    key={entry.id}
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: "12px",
                                        padding: "10px 14px",
                                        background: "var(--background-secondary, #2b2d31)",
                                        borderRadius: "8px",
                                        border: "1px solid rgba(255,255,255,0.05)"
                                    }}
                                >
                                    {entry.avatarUrl && <Avatar src={entry.avatarUrl} size="SIZE_32" />}
                                    <div style={{ flex: 1 }}>
                                        <Flex alignItems={FlexAlign.CENTER} gap="8px" style={{ marginBottom: "2px" }}>
                                            <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "13px" }}>
                                                {entry.username}
                                            </span>
                                            <span style={{ color: "var(--text-muted, #949ba4)", fontSize: "11px" }}>
                                                {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                            </span>
                                        </Flex>
                                        <p style={{ color: "var(--text-normal, #dbdee1)", fontSize: "13px", margin: 0, lineHeight: "1.4" }}>
                                            {entry.text}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollerThin>
                )}
            </ModalContent>

            <ModalFooter>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <Button
                        variant="dangerPrimary"
                        onClick={handleClear}
                        disabled={history.length === 0}
                    >
                        {t("Clear History")}
                    </Button>
                    <Button variant="primary" onClick={onClose}>
                        {t("Close")}
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>
    );
}

export function SubtitleOverlay({ settings }: { settings: TranscriberSettings; }) {
    const [subtitles, setSubtitles] = React.useState<SubtitleEntry[]>([]);
    const [visible, setVisible] = React.useState(false);
    const fadeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        const unsub = transcriberEngine.subscribe((newSubs) => {
            setSubtitles(newSubs);
            if (newSubs.length > 0 && newSubs[0].text) {
                setVisible(true);

                if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
                fadeTimerRef.current = setTimeout(() => {
                    setVisible(false);
                }, (settings.fadeDelay || 5) * 1000);
            }
        });

        return () => {
            unsub();
            if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        };
    }, [settings.fadeDelay]);

    if (!visible || subtitles.length === 0) return null;

    const current = subtitles[0];
    if (!current?.text) return null;

    const isTop = settings.position === "top";
    const bgAlpha = (settings.bgOpacity || 85) / 100;

    return (
        <div
            style={{
                position: "fixed",
                left: "50%",
                transform: "translateX(-50%)",
                bottom: isTop ? "auto" : "80px",
                top: isTop ? "50px" : "auto",
                zIndex: 9999,
                pointerEvents: "auto",
                maxWidth: "720px",
                width: "90%",
                display: "flex",
                justifyContent: "center",
                animation: "fadeInSubtitle 0.2s ease-out"
            }}
        >
            <style>{`
                @keyframes fadeInSubtitle {
                    from { opacity: 0; transform: translate(-50%, 8px); }
                    to { opacity: 1; transform: translate(-50%, 0); }
                }
            `}</style>
            <div
                style={{
                    backgroundColor: `rgba(17, 18, 20, ${bgAlpha})`,
                    backdropFilter: "blur(12px)",
                    borderRadius: "12px",
                    padding: "12px 18px",
                    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    width: "100%",
                    boxSizing: "border-box"
                }}
            >
                {/* Speaker Avatar */}
                {settings.showAvatar && current.avatarUrl && (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                        <Avatar src={current.avatarUrl} size="SIZE_32" />
                        <div
                            style={{
                                position: "absolute",
                                bottom: -2,
                                right: -2,
                                width: "10px",
                                height: "10px",
                                borderRadius: "50%",
                                backgroundColor: "var(--brand-500, #5865F2)",
                                border: "2px solid #111214"
                            }}
                        />
                    </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                    {settings.showUsername && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                            <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "12px", letterSpacing: "0.2px" }}>
                                {current.username}
                            </span>
                            {!current.isFinal && (
                                <span style={{ color: "var(--brand-500, #5865F2)", fontSize: "11px", fontWeight: 500 }}>
                                    ● {t("Speaking")}
                                </span>
                            )}
                        </div>
                    )}
                    <div
                        style={{
                            color: "#ffffff",
                            fontSize: `${settings.fontSize || 16}px`,
                            fontWeight: 500,
                            lineHeight: "1.35",
                            textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                            wordBreak: "break-word"
                        }}
                    >
                        {current.text}
                    </div>
                </div>

                {/* Open History Button */}
                <button
                    onClick={() => {
                        openModal(props => <SubtitleHistoryModal onClose={props.onClose} transitionState={props.transitionState} />);
                    }}
                    title={t("Open Voice Subtitle History")}
                    style={{
                        all: "unset",
                        padding: "6px 8px",
                        backgroundColor: "rgba(255, 255, 255, 0.08)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        color: "var(--text-muted, #949ba4)",
                        fontSize: "11px",
                        fontWeight: 600,
                        flexShrink: 0,
                        transition: "all 0.15s ease"
                    }}
                >
                    {t("History")}
                </button>
            </div>
        </div>
    );
}
