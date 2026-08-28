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
      in rec {
        packages = {
          default = packages.nightcord;
          nightcord = pkgs.callPackage ./default.nix { };
        };

        apps.default = flake-utils.lib.mkApp {
          drv = packages.nightcord;
        };
      }
    ) // {
      overlays.default = final: prev: {
        nightcord = final.callPackage ./default.nix { };
      };

      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.programs.nightcord;
        in {
          options.programs.nightcord = {
            enable = lib.mkEnableOption "Nightcord Discord client mod";
            package = lib.mkOption {
              type = lib.types.package;
              default = pkgs.callPackage ./default.nix { };
              description = "The Nightcord package to use.";
            };
          };

          config = lib.mkIf cfg.enable {
            environment.systemPackages = [ cfg.package ];
          };
        };
    };
}
