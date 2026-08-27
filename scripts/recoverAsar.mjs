import { execSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";

const localAppData = process.env.LOCALAPPDATA || "";
const packagesDir = join(localAppData, "Discord", "packages");

export function recoverOriginalAsar(resourcesDir) {
    const backupPath = join(resourcesDir, "_app.asar");
    const appAsarPath = join(resourcesDir, "app.asar");

    if (existsSync(backupPath) && statSync(backupPath).size > 1000000) {
        return true;
    }

    if (existsSync(appAsarPath) && statSync(appAsarPath).size > 1000000) {
        try {
            copyFileSync(appAsarPath, backupPath);
            rmSync(appAsarPath, { force: true });
            return true;
        } catch {}
    }

    if (existsSync(packagesDir)) {
        const pkgs = readdirSync(packagesDir).filter(f => f.endsWith(".nupkg"));
        for (const pkg of pkgs) {
            const pkgPath = join(packagesDir, pkg);
            const tempExtractDir = join(localAppData, "Temp", "discord_nupkg_extract");
            try {
                if (existsSync(tempExtractDir)) rmSync(tempExtractDir, { recursive: true, force: true });
                mkdirSync(tempExtractDir, { recursive: true });
                
                // Use tar with normalized paths
                const normalizedPkg = pkgPath.replace(/\\/g, "/");
                const normalizedTemp = tempExtractDir.replace(/\\/g, "/");
                execSync(`tar -xf "${normalizedPkg}" -C "${normalizedTemp}" lib/net45/resources/app.asar`);
                
                const extracted = join(tempExtractDir, "lib", "net45", "resources", "app.asar");
                if (existsSync(extracted) && statSync(extracted).size > 1000000) {
                    copyFileSync(extracted, backupPath);
                    rmSync(tempExtractDir, { recursive: true, force: true });
                    console.log(`[Nightcord] _app.asar extrait avec succès depuis ${pkg} (Taille : ${statSync(backupPath).size} octets)`);
                    return true;
                }
            } catch (err) {
                console.warn(`[Nightcord] Erreur extraction nupkg:`, err.message);
            }
        }
    }

    return false;
}
