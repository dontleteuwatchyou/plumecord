{
  description = "Nightcord - Everything Discord doesn't build, we create";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        nightcordPkg = pkgs.callPackage ./default.nix { };

        # Wraps official Discord binaries with Nightcord desktop patcher
        wrapDiscord = discordPkg: pkgs.runCommand "${discordPkg.name}-nightcord" {
          nativeBuildInputs = [ pkgs.makeWrapper ];
          meta = discordPkg.meta // {
            description = "${discordPkg.meta.description or "Discord"} (with Nightcord mod)";
            mainProgram = discordPkg.meta.mainProgram or "discord";
          };
        } ''
          mkdir -p $out
          cp -rs --no-preserve=mode,ownership ${discordPkg}/* $out/

          for res in $out/opt/*/resources $out/share/*/resources $out/opt/discord*/resources $out/lib/*/resources; do
            if [ -d "$res" ]; then
              rm -rf "$res/app"
              mkdir -p "$res/app"
              cat << 'EOF' > "$res/app/package.json"
{
  "name": "discord",
  "main": "index.js"
}
EOF
              echo 'require("${nightcordPkg}/share/nightcord/patcher.js");' > "$res/app/index.js"
            fi
          done
        '';
      in rec {
        packages = {
          # The core Nightcord compiled desktop JS/CSS files
          nightcord = nightcordPkg;

          # Pre-wrapped Discord clients
          discord-nightcord = wrapDiscord pkgs.discord;
          discord-ptb-nightcord = wrapDiscord pkgs.discord-ptb;
          discord-canary-nightcord = wrapDiscord pkgs.discord-canary;

          # Default runnable package
          default = packages.discord-nightcord;
        };

        apps = rec {
          default = discord;
          discord = flake-utils.lib.mkApp {
            drv = packages.discord-nightcord;
          };
          discord-ptb = flake-utils.lib.mkApp {
            drv = packages.discord-ptb-nightcord;
          };
          discord-canary = flake-utils.lib.mkApp {
            drv = packages.discord-canary-nightcord;
          };
        };
      }
    ) // {
      overlays.default = final: prev: {
        nightcord = final.callPackage ./default.nix { };

        discord-nightcord = final.runCommand "discord-nightcord" {
          nativeBuildInputs = [ final.makeWrapper ];
        } ''
          mkdir -p $out
          cp -rs --no-preserve=mode,ownership ${final.discord}/* $out/
          for res in $out/opt/*/resources $out/share/*/resources $out/opt/discord*/resources $out/lib/*/resources; do
            if [ -d "$res" ]; then
              rm -rf "$res/app"
              mkdir -p "$res/app"
              echo '{"name":"discord","main":"index.js"}' > "$res/app/package.json"
              echo 'require("${final.nightcord}/share/nightcord/patcher.js");' > "$res/app/index.js"
            fi
          done
        '';

        # Default discord package override
        discord = final.discord-nightcord;
      };

      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.programs.nightcord;
        in {
          options.programs.nightcord = {
            enable = lib.mkEnableOption "Nightcord Discord client mod";
            channel = lib.mkOption {
              type = lib.types.enum [ "stable" "ptb" "canary" ];
              default = "stable";
              description = "The Discord release channel to use with Nightcord.";
            };
            package = lib.mkOption {
              type = lib.types.package;
              default =
                if cfg.channel == "canary" then self.packages.${pkgs.system}.discord-canary-nightcord
                else if cfg.channel == "ptb" then self.packages.${pkgs.system}.discord-ptb-nightcord
                else self.packages.${pkgs.system}.discord-nightcord;
              description = "The Nightcord-wrapped Discord package to install.";
            };
          };

          config = lib.mkIf cfg.enable {
            environment.systemPackages = [ cfg.package ];
          };
        };

      homeManagerModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.programs.nightcord;
        in {
          options.programs.nightcord = {
            enable = lib.mkEnableOption "Nightcord Discord client mod";
            channel = lib.mkOption {
              type = lib.types.enum [ "stable" "ptb" "canary" ];
              default = "stable";
              description = "The Discord release channel to use with Nightcord.";
            };
            package = lib.mkOption {
              type = lib.types.package;
              default =
                if cfg.channel == "canary" then self.packages.${pkgs.system}.discord-canary-nightcord
                else if cfg.channel == "ptb" then self.packages.${pkgs.system}.discord-ptb-nightcord
                else self.packages.${pkgs.system}.discord-nightcord;
              description = "The Nightcord-wrapped Discord package to install.";
            };
          };

          config = lib.mkIf cfg.enable {
            home.packages = [ cfg.package ];
          };
        };
    };
}
