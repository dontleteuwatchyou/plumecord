/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { closeModal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import {
    FluxDispatcher,
    GuildMemberStore,
    Menu,
    RelationshipStore,
    SelectedGuildStore,
    showToast,
    Text,
    TextInput,
    Toasts,
    UserStore,
    useState
} from "@webpack/common";
import { t } from "../autoTranslateNightcord";

const DATA_STORE_KEY = "AddNickname_custom_nicknames";

type NicknameDictionary = Record<string, string>;
let customNicknames: NicknameDictionary = {};

const settings = definePluginSettings({
    overrideServerNick: {
        type: OptionType.BOOLEAN,
        description: "Override server-specific nicknames with your custom nickname",
        default: true
    },
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a nickname is saved or reset",
        default: true
    }
});

function AddNicknameIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#ffffff", flexShrink: 0 }}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
    );
}

async function setCustomNickname(userId: string, nickname: string) {
    const trimmed = nickname.trim();
    if (trimmed) {
        customNicknames[userId] = trimmed;
    } else {
        delete customNicknames[userId];
    }
    await DataStore.set(DATA_STORE_KEY, customNicknames);
    triggerRerender(userId);
}

async function resetCustomNickname(userId: string) {
    delete customNicknames[userId];
    await DataStore.set(DATA_STORE_KEY, customNicknames);
    triggerRerender(userId);
}

function triggerRerender(userId: string) {
    const user = UserStore.getUser(userId);
    if (user) {
        if (Object.prototype.hasOwnProperty.call(user, "globalName")) {
            (user as any).__addNickname_origGlobalName = user.globalName;
            delete (user as any).globalName;
        }

        try {
            FluxDispatcher.dispatch({
                type: "USER_UPDATE",
                user: {
                    ...user,
                    id: userId,
                    globalName: customNicknames[userId] || (user as any).__addNickname_origGlobalName || (user as any).globalName
                }
            });
        } catch {}
    }

    try {
        FluxDispatcher.dispatch({
            type: "RELATIONSHIP_UPDATE",
            relationship: {
                id: userId,
                nickname: customNicknames[userId] ?? null,
                type: RelationshipStore?.isFriend?.(userId) ? 1 : 0
            }
        });
    } catch {}

    const selectedGuildId = SelectedGuildStore?.getGuildId?.();
    if (selectedGuildId && GuildMemberStore) {
        try {
            const member = GuildMemberStore.getMember(selectedGuildId, userId);
            if (member) {
                FluxDispatcher.dispatch({
                    type: "GUILD_MEMBER_UPDATE",
                    guildId: selectedGuildId,
                    user: user || { id: userId },
                    roles: member.roles ?? [],
                    nick: customNicknames[userId] ?? (settings.store.overrideServerNick ? null : member.nick) ?? null
                });
            }
        } catch {}
    }
}

function AddNicknameModal({ modalProps, user }: { modalProps: ModalProps; user: any; }) {
    const currentCustom = customNicknames[user.id] ?? "";
    const [value, setValue] = useState(currentCustom);

    const handleSave = async () => {
        const trimmed = value.trim();
        if (trimmed) {
            await setCustomNickname(user.id, trimmed);
            if (settings.store.showToast) {
                showToast(t("Nickname updated"), Toasts.Type.SUCCESS);
            }
        } else {
            await resetCustomNickname(user.id);
            if (settings.store.showToast) {
                showToast(t("Nickname reset"), Toasts.Type.SUCCESS);
            }
        }
        modalProps.onClose();
    };

    const handleReset = async () => {
        await resetCustomNickname(user.id);
        if (settings.store.showToast) {
            showToast(t("Nickname reset"), Toasts.Type.SUCCESS);
        }
        modalProps.onClose();
    };

    const displayName = (user as any).__addNickname_origGlobalName ?? user.globalName ?? user.username;

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader separator={false} style={{ padding: "20px 24px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#ffffff" }}>
                    <AddNicknameIcon />
                    <Text variant="heading-lg/bold" style={{ color: "#ffffff", fontWeight: 700, margin: 0 }}>
                        {currentCustom ? t("Edit Nickname") : t("Add Nickname")}
                    </Text>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent style={{ padding: "0 24px 20px" }}>
                <Text variant="text-sm/normal" style={{ color: "var(--text-muted, #949ba4)", marginBottom: 14 }}>
                    {t("Custom nickname for this user")}: <strong style={{ color: "#ffffff" }}>{displayName}</strong>
                </Text>
                <TextInput
                    value={value}
                    placeholder={displayName}
                    onChange={setValue}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            void handleSave();
                        }
                    }}
                    autoFocus
                />
            </ModalContent>
            <ModalFooter style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    {currentCustom ? (
                        <Button
                            color={Button.Colors.RED}
                            look={Button.Looks.LINK}
                            size={Button.Sizes.SMALL}
                            onClick={handleReset}
                        >
                            {t("Reset Nickname")}
                        </Button>
                    ) : null}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                    <Button
                        color={Button.Colors.PRIMARY}
                        look={Button.Looks.LINK}
                        size={Button.Sizes.SMALL}
                        onClick={modalProps.onClose}
                    >
                        {t("Cancel")}
                    </Button>
                    <Button
                        color={Button.Colors.BRAND}
                        size={Button.Sizes.SMALL}
                        onClick={handleSave}
                    >
                        {t("Save")}
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function openAddNicknameModal(user: any) {
    if (!user) return;
    openModal(modalProps => (
        <AddNicknameModal modalProps={modalProps} user={user} />
    ));
}

let origGlobalNameDesc: PropertyDescriptor | null = null;
let origDisplayNameDesc: PropertyDescriptor | null = null;
let origGetNickname: typeof RelationshipStore.getNickname | null = null;
let origGetNicknames: typeof RelationshipStore.getNicknames | null = null;
let origGetNick: typeof GuildMemberStore.getNick | null = null;
let origGetMember: typeof GuildMemberStore.getMember | null = null;
let origGetUser: typeof UserStore.getUser | null = null;

function patchUserPrototype() {
    const currentUser = UserStore.getCurrentUser();
    const UserProto = currentUser ? Object.getPrototypeOf(currentUser) : null;
    if (!UserProto || origGlobalNameDesc) return;

    origGlobalNameDesc = Object.getOwnPropertyDescriptor(UserProto, "globalName") || {
        configurable: true,
        enumerable: true,
        writable: true,
        value: null
    };

    Object.defineProperty(UserProto, "globalName", {
        get() {
            const custom = customNicknames[this.id];
            if (custom) return custom;
            if (origGlobalNameDesc?.get) {
                return origGlobalNameDesc.get.call(this);
            }
            return this.__addNickname_origGlobalName;
        },
        set(val: string | null) {
            this.__addNickname_origGlobalName = val;
            if (origGlobalNameDesc?.set) {
                origGlobalNameDesc.set.call(this, val);
            }
        },
        configurable: true,
        enumerable: true
    });

    if (Object.prototype.hasOwnProperty.call(UserProto, "displayName")) {
        origDisplayNameDesc = Object.getOwnPropertyDescriptor(UserProto, "displayName") || null;
        if (origDisplayNameDesc) {
            Object.defineProperty(UserProto, "displayName", {
                get() {
                    const custom = customNicknames[this.id];
                    if (custom) return custom;
                    if (origDisplayNameDesc?.get) {
                        return origDisplayNameDesc.get.call(this);
                    }
                    return this.__addNickname_origDisplayName ?? this.globalName ?? this.username;
                },
                set(val: string | null) {
                    this.__addNickname_origDisplayName = val;
                    if (origDisplayNameDesc?.set) {
                        origDisplayNameDesc.set.call(this, val);
                    }
                },
                configurable: true,
                enumerable: true
            });
        }
    }

    applyToExistingUsers();
}

function applyToExistingUsers() {
    try {
        const users = (UserStore as any)?._users;
        if (users && typeof users === "object") {
            for (const id in users) {
                const u = users[id];
                if (u && typeof u === "object" && Object.prototype.hasOwnProperty.call(u, "globalName")) {
                    u.__addNickname_origGlobalName = u.globalName;
                    delete u.globalName;
                }
            }
        }
    } catch {}
}

function unpatchUserPrototype() {
    const currentUser = UserStore.getCurrentUser();
    const UserProto = currentUser ? Object.getPrototypeOf(currentUser) : null;
    if (UserProto && origGlobalNameDesc) {
        Object.defineProperty(UserProto, "globalName", origGlobalNameDesc);
        origGlobalNameDesc = null;

        if (origDisplayNameDesc) {
            Object.defineProperty(UserProto, "displayName", origDisplayNameDesc);
            origDisplayNameDesc = null;
        }

        const users = (UserStore as any)?._users;
        if (users && typeof users === "object") {
            for (const id in users) {
                const u = users[id];
                if (u && typeof u === "object" && "__addNickname_origGlobalName" in u) {
                    u.globalName = u.__addNickname_origGlobalName;
                    delete u.__addNickname_origGlobalName;
                }
                if (u && typeof u === "object" && "__addNickname_origDisplayName" in u) {
                    u.displayName = u.__addNickname_origDisplayName;
                    delete u.__addNickname_origDisplayName;
                }
            }
        }
    }
}

function patchStores() {
    if (RelationshipStore && !origGetNickname && typeof RelationshipStore.getNickname === "function") {
        origGetNickname = RelationshipStore.getNickname.bind(RelationshipStore);
        RelationshipStore.getNickname = (userId: string) => {
            return customNicknames[userId] || origGetNickname!(userId);
        };
    }

    if (RelationshipStore && !origGetNicknames && typeof RelationshipStore.getNicknames === "function") {
        origGetNicknames = RelationshipStore.getNicknames.bind(RelationshipStore);
        RelationshipStore.getNicknames = () => {
            const orig = origGetNicknames!() ?? {};
            return { ...orig, ...customNicknames };
        };
    }

    if (GuildMemberStore && !origGetNick && typeof GuildMemberStore.getNick === "function") {
        origGetNick = GuildMemberStore.getNick.bind(GuildMemberStore);
        GuildMemberStore.getNick = (guildId: string, userId: string) => {
            const custom = customNicknames[userId];
            if (custom) {
                if (settings.store.overrideServerNick) {
                    return custom;
                }
                const originalNick = origGetNick!(guildId, userId);
                return originalNick || custom;
            }
            return origGetNick!(guildId, userId);
        };
    }

    if (GuildMemberStore && !origGetMember && typeof GuildMemberStore.getMember === "function") {
        origGetMember = GuildMemberStore.getMember.bind(GuildMemberStore);
        GuildMemberStore.getMember = (guildId: string, userId: string) => {
            const member = origGetMember!(guildId, userId);
            const custom = customNicknames[userId];
            if (member && custom) {
                if (settings.store.overrideServerNick || !member.nick) {
                    return { ...member, nick: custom };
                }
            }
            return member;
        };
    }

    if (UserStore && !origGetUser && typeof UserStore.getUser === "function") {
        origGetUser = UserStore.getUser.bind(UserStore);
        UserStore.getUser = (userId: string) => {
            const user = origGetUser!(userId);
            if (user && Object.prototype.hasOwnProperty.call(user, "globalName")) {
                (user as any).__addNickname_origGlobalName = user.globalName;
                delete (user as any).globalName;
            }
            return user;
        };
    }
}

function unpatchStores() {
    if (origGetNickname && RelationshipStore) {
        RelationshipStore.getNickname = origGetNickname;
        origGetNickname = null;
    }
    if (origGetNicknames && RelationshipStore) {
        RelationshipStore.getNicknames = origGetNicknames;
        origGetNicknames = null;
    }
    if (origGetNick && GuildMemberStore) {
        GuildMemberStore.getNick = origGetNick;
        origGetNick = null;
    }
    if (origGetMember && GuildMemberStore) {
        GuildMemberStore.getMember = origGetMember;
        origGetMember = null;
    }
    if (origGetUser && UserStore) {
        UserStore.getUser = origGetUser;
        origGetUser = null;
    }
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user, userId }: { user?: any; userId?: string; }) => {
    const targetUser = user ?? (userId ? UserStore.getUser(userId) : null);
    if (!targetUser || !targetUser.id) return;

    const hasCustom = Boolean(customNicknames[targetUser.id]);

    children.push(
        <Menu.MenuGroup key="nc-add-nickname-group">
            <Menu.MenuItem
                id="nc-add-nickname-action"
                label={hasCustom ? t("Edit Nickname") : t("Add Nickname")}
                icon={AddNicknameIcon}
                iconLeft={AddNicknameIcon}
                leadingAccessory={{
                    type: "icon",
                    icon: AddNicknameIcon
                }}
                action={() => openAddNicknameModal(targetUser)}
            />
            {hasCustom && (
                <Menu.MenuItem
                    id="nc-add-nickname-reset"
                    label={t("Reset Nickname")}
                    color="danger"
                    action={async () => {
                        await resetCustomNickname(targetUser.id);
                        if (settings.store.showToast) {
                            showToast(t("Nickname reset"), Toasts.Type.SUCCESS);
                        }
                    }}
                />
            )}
        </Menu.MenuGroup>
    );
};

const MessageContextMenuPatch: NavContextMenuPatchCallback = (children, { message }: { message?: any; }) => {
    const targetUser = message?.author;
    if (!targetUser || !targetUser.id) return;

    const hasCustom = Boolean(customNicknames[targetUser.id]);

    children.push(
        <Menu.MenuGroup key="nc-add-nickname-msg-group">
            <Menu.MenuItem
                id="nc-add-nickname-msg-action"
                label={hasCustom ? t("Edit Nickname") : t("Add Nickname")}
                icon={AddNicknameIcon}
                iconLeft={AddNicknameIcon}
                leadingAccessory={{
                    type: "icon",
                    icon: AddNicknameIcon
                }}
                action={() => openAddNicknameModal(targetUser)}
            />
            {hasCustom && (
                <Menu.MenuItem
                    id="nc-add-nickname-msg-reset"
                    label={t("Reset Nickname")}
                    color="danger"
                    action={async () => {
                        await resetCustomNickname(targetUser.id);
                        if (settings.store.showToast) {
                            showToast(t("Nickname reset"), Toasts.Type.SUCCESS);
                        }
                    }}
                />
            )}
        </Menu.MenuGroup>
    );
};

const ChannelContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel?: any; }) => {
    if (!channel?.isDM?.() && !channel?.isGroupDM?.()) return;
    const recipientId = channel?.getRecipientId?.();
    if (!recipientId) return;
    const targetUser = UserStore.getUser(recipientId);
    if (!targetUser) return;

    const hasCustom = Boolean(customNicknames[targetUser.id]);

    children.push(
        <Menu.MenuGroup key="nc-add-nickname-channel-group">
            <Menu.MenuItem
                id="nc-add-nickname-channel-action"
                label={hasCustom ? t("Edit Nickname") : t("Add Nickname")}
                icon={AddNicknameIcon}
                iconLeft={AddNicknameIcon}
                leadingAccessory={{
                    type: "icon",
                    icon: AddNicknameIcon
                }}
                action={() => openAddNicknameModal(targetUser)}
            />
            {hasCustom && (
                <Menu.MenuItem
                    id="nc-add-nickname-channel-reset"
                    label={t("Reset Nickname")}
                    color="danger"
                    action={async () => {
                        await resetCustomNickname(targetUser.id);
                        if (settings.store.showToast) {
                            showToast(t("Nickname reset"), Toasts.Type.SUCCESS);
                        }
                    }}
                />
            )}
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "AddNickname",
    description: "Assign a custom persistent nickname to any user, even if not friends or blocked.",
    authors: [{ name: "Nightcord", id: 0n }],
    settings,
    contextMenus: {
        "user-context": UserContextMenuPatch,
        "message": MessageContextMenuPatch,
        "channel-context": ChannelContextMenuPatch,
        "gdm-context": ChannelContextMenuPatch
    },

    flux: {
        CONNECTION_OPEN() {
            patchUserPrototype();
        }
    },

    async start() {
        customNicknames = (await DataStore.get<NicknameDictionary>(DATA_STORE_KEY)) ?? {};
        patchStores();
        patchUserPrototype();
    },

    stop() {
        unpatchStores();
        unpatchUserPrototype();
    }
});
