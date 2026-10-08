import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
