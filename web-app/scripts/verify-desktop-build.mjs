import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { missingMupdfRuntimeAssets, MUPDF_RUNTIME_ASSETS } from "../src/features/extraction/mupdf-assets.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputDir = join(repositoryRoot, "companion/apps/companion-tauri/web/dist");
const indexPath = join(outputDir, "index.html");
const index = await readFile(indexPath, "utf8");
const files = await listFiles(outputDir);
const javascriptFiles = files.filter((file) => file.endsWith(".js"));
const javascript = (await Promise.all(javascriptFiles.map((file) => readFile(file, "utf8")))).join("\n");

if (files.some((file) => /(^|\\|\/)sw\.js$|workbox/i.test(file))) {
  throw new Error("Desktop build must load its bundled assets directly without a service worker.");
}
const entrySource = index.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)?.[1];
if (!entrySource || !files.includes(join(outputDir, entrySource.replace(/^\.\//, "")))) {
  throw new Error("Desktop build is missing its bundled JavaScript entry point.");
}
if (!javascript.includes("companion_create_job")) {
  throw new Error("Desktop build is missing its registered Tauri entry or IPC adapter.");
}
if (javascript.includes("127.0.0.1") || javascript.includes("companionEndpoint")) {
  throw new Error("Desktop build unexpectedly includes a loopback HTTP adapter.");
}

const mupdfDirectory = join(outputDir, "mupdf");
const presentAssets = await readdir(mupdfDirectory).catch(() => []);
const missing = missingMupdfRuntimeAssets(presentAssets);
if (missing.length) throw new Error("Desktop build is missing MuPDF runtime assets: " + missing.join(", "));
for (const asset of MUPDF_RUNTIME_ASSETS) {
  const details = await stat(join(mupdfDirectory, asset));
  if (!details.isFile() || details.size === 0) {
    throw new Error("Desktop MuPDF asset is empty or not a file: " + asset);
  }
}

const wasm = await readFile(join(mupdfDirectory, "mupdf-wasm.wasm"));
if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) {
  throw new Error("Desktop MuPDF WASM file has an invalid WebAssembly signature.");
}

console.log(`Verified Tauri IPC entry, bundled MuPDF assets, and no service worker (${files.length} files).`);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}
