/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Button, openModal, React, Text } from "@webpack/common";
import { Flex, FlexAlign, FlexDirection, FlexJustify } from "@components/Flex";
import { Card } from "@components/Card";
import { fakeStreamEngine } from "./engine";
import { FakeStreamingModal } from "./modal";
import { t } from "../autoTranslateNightcord";

const settings = definePluginSettings({
    target: {
        type: OptionType.SELECT,
        description: "Default broadcast target for fake streaming.",
        options: [
            { label: "Webcam & Screen Share (Both)", value: "both", default: true },
            { label: "Webcam Only", value: "camera" },
            { label: "Screen Share Only", value: "screenshare" }
        ],
        restartNeeded: false,
        onChange: (val) => {
            fakeStreamEngine.updateConfig({ target: val as any });
        }
    },
    loop: {
        type: OptionType.BOOLEAN,
        description: "Loop video continuously by default.",
        default: true,
        restartNeeded: false,
        onChange: (val) => {
            fakeStreamEngine.updateConfig({ loop: val });
        }
    },
    includeAudio: {
        type: OptionType.BOOLEAN,
        description: "Broadcast pre-recorded video audio track.",
        default: true,
        restartNeeded: false,
        onChange: (val) => {
            fakeStreamEngine.updateConfig({ includeAudio: val });
        }
    }
});

function openFakeStreamControlModal() {
    openModal(props => <FakeStreamingModal onClose={props.onClose} transitionState={props.transitionState} />);
}

function FakeStreamingSettingsComponent() {
    const [config, setConfig] = React.useState(() => fakeStreamEngine.getConfig());

    React.useEffect(() => {
        const unsub = fakeStreamEngine.subscribe(() => {
            setConfig(fakeStreamEngine.getConfig());
        });
        return () => unsub();
    }, []);

    return (
        <div style={{ width: "100%", marginTop: "10px" }}>
            <Card variant="primary" outline style={{ padding: "16px", background: "var(--background-secondary, #2b2d31)", borderRadius: "8px", marginBottom: "12px" }}>
                <Flex alignItems={FlexAlign.CENTER} justifyContent={FlexJustify.BETWEEN} style={{ width: "100%" }}>
                    <div>
                        <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "14px", display: "block" }}>
                            {t("Fake Streaming Engine")}
                        </span>
                        <span style={{ color: config.active ? "var(--status-positive, #43b581)" : "var(--text-muted, #949ba4)", fontSize: "12px" }}>
                            {config.active
                                ? `● ${t("Active & Broadcasting")} (${config.videoName || "Video"})`
                                : `○ ${t("Inactive / Ready to broadcast")}`}
                        </span>
                    </div>
                    <Button
                        variant="primary"
                        onClick={openFakeStreamControlModal}
                    >
                        {t("Open Video Control Panel")}
                    </Button>
                </Flex>
            </Card>
        </div>
    );
}

export default definePlugin({
    name: "FakeStreaming",
    description: "Allows you to stream a pre-recorded video from your PC in a loop on your webcam or Discord screen share as if it were a live broadcast.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: FakeStreamingSettingsComponent,

    start() {
        fakeStreamEngine.updateConfig({
            target: settings.store.target || "both",
            loop: settings.store.loop !== false,
            includeAudio: settings.store.includeAudio !== false
        });
        fakeStreamEngine.startPatch();
    },

    stop() {
        fakeStreamEngine.stopPatch();
    }
});
