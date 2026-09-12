/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { showNotification } from "@api/Notifications";
import { definePluginSettings, Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { DeleteIcon, GhostIcon, WarningIcon, NoEntrySignIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import SettingsPlugin from "@plugins/_core/settings";
import { classes, removeFromArray } from "@utils/misc";
import definePlugin, { OptionType, PluginNative, ReporterTestable } from "@utils/types";
import { Alerts, Button, React, SettingsRouter, showToast, TextInput, Toasts } from "@webpack/common";
import { t } from "../autoTranslateNightcord";

import type { ActionInfo, InstallInfo, NativeResult } from "./native";

const Native = ((VencordNative.pluginHelpers as any).GhostInstaller || (VencordNative.pluginHelpers as any).GhostClientInstaller) as PluginNative<typeof import("./native")>;
const SETTINGS_ENTRY_KEY = "nightcord_ghost_client_installer";

type LogLevel = "error" | "info" | "success" | "warning";

interface LogEntry {
    id: number;
    line: string;
}

let lastRepatchNotificationKey = "";
let nextLogId = 0;

function appendLogs(existingLogs: LogEntry[], newLogs: string[] | undefined): LogEntry[] {
    return [...existingLogs, ...(newLogs ?? []).map(line => ({ id: nextLogId++, line }))];
}

function notifyRepatchIfNeeded(info: InstallInfo): void {
    if (!info.repatchWarning) return;

    const key = `${info.discordRoot}:${info.clientLabel}:${info.repatchWarning}`;
    if (lastRepatchNotificationKey === key) return;

    lastRepatchNotificationKey = key;
    showNotification({
        title: t("GhostInstaller"),
        body: info.repatchWarning,
        permanent: true,
        onClick: () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`)
    });
}

function GhostWarning() {
    return (
        <div className="vc-ghost-installer-warning">
            <Heading tag="h3">{t("GhostInstaller Warning")}</Heading>
            <Paragraph>
                {t("This installer downloads and injects GhostClient and its companion ghost-server into Nightcord. It enables multi-account voice join, screen streaming, and custom audio input.")}
            </Paragraph>
            <Paragraph>
                {t("GhostClient remains permanently installed across Discord updates until you click Delete. Clicking Delete cleanly terminates the local server and removes all injected files.")}
            </Paragraph>
        </div>
    );
}

function InfoLine({ label, value }: { label: string; value: string; }) {
    return (
        <div className="vc-ghost-installer-info-line">
            <span>{label}</span>
            <code>{value || "--"}</code>
        </div>
    );
}

function InstallationStatus({ info }: { info: InstallInfo | ActionInfo; }) {
    if (info.installStatus === "installed") {
        return (
            <div className={classes("vc-ghost-installer-install-status", "vc-ghost-installer-install-status-installed")}>
                <GhostIcon width={28} height={28} />
                <div>
                    <Heading tag="h3">{t("GhostClient is installed")}</Heading>
                    <Paragraph>{t("GhostClient is active and ghost-server is ready for")} {info.clientLabel}.</Paragraph>
                </div>
            </div>
        );
    }

    if (info.installStatus === "needsReinstall") {
        return (
            <div className={classes("vc-ghost-installer-install-status", "vc-ghost-installer-install-status-needs-reinstall")}>
                <WarningIcon width={28} height={28} />
                <div>
                    <Heading tag="h3">{t("GhostClient must be installed again")}</Heading>
                    <Paragraph>{info.repatchWarning || t("Discord was updated after GhostClient was installed. Click Patch to reinstall.")}</Paragraph>
                </div>
            </div>
        );
    }

    return (
        <div className={classes("vc-ghost-installer-install-status", "vc-ghost-installer-install-status-not-installed")}>
            <NoEntrySignIcon width={28} height={28} />
            <div>
                <Heading tag="h3">{t("GhostClient is not installed")}</Heading>
                <Paragraph>{t("Click Patch to download from GitHub and install GhostClient.")}</Paragraph>
            </div>
        </div>
    );
}

function LogLine({ entry }: { entry: LogEntry; }) {
    const match = /^\[([^\]]+)]\s*(.*)$/.exec(entry.line);
    const timestamp = match?.[1] || "";
    const rawMessage = match?.[2] || entry.line;
    const level: LogLevel = /^(?:FAIL|ERROR):/i.test(rawMessage)
        ? "error"
        : /^WARN:/i.test(rawMessage)
            ? "warning"
            : /^OK:/i.test(rawMessage)
                ? "success"
                : "info";
    const message = rawMessage.replace(/^(?:FAIL|ERROR|WARN|OK):\s*/i, "");

    return (
        <div className={classes("vc-ghost-installer-log-line", `vc-ghost-installer-log-line-${level}`)}>
            <span className="vc-ghost-installer-log-time">{timestamp || "--"}</span>
            <span className="vc-ghost-installer-log-level">{level}</span>
            <span className="vc-ghost-installer-log-message">{message}</span>
        </div>
    );
}

function GhostClientInstallerPanel() {
    const [root, setRoot] = React.useState("");
    const [githubUrl, setGithubUrl] = React.useState("");
    const [info, setInfo] = React.useState<InstallInfo | ActionInfo | null>(null);
    const [status, setStatus] = React.useState("Ready.");
    const [logs, setLogs] = React.useState<LogEntry[]>([]);
    const [busy, setBusy] = React.useState(false);

    async function runNative<T>(action: () => Promise<NativeResult<T>>): Promise<T | null> {
        setBusy(true);
        try {
            const result = await action();
            setLogs(currentLogs => appendLogs(currentLogs, result.logs));

            if (!result.success) {
                setStatus(result.error);
                showToast(result.error, Toasts.Type.FAILURE);
                return null;
            }

            return result.data;
        } finally {
            setBusy(false);
        }
    }

    async function autoDetect(): Promise<void> {
        const detected = await runNative(() => Native.autoDetect());
        if (!detected) return;

        setInfo(detected);
        setRoot(detected.discordRoot);
        if (!githubUrl && detected.defaultGithubUrl) {
            setGithubUrl(detected.defaultGithubUrl);
        }
        setStatus(detected.repatchWarning || t("Discord install detected."));
        notifyRepatchIfNeeded(detected);
    }

    async function loadLogs(): Promise<void> {
        const result = await Native.readLogs();
        if (result.success) setLogs(appendLogs([], result.data));
    }

    async function clearLogs(): Promise<void> {
        const cleared = await runNative(() => Native.clearLogs());
        if (!cleared) return;

        setLogs([]);
        setStatus(t("Logs cleared."));
        showToast(t("Logs cleared."), Toasts.Type.SUCCESS);
    }

    async function browse(): Promise<void> {
        const selected = await runNative(() => Native.chooseDiscordRoot());
        if (!selected) return;

        setInfo(selected);
        setRoot(selected.discordRoot);
        setStatus(selected.repatchWarning || t("Discord install selected."));
        notifyRepatchIfNeeded(selected);
    }

    async function runPatch(): Promise<void> {
        const targetUrl = githubUrl.trim() || info?.defaultGithubUrl;
        if (!targetUrl) {
            setStatus(t("Please provide a valid release URL."));
            showToast(t("Please provide a valid release URL."), Toasts.Type.FAILURE);
            return;
        }

        const result = await runNative<ActionInfo>(() => Native.patchGhostClient({
            githubUrl: targetUrl,
            discordRoot: root
        }));

        if (!result) return;
        setInfo(result);
        // Auto-enable the ghostClient plugin so it activates immediately after patching
        try { (Settings.plugins["ghostClient"] ??= {} as any).enabled = true; } catch {}
        setStatus(t("GhostClient installed successfully."));
        showToast(t("GhostClient installed successfully."), Toasts.Type.SUCCESS);
    }

    async function runDelete(): Promise<void> {
        const result = await runNative<ActionInfo>(() => Native.revertGhostClient({
            discordRoot: root
        }));

        if (!result) return;
        setInfo(result);
        setStatus(t("GhostClient deleted successfully."));
        showToast(t("GhostClient deleted successfully."), Toasts.Type.SUCCESS);
    }

    function confirmPatch() {
        Alerts.show({
            title: t("Install GhostClient"),
            confirmText: t("Patch and Inject"),
            cancelText: t("Cancel"),
            confirmColor: "brand",
            body: (
                <div style={{ color: "var(--text-normal, #dbdee1)", fontSize: "14px", lineHeight: "1.4" }}>
                    {t("This will download GhostClient and ghost-server from the release source, inject them into Nightcord, and launch the background service. Do you want to proceed?")}
                </div>
            ),
            onConfirm: () => void runPatch()
        });
    }

    function confirmDelete() {
        Alerts.show({
            title: t("Delete GhostClient"),
            confirmText: t("Delete"),
            cancelText: t("Cancel"),
            confirmColor: "brand-danger",
            body: (
                <div style={{ color: "var(--text-normal, #dbdee1)", fontSize: "14px", lineHeight: "1.4" }}>
                    {t("Are you sure you want to completely delete GhostClient? This will shut down the local server, remove all plugin files, and recompile Nightcord cleanly.")}
                </div>
            ),
            onConfirm: () => void runDelete()
        });
    }

    React.useEffect(() => {
        void autoDetect();
        void loadLogs();
    }, []);

    return (
        <div className="vc-ghost-installer-root">
            <div className="vc-ghost-installer-controls">
                <div className="vc-ghost-installer-select-grid">
                    <div className="vc-ghost-installer-select-row">
                        <span>{t("Release URL")}</span>
                        <TextInput
                            value={githubUrl}
                            placeholder="https://source.nightcord.st/nightcord/ghostclient/releases"
                            onChange={(value: string) => setGithubUrl(value)}
                            disabled={busy}
                        />
                    </div>
                    <div className="vc-ghost-installer-select-row">
                        <span>{t("Discord Install Folder")}</span>
                        <TextInput
                            value={root}
                            placeholder={t("Discord install folder")}
                            onChange={(value: string) => setRoot(value)}
                            disabled={busy}
                        />
                    </div>
                </div>

                <div className="vc-ghost-installer-buttons">
                    <Button
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={() => void autoDetect()}
                    >{t("Auto-detect")}</Button>
                    <Button
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={() => void browse()}
                    >{t("Browse")}</Button>
                    <Button
                        color={Button.Colors.GREEN}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={confirmPatch}
                    >{t("Patch GhostClient")}</Button>
                    <Button
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={confirmDelete}
                    >{t("Delete GhostClient")}</Button>
                </div>
            </div>

            {info && <InstallationStatus info={info} />}

            {info && (
                <div className="vc-ghost-installer-info">
                    <InfoLine label={t("Client")} value={info.clientLabel} />
                    <InfoLine label={t("Platform")} value={`${info.platformLabel} ${info.readableOs}`} />
                    <InfoLine label={t("Server Status")} value={info.ghostServerStatus} />
                    <InfoLine label={t("Plugin Path")} value={info.ghostPluginPath} />
                    <InfoLine label={t("Server Path")} value={info.ghostServerPath} />
                    {"logPath" in info && <InfoLine label={t("Log file")} value={info.logPath} />}
                    <InfoLine label={t("Last Patch")} value={info.lastPatchLabel} />
                </div>
            )}

            <Paragraph className="vc-ghost-installer-status">{busy ? t("Working...") : status}</Paragraph>

            <div className="vc-ghost-installer-log-panel">
                <div className="vc-ghost-installer-log-header">
                    <div>
                        <Heading tag="h3">{t("Installer logs")}</Heading>
                        <Paragraph>{logs.length ? `${logs.length} ${t("log entries.")}` : t("No log entries yet.")}</Paragraph>
                    </div>
                    <Button
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        disabled={busy || !logs.length}
                        onClick={() => void clearLogs()}
                    >
                        <DeleteIcon width={16} height={16} />
                        {t("Clear logs")}
                    </Button>
                </div>
                <div className="vc-ghost-installer-log" role="log" aria-live="polite">
                    {logs.length
                        ? logs.slice(-200).map(entry => <LogLine key={entry.id} entry={entry} />)
                        : <div className="vc-ghost-installer-log-empty">{t("GhostInstaller activity will appear here.")}</div>}
                </div>
            </div>
        </div>
    );
}

function GhostInstallerPage() {
    return (
        <>
            <GhostWarning />
            <GhostClientInstallerPanel />
        </>
    );
}

const settings = definePluginSettings({
    installer: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(GhostClientInstallerPanel, { noop: true }),
    }
});

export default definePlugin({
    name: "GhostInstaller",
    description: "Downloads, patches, and manages GhostClient and its background companion server from GitHub.",
    tags: ["Utility"],
    authors: [{ name: "Nightcord", id: 0n }],
    enabledByDefault: true,
    reporterTestable: ReporterTestable.None,
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(GhostWarning, { noop: true }),
    toolboxActions: {
        [t("Open GhostInstaller")]: () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    },

    start() {
        if (!SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: t("GhostInstaller"),
                Component: ErrorBoundary.wrap(GhostInstallerPage, { noop: true }),
                Icon: GhostIcon,
            });
        }

        void Native.autoDetect().then(result => {
            if (result.success) notifyRepatchIfNeeded(result.data);
        }, () => void 0);
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
    }
});
