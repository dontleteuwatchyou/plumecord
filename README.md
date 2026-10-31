<div align="center">

<img src="https://raw.githubusercontent.com/dontleteuwatchyou/plume/main/assets/icon.svg" width="96" alt="Plume">

# Plumecord

**Le mod Discord de [Plume](https://github.com/dontleteuwatchyou/plume) : tous les plugins, aucun d'imposé.**

![Plume](https://img.shields.io/badge/pour-Plume-8b7cf6)
![Licence](https://img.shields.io/badge/licence-GPL--3.0-6b5ce0)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-soutenir-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/forsakengh)

</div>

---

## C'est quoi

Plumecord est le mod livré avec Plume, le client Discord léger. Il part de **Nightcord**, qui réunit déjà **Vencord** et **Equicord** : près de 490 plugins au total. Plumecord garde tout ça, et change ce qui gênait.

| | Nightcord | Plumecord |
|---|---|---|
| Plugins disponibles | ~490 | ~490 |
| Plugins **impossibles à désactiver** | une quinzaine (MusicControls, StealthMode, CompactMode…) | seulement les briques internes du mod |
| Plugins **activés d'office** à l'installation | des dizaines | **aucun** : tu actives ceux que tu veux |
| Tes réglages après une mise à jour | 8 plugins remis sur « désactivé » à chaque démarrage | **gardés** |
| Interface | Nightcord | **Plumecord**, en français |
| MP officiel | actus de Nightcord | **MP Plume** : nouvelles versions de Plume et Plumecord, et annonces |
| Notifications | logo Nightcord | logo Plume, carte avec bouton |

Et aussi, dans la version web : ScreenRecorder, AutoCallRecorder (avec la voix des autres, grâce à Plume), StreamProof et VoiceDictation inclus ; FixScreenshare, WordBomb et DMBomb exclus.

## Installer

**Avec Plume** : rien à faire, c'est le mod par défaut. Plume le télécharge, l'installe et le met à jour tout seul (*Paramètres Plume → Mod client* pour changer).

**Dans Chrome ou Edge** :
1. Télécharge `plumecord.zip` dans la [dernière release](../../releases/latest) et décompresse-le.
2. Ouvre `chrome://extensions` (ou `edge://extensions`) et active le **mode développeur**.
3. **Charger l'extension non empaquetée** → choisis le dossier décompressé.
4. Ouvre [discord.com/app](https://discord.com/app).

Retire Nightcord ou Equicord avant : deux mods en même temps se marchent dessus. Tes réglages sont gardés, ils sont stockés par Discord, pas par le mod.

## Compiler

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm buildWeb
```

L'extension est dans `dist/browser/chromium-unpacked` (et `dist/extension-chrome.zip`).

Les nouvelles versions de Nightcord se fusionnent depuis le dépôt d'origine (remote `upstream`) ; les changements de Plumecord restent dans des fichiers à part autant que possible, pour que ces fusions restent simples.

## Crédits et licence

Plumecord n'existerait pas sans [Vencord](https://github.com/Vendicated/Vencord), [Equicord](https://github.com/Equicord/Equicord) et [Nightcord](https://source.nightcord.st/nightcord/nightcord), dont il reprend le code et les plugins. Merci à leurs auteurs et contributeurs.

GPL-3.0, comme eux. Projet non officiel, sans lien avec Discord, Vencord, Equicord ni Nightcord.
