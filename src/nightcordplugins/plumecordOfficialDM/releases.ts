/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Les messages du MP officiel de Plumecord : les releases GitHub de Plume et
// de Plumecord, mises en forme comme les publications qu'attend index.tsx
// (id, created_at, content), avec le texte en Markdown et un bouton vers la
// page de la mise à jour.

const REPOS = [
    { repo: "dontleteuwatchyou/plume", name: "Plume" },
    { repo: "dontleteuwatchyou/plumecord", name: "Plumecord" },
];
const CACHE_KEY = "plumecord_official_dm_releases";
// L'API de GitHub accepte 60 requêtes par heure et par adresse sans compte :
// une lecture toutes les 30 minutes au plus, pour tous les onglets.
const MAX_AGE = 30 * 60 * 1000;

interface Release {
    id: number;
    tag_name: string;
    name: string | null;
    body: string | null;
    html_url: string;
    published_at: string | null;
    draft: boolean;
    prerelease: boolean;
}

export interface ReleasePost {
    id: string;
    created_at: string;
    content: string;
    markdown: string;
    components: unknown[];
    media_attachments: unknown[];
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function toPost(r: Release, name: string): ReleasePost {
    const title = `${name} ${r.tag_name}${r.name && r.name !== r.tag_name ? ` : ${r.name}` : ""}`;
    // Notes trop longues : la page GitHub a le reste.
    const notes = (r.body || "").trim();
    const short = notes.length > 1500 ? `${notes.slice(0, 1500).trimEnd()}…` : notes;
    const markdown = `## Nouvelle version : ${title}\n\n${short || "Pas de notes de version."}\n\n[Voir la mise à jour sur GitHub](${r.html_url})`;
    return {
        id: String(r.id),
        created_at: r.published_at || new Date().toISOString(),
        content: `<p>${escapeHtml(`Nouvelle version : ${title}`)}</p>`,
        markdown,
        // Bouton lien de Discord (rangée d'actions → bouton de style « lien »).
        components: [{ type: 1, id: 1, components: [{ type: 2, id: 2, style: 5, label: "Voir la mise à jour", url: r.html_url }] }],
        media_attachments: [],
    };
}

function readCache(): { at: number; posts: ReleasePost[]; } | null {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        return c && Array.isArray(c.posts) ? c : null;
    } catch {
        return null;
    }
}

export async function fetchReleases(): Promise<ReleasePost[]> {
    const cached = readCache();
    if (cached && Date.now() - cached.at < MAX_AGE) return cached.posts;

    const posts: ReleasePost[] = [];
    let ok = false;
    for (const { repo, name } of REPOS) {
        try {
            const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
                headers: { Accept: "application/vnd.github+json" },
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) continue;
            ok = true;
            const list: Release[] = await res.json();
            for (const r of list) if (!r.draft && !r.prerelease) posts.push(toPost(r, name));
        } catch { }
    }
    // GitHub injoignable : on garde ce qu'on avait plutôt que de tout effacer.
    if (!ok) return cached?.posts ?? [];
    posts.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), posts })); } catch { }
    return posts;
}
