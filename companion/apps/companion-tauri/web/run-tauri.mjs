import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectMacPackageMinimum } from "../src-tauri/scripts/macos-package-policy.mjs";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.resolve(webDir, "../src-tauri");
const repositoryRoot = path.resolve(webDir, "../../../..");
const isWsl = process.platform === "linux" && Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
const isWslWindowsMount = isWsl && /^\/mnt\/[a-z](?:\/|$)/i.test(repositoryRoot.replaceAll("\\", "/"));
const wslCheckoutNote = isWslWindowsMount
  ? " This WSL checkout is on a Windows-mounted drive; use a separate Linux-filesystem checkout under ~/src/glyph-mend."
  : "";
const requireFromRepository = createRequire(path.join(repositoryRoot, "package.json"));
const nativeCliPackage = getNativeCliPackage();
let tauriCliEntry;
let nativeCliAvailable = false;
try {
  tauriCliEntry = requireFromRepository.resolve("@tauri-apps/cli/tauri.js");
  if (nativeCliPackage) {
    nativeCliAvailable = createRequire(tauriCliEntry).resolve(`@tauri-apps/${nativeCliPackage}`) !== undefined;
  }
} catch {
  nativeCliAvailable = false;
}

if (!tauriCliEntry || (nativeCliPackage && !nativeCliAvailable)) {
  throw new Error(
    `The Tauri CLI or its native package for ${process.platform}/${process.arch} is missing. `
    + "From the repository root, install dependencies with Node.js 22 using `npm ci --include=optional`. "
    + "Use a separate checkout for each OS/architecture target; platform-specific node_modules and runtime files are not interchangeable."
    + wslCheckoutNote,
  );
}

const tauriArgs = process.argv.slice(2);
const tauriEnvironment = { ...process.env };
if (tauriArgs[0] === "build" || tauriArgs[0] === "bundle") {
  const separatorIndex = tauriArgs.indexOf("--");
  const insertIndex = separatorIndex === -1 ? tauriArgs.length : separatorIndex;
  const options = tauriArgs.slice(0, insertIndex);
  const targetOption = options.findIndex((arg) => arg === "--target" || arg === "-t");
  if (targetOption >= 0 && (!options[targetOption + 1] || options[targetOption + 1].startsWith("-"))) {
    throw new Error("Tauri --target requires a Rust target triple.");
  }
  const explicitTarget = targetOption >= 0 ? options[targetOption + 1]
    : options.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
      || options.find((arg) => arg.startsWith("-t") && arg.length > 2)?.slice(2);
  const manifestPath = path.join(tauriDir, "resources/runtime/runtime-source-manifest.json");
  const preparedTarget = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).target : undefined;
  const requestedTarget = explicitTarget || process.env.TARGET?.trim() || preparedTarget;
  if (explicitTarget && process.env.TARGET && explicitTarget !== process.env.TARGET.trim()) {
    throw new Error(`Tauri --target ${explicitTarget} conflicts with TARGET=${process.env.TARGET}. Use the same target for compilation and runtime preparation.`);
  }
  if (requestedTarget) {
    tauriEnvironment.TARGET = requestedTarget;
    if (!explicitTarget) tauriArgs.splice(insertIndex, 0, "--target", requestedTarget);
    console.log(`[tauri] Building and assembling runtime resources for ${requestedTarget}.`);
  }
  if (process.platform === "darwin") {
    const hostVersion = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" });
    if (hostVersion.error) throw hostVersion.error;
    if (hostVersion.status !== 0) throw new Error(`Could not read macOS host version: ${hostVersion.stderr}`);
    const config = JSON.parse(readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"));
    const minimum = selectMacPackageMinimum(config.bundle.macOS.minimumSystemVersion, hostVersion.stdout.trim());
    tauriEnvironment.MACOSX_DEPLOYMENT_TARGET = minimum;
    tauriEnvironment.GLYPHMEND_MACOS_MINIMUM_SYSTEM_VERSION = minimum;
    const override = JSON.stringify({ bundle: { macOS: { minimumSystemVersion: minimum } } });
    const configSeparator = tauriArgs.indexOf("--");
    tauriArgs.splice(configSeparator === -1 ? tauriArgs.length : configSeparator, 0, "--config", override);
    console.log(`[tauri] macOS package minimum and Rust deployment target: ${minimum}.`);
  }
}
if (isWslWindowsMount) {
  console.warn(
    "[tauri] This WSL checkout is on a Windows-mounted drive. Use a separate checkout under ~/src/glyph-mend; "
    + "do not share Windows node_modules or runtime resources.",
  );
}
if (isWsl && tauriArgs[0] === "dev" && tauriEnvironment.WEBKIT_DISABLE_COMPOSITING_MODE === undefined) {
  tauriEnvironment.WEBKIT_DISABLE_COMPOSITING_MODE = "1";
  console.log("[tauri] WSL detected; disabling WebKit compositing for this development session.");
}

const result = spawnSync(process.execPath, [tauriCliEntry, ...tauriArgs], {
  cwd: tauriDir,
  env: tauriEnvironment,
  stdio: "inherit",
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
