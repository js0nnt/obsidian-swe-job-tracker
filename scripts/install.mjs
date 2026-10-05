// Copies the built plugin into an Obsidian vault: node scripts/install.mjs [vaultPath]
import { copyFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const vault = process.argv[2] || process.env.OBSIDIAN_VAULT || join(homedir(), "Documents", "js0nt");
const target = join(vault, ".obsidian", "plugins", "swe-job-tracker");
mkdirSync(target, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
	copyFileSync(f, join(target, f));
}
console.log(`Installed to ${target}`);
