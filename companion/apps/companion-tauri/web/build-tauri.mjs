import { spawnSync } from "node:child_process";
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
fs.copyFileSync(path.join(webDir, "src/tauri-adapter.js"), path.join(outputDir, "tauri-adapter.js"));
console.log("Assembled the browser build and Tauri Companion adapter at " + outputDir);
