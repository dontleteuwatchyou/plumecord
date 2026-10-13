/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import {
    Button,
    ChannelStore,
    IconUtils,
    NavigationRouter,
    React,
    RelationshipStore,
    RestAPI,
    Text,
    useEffect,
    useRef,
    useState,
    UserStore,
} from "@webpack/common";

import { t } from "../autoTranslateNightcord";
import { settings } from "./index";

export interface SearchResult {
    id: string;
    channelId: string;
    channelName: string;
    author: {
        id: string;
        username: string;
        global_name?: string;
        avatar?: string;
        discriminator?: string;
    };
    content: string;
    timestamp: string;
    attachmentsCount: number;
}

function SearchIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
                clipRule="evenodd"
            />
        </svg>
    );
}

function JumpIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M10 5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V7.41l-9.3 9.3a1 1 0 0 1-1.4-1.42L16.58 6H11a1 1 0 0 1-1-1Z"
                clipRule="evenodd"
            />
        </svg>
    );
}

function highlightQuery(text: string, query: string) {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`, "gi"));
    return (
        <>
            {parts.map((part, i) =>
                part.toLowerCase() === query.toLowerCase() ? (
                    <mark key={i} className="nc-global-dm-highlight">
                        {part}
                    </mark>
                ) : (
                    part
                )
            )}
        </>
    );
}

function formatTimestamp(isoString: string): string {
    try {
        const date = new Date(isoString);
        return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "";
    }
}

function collectTargetChannels(includeClosed: boolean, includeGroupDMs: boolean): Array<{ id: string; name: string; recipientId?: string }> {
    const list: Array<{ id: string; name: string; recipientId?: string }> = [];
    const seen = new Set<string>();

    // 1. Open channels from ChannelStore
    const sorted = ChannelStore.getSortedPrivateChannels?.() ?? [];
    for (const ch of sorted) {
        if (!ch?.id || seen.has(ch.id)) continue;
        if (ch.isMultiUserDM?.() && !includeGroupDMs) continue;

        let name = ch.name || "";
        let recId: string | undefined = undefined;
        if (!name && ch.isDM?.()) {
            recId = ch.getRecipientId?.() ?? ch.recipientId ?? ch.recipients?.[0];
            if (recId) {
                const u = UserStore.getUser(recId);
                name = u?.globalName || u?.username || "DM";
            }
        }
        if (!name) name = ch.isMultiUserDM?.() ? "Group DM" : "Direct Message";

        seen.add(ch.id);
        list.push({ id: ch.id, name, recipientId: recId });
    }

    // 2. Closed and past DMs from relationship store
    if (includeClosed) {
        const friendIds = RelationshipStore.getFriendIDs?.() ?? [];
        const blockedIds = RelationshipStore.getBlockedIDs?.() ?? [];
        const allUserIds = [...new Set([...friendIds, ...blockedIds])];

        for (const uId of allUserIds) {
            const chId = ChannelStore.getDMFromUserId?.(uId);
            if (chId && !seen.has(chId)) {
                seen.add(chId);
                const u = UserStore.getUser(uId);
                const name = u?.globalName || u?.username || "Direct Message";
                list.push({ id: chId, name, recipientId: uId });
            }
        }
    }

    return list;
}

export function GlobalDMSearchModal({
    modalProps,
    initialQuery = "",
    onClose,
}: {
    modalProps: ModalProps;
    initialQuery?: string;
    onClose: () => void;
}) {
    const [query, setQuery] = useState(initialQuery);
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [scannedChannels, setScannedChannels] = useState(0);
    const [totalChannels, setTotalChannels] = useState(0);

    const activeSearchId = useRef(0);
    const searchTimeout = useRef<any>(null);

    const performSearch = (searchTerm: string) => {
        const clean = searchTerm.trim();
        if (!clean) {
            setResults([]);
            setIsSearching(false);
            setScannedChannels(0);
            return;
        }

        const searchId = ++activeSearchId.current;
        const includeClosed = Boolean(settings.store.includeClosedDMs);
        const includeGroupDMs = Boolean(settings.store.includeGroupDMs);
        const limitPerDM = Math.max(1, settings.store.searchLimitPerDM || 5);

        const channels = collectTargetChannels(includeClosed, includeGroupDMs);
        setTotalChannels(channels.length);
        setScannedChannels(0);
        setResults([]);
        setIsSearching(true);

        const accumulated: SearchResult[] = [];
        const BATCH_SIZE = 4;

        (async () => {
            for (let i = 0; i < channels.length; i += BATCH_SIZE) {
                if (activeSearchId.current !== searchId) return;

                const batch = channels.slice(i, i + BATCH_SIZE);
                await Promise.all(
                    batch.map(async (ch) => {
                        if (activeSearchId.current !== searchId) return;
                        try {
                            const res = await RestAPI.get({
                                url: `/channels/${ch.id}/messages/search`,
                                query: { content: clean },
                            });

                            if (res?.body?.messages && Array.isArray(res.body.messages)) {
                                const hitGroups = res.body.messages.slice(0, limitPerDM);
                                for (const group of hitGroups) {
                                    const hit = Array.isArray(group) ? (group.find((m: any) => m.hit) || group[0]) : group;
                                    if (hit?.id && hit.content) {
                                        accumulated.push({
                                            id: hit.id,
                                            channelId: ch.id,
                                            channelName: ch.name,
                                            author: hit.author,
                                            content: hit.content,
                                            timestamp: hit.timestamp,
                                            attachmentsCount: hit.attachments?.length || 0,
                                        });
                                    }
                                }
                            }
                        } catch {
                            // Ignore channels where search returns 403/404
                        }
                    })
                );

                if (activeSearchId.current === searchId) {
                    setScannedChannels(Math.min(channels.length, i + batch.length));
                    setResults([...accumulated]);
                }

                await new Promise((r) => setTimeout(r, 60));
            }

            if (activeSearchId.current === searchId) {
                setIsSearching(false);
            }
        })();
    };

    const handleQueryChange = (val: string) => {
        setQuery(val);
        clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            performSearch(val);
        }, 320);
    };

    useEffect(() => {
        if (initialQuery.trim()) {
            performSearch(initialQuery);
        }
        return () => {
            clearTimeout(searchTimeout.current);
            activeSearchId.current++;
        };
    }, []);

    const handleJump = (msg: SearchResult) => {
        onClose();
        setTimeout(() => {
            try {
                NavigationRouter.transitionTo(`/channels/@me/${msg.channelId}/${msg.id}`);
            } catch {}
        }, 120);
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE} className="nc-global-dm-search-modal theme-dark">
            <ModalHeader className="nc-global-dm-search-header" separator={false}>
                <div className="nc-global-dm-header-top">
                    <div>
                        <Text variant="heading-lg/bold" className="nc-global-dm-title">
                            {t("Global DM Search")}
                        </Text>
                        <Text variant="text-sm/normal" className="nc-global-dm-subtitle">
                            {t("Search across all your Direct Messages and Group DMs.")}
                        </Text>
                    </div>
                    <ModalCloseButton onClick={onClose} />
                </div>
                <div className="nc-global-dm-search-bar-wrap">
                    <span className="nc-global-dm-search-icon-inside">
                        <SearchIcon />
                    </span>
                    <input
                        className="nc-global-dm-search-input"
                        type="text"
                        placeholder={t("Search messages across all DMs...")}
                        value={query}
                        autoFocus
                        onChange={(e) => handleQueryChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                performSearch(query);
                            }
                        }}
                    />
                </div>
            </ModalHeader>

            <ModalContent className="nc-global-dm-content">
                {query.trim().length === 0 ? (
                    <div className="nc-global-dm-status-text">
                        {t("Type a keyword to begin searching.")}
                    </div>
                ) : isSearching && results.length === 0 ? (
                    <div className="nc-global-dm-status-text">
                        {t("Searching across DMs...")} ({scannedChannels}/{totalChannels})
                    </div>
                ) : results.length === 0 ? (
                    <div className="nc-global-dm-status-text">
                        {t("No messages found.")}
                    </div>
                ) : (
                    results.map((res) => {
                        const avatarUrl =
                            res.author?.id && res.author?.avatar
                                ? IconUtils.getUserAvatarURL(res.author as any)
                                : IconUtils.getDefaultAvatarURL("0");

                        const authorName = res.author?.global_name || res.author?.username || "Unknown";

                        return (
                            <div key={`${res.channelId}-${res.id}`} className="nc-global-dm-result-card">
                                <div className="nc-global-dm-card-header">
                                    <div className="nc-global-dm-author-info">
                                        <img src={avatarUrl} alt="" className="nc-global-dm-avatar" />
                                        <span className="nc-global-dm-author-name">{authorName}</span>
                                        <span className="nc-global-dm-channel-tag">{res.channelName}</span>
                                    </div>
                                    <span className="nc-global-dm-timestamp">{formatTimestamp(res.timestamp)}</span>
                                </div>
                                <div className="nc-global-dm-message-body">
                                    {highlightQuery(res.content, query)}
                                </div>
                                <div className="nc-global-dm-card-footer">
                                    <Button
                                        size={Button.Sizes.SMALL}
                                        color={Button.Colors.BRAND}
                                        onClick={() => handleJump(res)}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <JumpIcon />
                                            <span>{t("Jump to message")}</span>
                                        </div>
                                    </Button>
                                </div>
                            </div>
                        );
                    })
                )}
            </ModalContent>

            <ModalFooter className="nc-global-dm-footer">
                <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                    {results.length > 0
                        ? `${results.length} ${t("messages found across")} ${
                              new Set(results.map((r) => r.channelId)).size
                          } ${t("channels")}`
                        : isSearching
                        ? `${t("Searching across DMs...")} (${scannedChannels}/${totalChannels})`
                        : ""}
                </Text>
                <Button color={Button.Colors.PRIMARY} onClick={onClose}>
                    {t("Close")}
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}
