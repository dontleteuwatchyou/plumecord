{ lib
, stdenv
, fetchFromGitHub
, nodejs_20
, pnpm
}:

stdenv.mkDerivation rec {
  pname = "nightcord";
  version = "1.27.5";

  src = ./.;

  nativeBuildInputs = [
    nodejs_20
    pnpm.configHook
  ];

  pnpmDeps = pnpm.fetchDeps {
    inherit pname version src;
    hash = lib.fakeHash;
  };

  buildPhase = ''
    runHook preBuild
    pnpm buildStandalone
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/nightcord
    cp -r dist/* $out/share/nightcord/
    runHook postInstall
  '';

  meta = with lib; {
    description = "Everything Discord doesn't build, we create (Nightcord)";
    homepage = "https://source.nightcord.st/nightcord/nightcord";
    license = licenses.gpl3Plus;
    platforms = platforms.all;
  };
}
