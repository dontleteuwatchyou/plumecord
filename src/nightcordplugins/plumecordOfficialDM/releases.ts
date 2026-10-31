/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Les messages du MP officiel Plume : les releases GitHub de Plume et de
// Plumecord, plus les annonces écrites à la main (announcements.json du dépôt
// Plume, publiées avec scripts\annonce.ps1). Mis en forme comme les
// publications qu'attend index.tsx (id, created_at, content), texte en Markdown.
//
// L'identifiant d'un message est sa date en millisecondes : index.tsx repère
// les nouveaux en comparant les identifiants, il faut donc qu'ils suivent
// l'ordre chronologique, annonces et releases mélangées.

import { localStorage } from "@utils/localStorage";

const REPOS = [
    { repo: "dontleteuwatchyou/plume", name: "Plume" },
    { repo: "dontleteuwatchyou/plumecord", name: "Plumecord" },
];
// Fichier brut (pas l'API) : pas de limite de 60 requêtes par heure.
const ANNOUNCEMENTS = "https://raw.githubusercontent.com/dontleteuwatchyou/plume/main/announcements.json";
const CACHE_KEY = "plumecord_official_dm_releases_v2";
// L'API de GitHub accepte 60 requêtes par heure et par adresse sans compte :
// deux requêtes toutes les 10 minutes au plus, pour tous les onglets.
const MAX_AGE = 10 * 60 * 1000;

interface Release {
    tag_name: string;
    name: string | null;
    body: string | null;
    html_url: string;
    published_at: string | null;
    draft: boolean;
    prerelease: boolean;
}

interface Announcement {
    id: number;
    date: string;
    title: string;
    message: string;
    link?: string;
}

export interface PostInfo {
    /** "Plume", "Plumecord" ou "Annonce". */
    product: string;
    url?: string;
}

/** Pour les boutons sous chaque message (index.tsx). */
export const releaseInfo = new Map<string, PostInfo>();

export interface ReleasePost {
    id: string;
    created_at: string;
    content: string;
    markdown: string;
    media_attachments: unknown[];
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function post(id: number, date: string, title: string, markdown: string, info: PostInfo): ReleasePost {
    releaseInfo.set(String(id), info);
    return { id: String(id), created_at: date, content: `<p>${escapeHtml(title)}</p>`, markdown, media_attachments: [] };
}

function fromRelease(r: Release, name: string): ReleasePost {
    // « Plume v0.3.12 », plus le nom de la release seulement s'il dit autre chose
    // que le numéro (« Plume 0.3.12 » ferait doublon).
    const version = r.tag_name.replace(/^v/, "");
    const title = `${name} ${r.tag_name}${r.name && !r.name.includes(version) ? ` : ${r.name}` : ""}`;
    // Notes trop longues : la page GitHub a le reste.
    const notes = (r.body || "").trim();
    const short = notes.length > 1500 ? `${notes.slice(0, 1500).trimEnd()}…` : notes;
    const how = name === "Plume"
        ? "Clique sur **Mettre à jour Plume** juste en dessous (ou Paramètres Plume → Mises à jour)."
        : "Rien à faire : Plume installe la nouvelle version de Plumecord tout seul au prochain lancement.";
    const date = r.published_at || new Date().toISOString();
    return post(Date.parse(date), date, `Nouvelle version : ${title}`,
        `## Nouvelle version : ${title}\n\n${short || "Pas de notes de version."}\n\n${how}`,
        { product: name, url: r.html_url });
}

function fromAnnouncement(a: Announcement): ReleasePost | null {
    if (!Number.isFinite(a?.id) || typeof a.title !== "string" || typeof a.message !== "string") return null;
    const link = typeof a.link === "string" && /^https:\/\//.test(a.link) ? a.link : undefined;
    return post(a.id, a.date || new Date(a.id).toISOString(), a.title, `## ${a.title}\n\n${a.message}`, { product: "Annonce", url: link });
}

type Cache = { at: number; posts: ReleasePost[]; info: [string, PostInfo][]; };

function readCache(): Cache | null {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        return c && Array.isArray(c.posts) ? c : null;
    } catch {
        return null;
    }
}

function restore(c: Cache | null) {
    for (const [id, info] of c?.info ?? []) releaseInfo.set(id, info);
    return c?.posts ?? [];
}

async function getJson(url: string, headers: Record<string, string> = {}) {
    const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
}

// Une seule lecture à la fois : le sondage, l'ouverture du MP et le démarrage
// peuvent la demander en même temps.
let inFlight: Promise<ReleasePost[]> | null = null;

export function fetchReleases(): Promise<ReleasePost[]> {
    return inFlight ??= load().finally(() => { inFlight = null; });
}

async function load(): Promise<ReleasePost[]> {
    const cached = readCache();
    if (cached && Date.now() - cached.at < MAX_AGE) return restore(cached);

    const posts: ReleasePost[] = [];
    let ok = false;
    for (const { repo, name } of REPOS) {
        try {
            const list: Release[] = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=10`, { Accept: "application/vnd.github+json" });
            ok = true;
            for (const r of list) if (!r.draft && !r.prerelease) posts.push(fromRelease(r, name));
        } catch { }
    }
    try {
        const list: Announcement[] = await getJson(ANNOUNCEMENTS);
        ok = true;
        for (const a of Array.isArray(list) ? list : []) {
            const p = fromAnnouncement(a);
            if (p) posts.push(p);
        }
    } catch { }
    // GitHub injoignable : on garde ce qu'on avait plutôt que de tout effacer.
    if (!ok) return restore(cached);
    posts.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), posts, info: [...releaseInfo] })); } catch { }
    return posts;
}
