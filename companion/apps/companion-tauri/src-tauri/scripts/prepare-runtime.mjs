import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "../../../../..");
const runtimeDir = path.resolve(scriptDir, "../resources/runtime");
const pdfiumRelease = "chromium/8066";
const tessdataCommits = {
  fast: "87416418657359cb625c412a48b6e1d6d41c29bd",
  best: "e12c65a915945e4c28e237a9b52bc4a8f39a0cec",
};
const languages = ["eng", "rus", "fas", "chi_sim"];
const targets = {
  "x86_64-pc-windows-msvc": {
    os: "windows",
    asset: "pdfium-win-x64.tgz",
    sha256: "739a57d597d864297909cc40a2411eba728490c76a0fa25e3ea299c7f6b07020",
    library: "pdfium.dll",
  },
  "x86_64-unknown-linux-gnu": {
    os: "linux",
    asset: "pdfium-linux-x64.tgz",
    sha256: "0b43f405477cf2cfc4dbff06905093c3309756c6bca1fb9da99234a2ca97fed2",
    library: "libpdfium.so",
  },
  "x86_64-apple-darwin": {
    os: "macos",
    asset: "pdfium-mac-x64.tgz",
    sha256: "841ecac278cdd46288dd065873522cf72f3996560d8978f473d336f01d59942c",
    library: "libpdfium.dylib",
  },
  "aarch64-apple-darwin": {
    os: "macos",
    asset: "pdfium-mac-arm64.tgz",
    sha256: "336219e80580b93c6523f44db7dc1de59cc497b13a7390ddac84223f68ca162b",
    library: "libpdfium.dylib",
  },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function findFile(root, name) {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(fullPath, name);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Download was empty: ${url}`);
  writeFileSync(destination, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

function copyLicense(source, destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function collectProjectLicenses(noticesDir) {
  const glyphmendDir = path.join(noticesDir, "glyphmend");
  mkdirSync(glyphmendDir, { recursive: true });
  const files = [
    [path.join(repositoryRoot, "web-app/LICENSE"), path.join(glyphmendDir, "LICENSE-AGPL-3.0-or-later.txt")],
    [path.join(repositoryRoot, "companion/LICENSE-APACHE"), path.join(glyphmendDir, "LICENSE-Apache-2.0.txt")],
    [path.join(repositoryRoot, "companion/LICENSE-MIT"), path.join(glyphmendDir, "LICENSE-MIT.txt")],
    [path.join(repositoryRoot, "companion/DEPENDENCIES.md"), path.join(noticesDir, "GlyphMend-DEPENDENCIES.md")],
    [path.join(repositoryRoot, "companion/THIRD_PARTY_NOTICES.md"), path.join(noticesDir, "GlyphMend-THIRD_PARTY_NOTICES.md")],
  ];
  for (const [source, destination] of files) {
    if (!existsSync(source)) throw new Error(`Required license or notice file is missing: ${source}`);
    copyLicense(source, destination);
  }
  const combined = [
    "GlyphMend Desktop license texts",
    "================================",
    "",
    "The browser interface and Rust components carry separate licenses. The complete texts are included below.",
    "",
    "--- GlyphMend browser interface: AGPL-3.0-or-later ---",
    readFileSync(files[0][0], "utf8"),
    "--- GlyphMend Rust crates: Apache-2.0 ---",
    readFileSync(files[1][0], "utf8"),
    "--- GlyphMend Rust crates: MIT ---",
    readFileSync(files[2][0], "utf8"),
  ].join("\n");
  writeFileSync(path.join(noticesDir, "LICENSES.txt"), combined);
}

const detectedOs = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const detectedArch = process.arch === "arm64" ? "aarch64" : "x86_64";
const target = process.env.TARGET || Object.entries(targets).find(([triple, item]) =>
  item.os === detectedOs && triple.startsWith(`${detectedArch}-`),
)?.[0];
const targetConfig = targets[target];
if (!targetConfig || targetConfig.os !== (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux")) {
  throw new Error(`Unsupported GlyphMend Desktop target: ${target || "unknown"}`);
}

const sourceManifestPath = path.join(runtimeDir, "runtime-source-manifest.json");
if (hasMatchingRuntime()) {
  console.log(`GlyphMend Desktop runtime resources are already prepared for ${target}.`);
  process.exit(0);
}

const existing = readdirSync(runtimeDir).filter((name) => name !== ".gitkeep");
const unexpected = existing.filter((name) => name !== "notices");
const generatedNoticePaths = [
  "pdfium",
  "tessdata-fast",
  "tessdata-best",
  "glyphmend",
  "native",
  "LICENSES.txt",
];
if (unexpected.length || generatedNoticePaths.some((name) => existsSync(path.join(runtimeDir, "notices", name)))) {
  throw new Error(
    `Desktop runtime data already exists at ${runtimeDir}, but it does not match ${target}. `
    + "From the repository root, run `npm run desktop:clean:runtime` to remove recognized generated files, "
    + "then prepare again. Keep Windows and WSL in separate checkouts.",
  );
}
for (const name of ["pdfium", "tessdata", "lib", "runtime-source-manifest.json", "runtime-manifest.json"]) {
  if (existsSync(path.join(runtimeDir, name))) {
    throw new Error(
      `Desktop runtime data already exists at ${path.join(runtimeDir, name)}, but it does not match ${target}. `
      + "From the repository root, run `npm run desktop:clean:runtime` to remove recognized generated files, "
      + "then prepare again. Keep Windows and WSL in separate checkouts.",
    );
  }
}

const temporaryRoot = mkdtempRuntime();
try {
  const archive = path.join(temporaryRoot, targetConfig.asset);
  const pdfiumUrl = `https://github.com/bblanchon/pdfium-binaries/releases/download/${encodeURIComponent(pdfiumRelease)}/${targetConfig.asset}`;
  const pdfiumArchiveSha256 = await download(pdfiumUrl, archive);
  if (pdfiumArchiveSha256 !== targetConfig.sha256) {
    throw new Error(`PDFium archive SHA-256 mismatch: expected ${targetConfig.sha256}, got ${pdfiumArchiveSha256}`);
  }
  const extractDir = path.join(temporaryRoot, "pdfium");
  mkdirSync(extractDir);
  run(process.platform === "win32" ? "tar.exe" : "tar", ["-xzf", archive, "-C", extractDir]);
  const pdfiumPath = findFile(extractDir, targetConfig.library);
  if (!pdfiumPath) throw new Error(`Pinned PDFium archive did not contain ${targetConfig.library}`);

  const pdfiumDir = path.join(runtimeDir, "pdfium");
  const tessdataRoot = path.join(runtimeDir, "tessdata");
  const noticesDir = path.join(runtimeDir, "notices");
  mkdirSync(pdfiumDir, { recursive: true });
  mkdirSync(tessdataRoot, { recursive: true });
  mkdirSync(noticesDir, { recursive: true });
  copyFileSync(pdfiumPath, path.join(pdfiumDir, targetConfig.library));
  const pdfiumLicenses = path.join(extractDir, "licenses");
  if (existsSync(pdfiumLicenses)) {
    cpSync(pdfiumLicenses, path.join(noticesDir, "pdfium"), { recursive: true });
  } else {
    const licenseDir = path.join(noticesDir, "pdfium");
    mkdirSync(licenseDir, { recursive: true });
    for (const entry of readdirSync(extractDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase().includes("license")) {
        cpSync(path.join(extractDir, entry.name), path.join(licenseDir, entry.name), { recursive: true });
      }
    }
  }
  const pdfiumLicense = path.join(extractDir, "LICENSE");
  if (existsSync(pdfiumLicense)) {
    copyFileSync(pdfiumLicense, path.join(noticesDir, "pdfium", "LICENSE"));
  }
  const pdfiumNoticeFiles = findFile(noticesDir, "LICENSE");
  if (!pdfiumNoticeFiles) throw new Error("The pinned PDFium archive did not provide license texts.");

  const modelDigests = {};
  for (const [modelSet, commit] of Object.entries(tessdataCommits)) {
    const modelDir = path.join(tessdataRoot, modelSet);
    const modelNoticeDir = path.join(noticesDir, `tessdata-${modelSet}`);
    mkdirSync(modelDir, { recursive: true });
    mkdirSync(modelNoticeDir, { recursive: true });
    modelDigests[modelSet] = {};
    for (const language of languages) {
      const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_${modelSet}/${commit}/${language}.traineddata`;
      modelDigests[modelSet][language] = await download(url, path.join(modelDir, `${language}.traineddata`));
    }
    await download(
      `https://raw.githubusercontent.com/tesseract-ocr/tessdata_${modelSet}/${commit}/LICENSE`,
      path.join(modelNoticeDir, "LICENSE"),
    );
    writeFileSync(path.join(modelNoticeDir, "UPSTREAM_COMMIT"), `${commit}\n`);
  }

  await download(
    "https://raw.githubusercontent.com/tesseract-ocr/tesseract/main/LICENSE",
    path.join(noticesDir, "tesseract-LICENSE-Apache-2.0.txt"),
  );
  await download(
    "https://raw.githubusercontent.com/DanBloomberg/leptonica/master/leptonica-license.txt",
    path.join(noticesDir, "leptonica-LICENSE-BSD-2-Clause.txt"),
  );
  collectProjectLicenses(noticesDir);
  writeFileSync(path.join(runtimeDir, "runtime-source-manifest.json"), `${JSON.stringify({
    distribution: "desktop",
    target,
    platform: targetConfig.os,
    pdfium: {
      release: pdfiumRelease,
      archive: targetConfig.asset,
      archiveSha256: pdfiumArchiveSha256,
      file: targetConfig.library,
      fileSha256: createHash("sha256").update(readFileSync(pdfiumPath)).digest("hex"),
    },
    tessdata: { commits: tessdataCommits, modelDigests },
  }, null, 2)}\n`);
  console.log(`Prepared pinned GlyphMend Desktop runtime resources for ${target}.`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function mkdtempRuntime() {
  const temporaryRoot = path.join(os.tmpdir(), `glyphmend-runtime-${process.pid}-${Date.now()}`);
  mkdirSync(temporaryRoot, { recursive: true });
  return temporaryRoot;
}

function hasMatchingRuntime() {
  if (!existsSync(sourceManifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
    if (manifest.distribution !== "desktop"
      || manifest.target !== target
      || manifest.platform !== targetConfig.os
      || manifest.pdfium?.release !== pdfiumRelease
      || manifest.pdfium?.archiveSha256 !== targetConfig.sha256
      || manifest.tessdata?.commits?.fast !== tessdataCommits.fast
      || manifest.tessdata?.commits?.best !== tessdataCommits.best) {
      return false;
    }

    const pdfiumPath = path.join(runtimeDir, "pdfium", targetConfig.library);
    if (!matchesDigest(pdfiumPath, manifest.pdfium.fileSha256)) return false;

    for (const modelSet of Object.keys(tessdataCommits)) {
      for (const language of languages) {
        const modelPath = path.join(runtimeDir, "tessdata", modelSet, `${language}.traineddata`);
        const expectedDigest = manifest.tessdata.modelDigests?.[modelSet]?.[language];
        if (!matchesDigest(modelPath, expectedDigest)) return false;
      }
    }
    return existsSync(path.join(runtimeDir, "notices", "LICENSES.txt"));
  } catch {
    return false;
  }
}

function matchesDigest(filePath, expectedDigest) {
  if (!expectedDigest || !existsSync(filePath)) return false;
  const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return digest === expectedDigest;
}
