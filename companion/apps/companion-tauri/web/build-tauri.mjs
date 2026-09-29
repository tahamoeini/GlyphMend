import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(webDir, "../../../..");
const browserDir = path.join(repositoryRoot, "web-app");
const outputDir = path.join(webDir, "dist");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const build = spawnSync(npm, ["run", "build"], {
  cwd: browserDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const browserDist = path.join(browserDir, "dist");
const indexPath = path.join(browserDist, "index.html");
if (!fs.existsSync(indexPath)) throw new Error("The browser production build did not create index.html.");

fs.rmSync(outputDir, { recursive: true, force: true });
fs.cpSync(browserDist, outputDir, { recursive: true });
const assembledIndexPath = path.join(outputDir, "index.html");
const html = fs.readFileSync(assembledIndexPath, "utf8");
const moduleScript = /<script\s+type="module"/;
if (!moduleScript.test(html)) throw new Error("The browser entry module was not found in index.html.");
const withAdapter = html.replace(moduleScript, '<script src="./tauri-adapter.js"></script>' + String.fromCharCode(10) + '  <script type="module"');
fs.writeFileSync(assembledIndexPath, withAdapter);
const adapterPath = path.join(outputDir, "tauri-adapter.js");
fs.copyFileSync(path.join(webDir, "src/tauri-adapter.js"), adapterPath);
const serviceWorkerPath = path.join(outputDir, "sw.js");
if (!fs.existsSync(serviceWorkerPath)) throw new Error("The browser service worker was not included in the build.");
const adapterHash = createHash("sha256").update(fs.readFileSync(adapterPath)).digest("hex");
const manifestMarker = "precacheAndRoute([";
const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
if (!serviceWorker.includes(manifestMarker)) throw new Error("The browser precache manifest could not be updated.");
const adapterEntry = '{url:"tauri-adapter.js",revision:"' + adapterHash + '"},';
fs.writeFileSync(serviceWorkerPath, serviceWorker.includes(adapterEntry)
  ? serviceWorker
  : serviceWorker.replace(manifestMarker, manifestMarker + adapterEntry));
console.log("Assembled the browser build and offline Tauri Companion adapter at " + outputDir);
