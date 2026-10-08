import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(scriptDir, "../tauri.conf.json");
const version = process.env.GLYPHMEND_VERSION;
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[0-9A-Za-z.-]+$/.test(version)) {
  throw new Error("GLYPHMEND_VERSION must be a prerelease SemVer value such as 2.0.0-beta.1.");
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
config.version = version;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Configured GlyphMend Desktop prerelease version ${version}.`);
