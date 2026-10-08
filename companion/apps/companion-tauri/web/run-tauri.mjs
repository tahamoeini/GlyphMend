import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.resolve(webDir, "../src-tauri");
const command = path.join(
  webDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
);
const result = spawnSync(command, process.argv.slice(2), {
  cwd: tauriDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
