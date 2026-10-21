{ lib
, stdenv
, fetchPnpmDeps
, nodejs
, pnpm_10
, pnpmConfigHook
, git
, src ? lib.cleanSource ./.
, gitHash ? null
}:

let
  packageJson = builtins.fromJSON (builtins.readFile "${src}/package.json");
in
stdenv.mkDerivation (finalAttrs: {
  pname = "nightcord";
  version = packageJson.version;

  inherit src;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_10;
    fetcherVersion = 4;
    hash = "sha256-Ta84vdQEcxDm7tKiiT25+GPyGijATFP5uoSjNDodLZs=";
  };

  nativeBuildInputs = [
    nodejs
    pnpm_10
    pnpmConfigHook
    git
  ];

  env = {
    NIGHTCORD_REMOTE = "nightcord/nightcord";
    NIGHTCORD_HASH = if gitHash != null then gitHash else (src.rev or "unknown");
    SOURCE_DATE_EPOCH = builtins.toString (src.lastModified or 0);
  };

  buildPhase = ''
    runHook preBuild
    pnpm run build -- --standalone --disable-updater
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/nightcord
    cp -r dist/desktop/* $out/share/nightcord/
    runHook postInstall
  '';

  meta = with lib; {
    description = "Discord client mod (Nightcord)";
    homepage = "https://nightcord.st";
    license = licenses.gpl3Plus;
    platforms = platforms.linux;
  };
})
