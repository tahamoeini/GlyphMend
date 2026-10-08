import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(webDir, "../../../..");
const browserDir = path.join(repositoryRoot, "web-app");
const outputDir = path.join(webDir, "dist");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const build = spawnSync(npm, ["run", "build:desktop"], {
  cwd: browserDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
if (!fs.existsSync(path.join(outputDir, "index.html"))) {
  throw new Error("The desktop production build did not create index.html.");
}

console.log("Assembled the local GlyphMend desktop frontend at " + outputDir);
