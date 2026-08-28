#!/usr/bin/env bash
#
# Nightcord Universal Installer for Linux & macOS
# Copyright (c) 2026 Nightcord contributors
# SPDX-License-Identifier: GPL-3.0-or-later
#

set -e

# ANSI Colors
BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
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

echo -e "${BOLD}--------------------------------------------------${RESET}"
echo -e "${BOLD}       Nightcord Universal Installer             ${RESET}"
echo -e "${BOLD}       Supported: Linux (all distros) & macOS     ${RESET}"
echo -e "${BOLD}--------------------------------------------------${RESET}"

OS="$(uname -s)"
ARCH="$(uname -m)"

log_info "Detected Operating System: $OS ($ARCH)"

DOWNLOAD_URL="https://source.nightcord.st/nightcord/nightcord/releases/download/latest"
GITHUB_API_URL="https://api.github.com/repos/nightcord/nightcord/releases/latest"

TMP_DIR="$(mktemp -d /tmp/nightcord-install-XXXXXX)"
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ─── macOS Installation ────────────────────────────────────────────────────────
install_macos() {
    log_info "Scanning for Discord installations on macOS..."
    
    DISCORD_APPS=(
        "/Applications/Discord.app"
        "/Applications/Discord Canary.app"
        "/Applications/Discord PTB.app"
        "/Applications/Discord Development.app"
        "$HOME/Applications/Discord.app"
        "$HOME/Applications/Discord Canary.app"
    )

    FOUND_APP=""
    for app in "${DISCORD_APPS[@]}"; do
        if [ -d "$app" ]; then
            FOUND_APP="$app"
            log_success "Found Discord installation at: $FOUND_APP"
            break
        fi
    done

    if [ -z "$FOUND_APP" ]; then
        log_error "No Discord installation found on your Mac."
        log_info "Please install Discord first from https://discord.com"
        exit 1
    fi

    RESOURCES_DIR="$FOUND_APP/Contents/Resources"
    APP_DIR="$RESOURCES_DIR/app"

    log_info "Downloading latest Nightcord bundle..."
    curl -sSL "$DOWNLOAD_URL/nightcordDesktop.asar" -o "$TMP_DIR/nightcordDesktop.asar" || {
        log_warn "Fallback to GitHub releases mirror..."
        curl -sSL "https://github.com/nightcord/nightcord/releases/latest/download/nightcordDesktop.asar" -o "$TMP_DIR/nightcordDesktop.asar"
    }

    mkdir -p "$APP_DIR"
    cp "$TMP_DIR/nightcordDesktop.asar" "$APP_DIR/nightcordDesktop.asar"

    # Create bootstrap index.js in resources/app
    cat << 'EOF' > "$APP_DIR/index.js"
/* Nightcord Loader */
require("./nightcordDesktop.asar");
EOF

    # Create bootstrap package.json
    cat << 'EOF' > "$APP_DIR/package.json"
{
  "name": "discord",
  "main": "index.js"
}
EOF

    log_success "Nightcord successfully installed into $FOUND_APP!"
    log_info "Please restart Discord to enjoy Nightcord."
}

# ─── Linux Installation ────────────────────────────────────────────────────────
install_linux() {
    log_info "Scanning for Discord installations on Linux..."

    DISCORD_PATHS=(
        "/usr/share/discord"
        "/usr/lib/discord"
        "/usr/share/discord-canary"
        "/usr/lib/discord-canary"
        "/usr/share/discord-ptb"
        "/usr/lib/discord-ptb"
        "/opt/discord"
        "/opt/discord-canary"
        "/opt/discord-ptb"
        "$HOME/.local/share/discord"
        "$HOME/.local/share/discord-canary"
        "$HOME/.var/app/com.discordapp.Discord/data/discord"
        "$HOME/.var/app/com.discordapp.DiscordCanary/data/discord"
        "$HOME/snap/discord/current"
    )

    TARGET_DIR=""
    for dir in "${DISCORD_PATHS[@]}"; do
        if [ -d "$dir/resources" ]; then
            TARGET_DIR="$dir/resources"
            log_success "Found Discord installation at: $dir"
            break
        fi
    done

    if [ -z "$TARGET_DIR" ]; then
        # Check Flatpak data directory fallback
        if [ -d "$HOME/.var/app/com.discordapp.Discord" ]; then
            TARGET_DIR="$HOME/.var/app/com.discordapp.Discord/config/discord"
        else
            log_warn "Discord resources directory not found in standard system locations."
            log_info "Creating user-level config patch at ~/.config/discord/..."
            TARGET_DIR="$HOME/.config/discord"
        fi
    fi

    log_info "Downloading latest Nightcord bundle..."
    curl -sSL "$DOWNLOAD_URL/nightcordDesktop.asar" -o "$TMP_DIR/nightcordDesktop.asar" || {
        log_warn "Fallback to GitHub releases mirror..."
        curl -sSL "https://github.com/nightcord/nightcord/releases/latest/download/nightcordDesktop.asar" -o "$TMP_DIR/nightcordDesktop.asar"
    }

    APP_DIR="$TARGET_DIR/app"
    mkdir -p "$APP_DIR"
    cp "$TMP_DIR/nightcordDesktop.asar" "$APP_DIR/nightcordDesktop.asar"

    # Create bootstrap index.js
    cat << 'EOF' > "$APP_DIR/index.js"
/* Nightcord Loader */
require("./nightcordDesktop.asar");
EOF

    # Create bootstrap package.json
    cat << 'EOF' > "$APP_DIR/package.json"
{
  "name": "discord",
  "main": "index.js"
}
EOF

    log_success "Nightcord successfully installed!"
    log_info "Please restart Discord to enjoy Nightcord."
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
