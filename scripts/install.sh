#!/usr/bin/env bash
#
# Nightcord Universal Interactive Installer for Linux & macOS
# Copyright (c) 2026 Nightcord contributors
# SPDX-License-Identifier: GPL-3.0-or-later
#

set -e

# ANSI Colors & Formatting
BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
WHITE="\033[97m"
DIM="\033[2m"
RESET="\033[0m"

log_info() {
    echo -e "${CYAN}[Nightcord]${RESET} $1"
}

log_success() {
    echo -e "${GREEN}[Nightcord]${RESET} $1"
}

log_warn() {
    echo -e "${YELLOW}[Nightcord]${RESET} $1"
}

log_error() {
    echo -e "${RED}[Nightcord]${RESET} $1"
}

echo -e "\n${BOLD}======================================================${RESET}"
echo -e "${BOLD}${WHITE}           NIGHTCORD UNIVERSAL INSTALLER             ${RESET}"
echo -e "${DIM}      Linux (All Distros & NixOS) + macOS (All Macs) ${RESET}"
echo -e "${BOLD}======================================================${RESET}\n"

OS="$(uname -s)"
ARCH="$(uname -m)"

log_info "Operating System: ${WHITE}$OS ($ARCH)${RESET}"

GITEA_API="https://source.nightcord.st/api/v1/repos/nightcord/nightcord"
FALLBACK_URL="https://source.nightcord.st/nightcord/nightcord/raw/branch/master/dist"

TMP_DIR="$(mktemp -d /tmp/nightcord-install-XXXXXX)"
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

download_nightcord_bundle() {
    log_info "Fetching latest release information..."
    mkdir -p "$TMP_DIR/extracted"
    
    TAG="$(curl -sSL "$GITEA_API/releases/latest" 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4 || echo "latest")"
    if [ -z "$TAG" ]; then TAG="latest"; fi
    log_info "Detected latest version: ${WHITE}$TAG${RESET}"

    DOWNLOAD_URL="https://source.nightcord.st/nightcord/nightcord/releases/download/$TAG"

    # 1. Try downloading nightcord-dist.zip from the release
    if curl -sSL "$DOWNLOAD_URL/nightcord-dist.zip" -o "$TMP_DIR/nightcord-dist.zip" 2>/dev/null && [ -s "$TMP_DIR/nightcord-dist.zip" ]; then
        unzip -q -o "$TMP_DIR/nightcord-dist.zip" -d "$TMP_DIR/extracted"
        log_success "Downloaded & extracted Nightcord bundle."
    elif curl -sSL "$DOWNLOAD_URL/nightcordDesktop.asar" -o "$TMP_DIR/nightcordDesktop.asar" 2>/dev/null && [ -s "$TMP_DIR/nightcordDesktop.asar" ]; then
        cp "$TMP_DIR/nightcordDesktop.asar" "$TMP_DIR/extracted/nightcordDesktop.asar"
        log_success "Downloaded Nightcord ASAR bundle."
    else
        log_warn "Downloading from repository branch fallback..."
        mkdir -p "$TMP_DIR/extracted"
        curl -sSL "$FALLBACK_URL/desktop/patcher.js" -o "$TMP_DIR/extracted/patcher.js"
        curl -sSL "$FALLBACK_URL/desktop/preload.js" -o "$TMP_DIR/extracted/preload.js"
        curl -sSL "$FALLBACK_URL/desktop/renderer.js" -o "$TMP_DIR/extracted/renderer.js"
        curl -sSL "$FALLBACK_URL/desktop/renderer.css" -o "$TMP_DIR/extracted/renderer.css"
        log_success "Downloaded Nightcord scripts."
    fi
}

inject_into_app_dir() {
    local target_app_dir="$1"
    local app_name="$2"

    mkdir -p "$target_app_dir"

    # Copy files
    if [ -f "$TMP_DIR/extracted/nightcordDesktop.asar" ]; then
        cp "$TMP_DIR/extracted/nightcordDesktop.asar" "$target_app_dir/nightcordDesktop.asar"
        cat << 'EOF' > "$target_app_dir/index.js"
/* Nightcord Loader */
require("./nightcordDesktop.asar");
EOF
    elif [ -f "$TMP_DIR/extracted/patcher.js" ]; then
        cp -r "$TMP_DIR/extracted/"* "$target_app_dir/"
        cat << 'EOF' > "$target_app_dir/index.js"
/* Nightcord Loader */
require("./patcher.js");
EOF
    fi

    # Create package.json
    cat << 'EOF' > "$target_app_dir/package.json"
{
  "name": "discord",
  "main": "index.js"
}
EOF

    log_success "Injected Nightcord into ${WHITE}$app_name${RESET} -> $target_app_dir"
}

# ─── macOS Installation ────────────────────────────────────────────────────────
install_macos() {
    log_info "Scanning for Discord installations on macOS..."

    CANDIDATES=(
        "Discord (Stable):/Applications/Discord.app/Contents/Resources"
        "Discord Canary:/Applications/Discord Canary.app/Contents/Resources"
        "Discord PTB:/Applications/Discord PTB.app/Contents/Resources"
        "Discord Development:/Applications/Discord Development.app/Contents/Resources"
        "User Discord:$HOME/Applications/Discord.app/Contents/Resources"
        "User Discord Canary:$HOME/Applications/Discord Canary.app/Contents/Resources"
    )

    FOUND_NAMES=()
    FOUND_PATHS=()

    for item in "${CANDIDATES[@]}"; do
        IFS=":" read -r name path <<< "$item"
        if [ -d "$path" ]; then
            FOUND_NAMES+=("$name")
            FOUND_PATHS+=("$path")
        fi
    done

    if [ ${#FOUND_PATHS[@]} -eq 0 ]; then
        log_error "No Discord installation found on your Mac."
        log_info "Please install Discord first from https://discord.com"
        exit 1
    fi

    download_nightcord_bundle

    echo -e "\n${BOLD}Select which Discord to patch:${RESET}"
    for i in "${!FOUND_NAMES[@]}"; do
        echo -e "  ${CYAN}[$((i+1))]${RESET} ${WHITE}${FOUND_NAMES[$i]}${RESET} ${DIM}(${FOUND_PATHS[$i]})${RESET}"
    done
    if [ ${#FOUND_PATHS[@]} -gt 1 ]; then
        echo -e "  ${CYAN}[$(( ${#FOUND_PATHS[@]} + 1 ))]${RESET} ${GREEN}All installations (Tous les Discord)${RESET}"
    fi

    echo ""
    read -r -p "Your choice [1-$(( ${#FOUND_PATHS[@]} > 1 ? ${#FOUND_PATHS[@]} + 1 : 1 ))] (Default: 1): " CHOICE < /dev/tty || CHOICE="1"
    CHOICE="${CHOICE:-1}"

    if [ "$CHOICE" -eq "$(( ${#FOUND_PATHS[@]} + 1 ))" ]; then
        for i in "${!FOUND_PATHS[@]}"; do
            inject_into_app_dir "${FOUND_PATHS[$i]}/app" "${FOUND_NAMES[$i]}"
        done
    else
        IDX=$((CHOICE - 1))
        if [ $IDX -ge 0 ] && [ $IDX -lt ${#FOUND_PATHS[@]} ]; then
            inject_into_app_dir "${FOUND_PATHS[$IDX]}/app" "${FOUND_NAMES[$IDX]}"
        else
            log_error "Invalid selection."
            exit 1
        fi
    fi

    echo -e "\n${GREEN}${BOLD}------------------------------------------------------${RESET}"
    echo -e "${GREEN}${BOLD}  Nightcord successfully installed on macOS!          ${RESET}"
    echo -e "${WHITE}  Restart Discord to activate Nightcord.              ${RESET}"
    echo -e "${GREEN}${BOLD}------------------------------------------------------${RESET}\n"
}

# ─── Linux Installation ────────────────────────────────────────────────────────
install_linux() {
    log_info "Scanning for Discord installations on Linux..."

    CANDIDATES=(
        "Discord (System Native):/usr/share/discord/resources"
        "Discord (/usr/lib):/usr/lib/discord/resources"
        "Discord (/opt):/opt/discord/resources"
        "Discord Canary (System):/usr/share/discord-canary/resources"
        "Discord Canary (/opt):/opt/discord-canary/resources"
        "Discord PTB (System):/usr/share/discord-ptb/resources"
        "Discord PTB (/opt):/opt/discord-ptb/resources"
        "Discord (Local User):$HOME/.local/share/discord/resources"
        "Discord Canary (Local):$HOME/.local/share/discord-canary/resources"
        "Discord (Flatpak):$HOME/.var/app/com.discordapp.Discord/data/discord/resources"
        "Discord Canary (Flatpak):$HOME/.var/app/com.discordapp.DiscordCanary/data/discord/resources"
        "Discord (Snap):$HOME/snap/discord/current/resources"
        "User Config Profile (~/.config/discord):$HOME/.config/discord"
    )

    FOUND_NAMES=()
    FOUND_PATHS=()

    for item in "${CANDIDATES[@]}"; do
        IFS=":" read -r name path <<< "$item"
        if [ -d "$path" ]; then
            FOUND_NAMES+=("$name")
            FOUND_PATHS+=("$path")
        fi
    done

    # If none found in standard paths, offer ~/.config/discord
    if [ ${#FOUND_PATHS[@]} -eq 0 ]; then
        FOUND_NAMES+=("User Config Discord (~/.config/discord)")
        FOUND_PATHS+=("$HOME/.config/discord")
    fi

    download_nightcord_bundle

    echo -e "\n${BOLD}Select which Discord installation to patch:${RESET}"
    for i in "${!FOUND_NAMES[@]}"; do
        echo -e "  ${CYAN}[$((i+1))]${RESET} ${WHITE}${FOUND_NAMES[$i]}${RESET} ${DIM}(${FOUND_PATHS[$i]})${RESET}"
    done
    if [ ${#FOUND_PATHS[@]} -gt 1 ]; then
        echo -e "  ${CYAN}[$(( ${#FOUND_PATHS[@]} + 1 ))]${RESET} ${GREEN}All detected installations (Tous les Discord)${RESET}"
    fi

    echo ""
    read -r -p "Your choice [1-$(( ${#FOUND_PATHS[@]} > 1 ? ${#FOUND_PATHS[@]} + 1 : 1 ))] (Default: 1): " CHOICE < /dev/tty || CHOICE="1"
    CHOICE="${CHOICE:-1}"

    if [ "$CHOICE" -eq "$(( ${#FOUND_PATHS[@]} + 1 ))" ]; then
        for i in "${!FOUND_PATHS[@]}"; do
            inject_into_app_dir "${FOUND_PATHS[$i]}/app" "${FOUND_NAMES[$i]}"
        done
    else
        IDX=$((CHOICE - 1))
        if [ $IDX -ge 0 ] && [ $IDX -lt ${#FOUND_PATHS[@]} ]; then
            inject_into_app_dir "${FOUND_PATHS[$IDX]}/app" "${FOUND_NAMES[$IDX]}"
        else
            log_error "Invalid selection."
            exit 1
        fi
    fi

    echo -e "\n${GREEN}${BOLD}------------------------------------------------------${RESET}"
    echo -e "${GREEN}${BOLD}  Nightcord successfully installed on Linux!          ${RESET}"
    echo -e "${WHITE}  Restart Discord to activate Nightcord.              ${RESET}"
    echo -e "${GREEN}${BOLD}------------------------------------------------------${RESET}\n"
}

case "$OS" in
    Darwin)
        install_macos
        ;;
    Linux)
        install_linux
        ;;
    *)
        log_error "Unsupported operating system: $OS"
        log_info "For Windows, please use the official Nightcord-Installer.exe"
        exit 1
        ;;
esac
