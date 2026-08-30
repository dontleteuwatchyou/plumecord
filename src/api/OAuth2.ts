/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const API_BASE = "https://api.nightcord.st";

import { openModal } from "@utils/modal";
import { OAuth2AuthorizeModal, React } from "@webpack/common";
import * as DataStore from "./DataStore";

export const OAUTH_TOKEN_KEY = "nightcord_oauth_token";

export async function beginDiscordOAuth(state?: string) {
    const url = new URL(`${API_BASE}/api/oauth2/signing`);
    if (state) {
        url.searchParams.set("state", state);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error("Failed to create OAuth URL");
    }

    return response.json() as Promise<{
        url: string;
        redirectUri: string;
        scopes: string[];
    }>;
}

export async function checkOAuthToken(token: string) {
    try {
        const response = await fetch(`${API_BASE}/api/oauth2/check?token=${encodeURIComponent(token)}`);
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch (e) {
        console.error("Failed to check OAuth token:", e);
        return null;
    }
}

export async function getStoredToken(): Promise<string | null> {
    return (await DataStore.get(OAUTH_TOKEN_KEY)) || null;
}

export async function storeToken(token: string) {
    await DataStore.set(OAUTH_TOKEN_KEY, token);
}

export async function clearToken() {
    await DataStore.del(OAUTH_TOKEN_KEY);
}

export async function authorizeUser(): Promise<string | null> {
    const existing = await getStoredToken();
    if (existing) {
        const check = await checkOAuthToken(existing);
        if (check) return existing;
    }

    let clientId: string;
    let redirectUri: string;
    let scopes: string[];

    try {
        const signing = await beginDiscordOAuth();
        const authUrl = new URL(signing.url);
        clientId = authUrl.searchParams.get("client_id")!;
        redirectUri = signing.redirectUri;
        scopes = signing.scopes ?? ["identify"];
    } catch (e) {
        console.error("[OAuth2] Failed to start OAuth flow:", e);
        return null;
    }

    return new Promise<string | null>(resolve => {
        openModal((props: any) =>
            React.createElement(OAuth2AuthorizeModal, {
                ...props,
                scopes,
                responseType: "code",
                redirectUri,
                permissions: 0n,
                clientId,
                cancelCompletesFlow: false,
                callback: async ({ location }: any) => {
                    if (!location) {
                        resolve(null);
                        return;
                    }
                    try {
                        const res = await fetch(location, { headers: { Accept: "application/json" } });
                        const data = await res.json();
                        if (data.token) {
                            await storeToken(data.token);
                            resolve(data.token);
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        console.error("[OAuth2] Failed to exchange token:", e);
                        resolve(null);
                    }
                }
            })
        );
    });
}
