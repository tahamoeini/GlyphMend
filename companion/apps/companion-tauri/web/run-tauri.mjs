import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.resolve(webDir, "../src-tauri");
const nativeCliPackage = getNativeCliPackage();
if (nativeCliPackage && !existsSync(path.join(webDir, "node_modules", "@tauri-apps", nativeCliPackage))) {
  throw new Error(
    `The Tauri CLI package for ${process.platform}/${process.arch} is missing. `
    + "Install dependencies with Node.js 22 and `npm ci --include=optional` on this OS. "
    + "Keep Windows and WSL checkouts separate; their node_modules are not interchangeable.",
  );
}

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

function getNativeCliPackage() {
  const packages = {
    win32: {
      x64: "cli-win32-x64-msvc",
      arm64: "cli-win32-arm64-msvc",
      ia32: "cli-win32-ia32-msvc",
    },
    darwin: {
      x64: "cli-darwin-x64",
      arm64: "cli-darwin-arm64",
    },
    linux: {
      x64: `cli-linux-x64-${linuxLibc()}`,
      arm64: `cli-linux-arm64-${linuxLibc()}`,
      arm: "cli-linux-arm-gnueabihf",
      riscv64: "cli-linux-riscv64-gnu",
    },
  };
  return packages[process.platform]?.[process.arch];
}

function linuxLibc() {
  const runtimeReport = process.report?.getReport();
  return runtimeReport?.header?.glibcVersionRuntime ? "gnu" : "musl";
}
