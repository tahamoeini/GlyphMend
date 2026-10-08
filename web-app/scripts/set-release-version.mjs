import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const version = process.env.GLYPHMEND_VERSION;
const versionMatch = version?.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)$/);
if (!versionMatch || versionMatch[4].split(".").some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) {
  throw new Error("GLYPHMEND_VERSION must be a valid SemVer prerelease such as 2.1.0-beta.1.");
}

const packagePath = path.join(repositoryRoot, "package.json");
const browserPath = path.join(repositoryRoot, "web-app/package.json");
const lockPath = path.join(repositoryRoot, "package-lock.json");
const packageManifest = JSON.parse(readFileSync(packagePath, "utf8"));
const browserManifest = JSON.parse(readFileSync(browserPath, "utf8"));
const lockfile = JSON.parse(readFileSync(lockPath, "utf8"));
if (packageManifest.name !== "glyphmend-platform"
  || browserManifest.name !== "glyphmend-browser"
  || lockfile.packages?.[""]?.name !== packageManifest.name
  || lockfile.packages?.["web-app"]?.name !== browserManifest.name) {
  throw new Error("The root npm lockfile does not match the GlyphMend release workspaces.");
}

packageManifest.version = version;
browserManifest.version = version;
lockfile.version = version;
lockfile.packages[""].version = version;
lockfile.packages["web-app"].version = version;

writeFileSync(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
writeFileSync(browserPath, `${JSON.stringify(browserManifest, null, 2)}\n`);
writeFileSync(lockPath, `${JSON.stringify(lockfile, null, 2)}\n`);
console.log(`Configured GlyphMend browser workspace and lockfile version ${version}.`);
