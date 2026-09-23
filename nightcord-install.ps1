# ==============================================================================
#  Nightcord — Installeur utilisateur (PowerShell autonome)
#  Usage : Clic droit → "Exécuter avec PowerShell"
# ==============================================================================

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installPs1 = Join-Path $scriptDir "install.ps1"

if (Test-Path $installPs1) {
    & $installPs1
} else {
    irm https://source.nightcord.st/nightcord/nightcord/raw/branch/master/install.ps1 | iex
}
