import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasVerifiedPdfium } from "./runtime-integrity.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = process.env.GLYPHMEND_TEST_RESOURCE_DIR
  ? path.resolve(process.env.GLYPHMEND_TEST_RESOURCE_DIR, "runtime")
  : path.resolve(scriptDir, "../resources/runtime");
const target = process.env.TARGET || targetForHost();
const platform = target.includes("windows") ? "windows" : target.includes("apple-darwin") ? "macos" : "linux";
const languages = ["eng", "rus", "fas", "chi_sim"];
const failures = [];

function targetForHost() {
  const os = process.platform === "win32" ? "pc-windows-msvc" : process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `${arch}-${os}`;
}

function fail(message) {
  failures.push(message);
}

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function checkFile(relative, label = relative) {
  const fullPath = path.join(runtimeDir, relative);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile() || statSync(fullPath).size === 0) {
    fail(`Required desktop runtime file is missing or empty: ${label}`);
    return false;
  }
  return true;
}

if (!existsSync(runtimeDir)) fail(`Desktop runtime directory is missing: ${runtimeDir}`);
const pdfiumName = platform === "windows" ? "pdfium.dll" : platform === "macos" ? "libpdfium.dylib" : "libpdfium.so";
checkFile(`pdfium/${pdfiumName}`);
for (const modelSet of ["fast", "best"]) {
  for (const language of languages) checkFile(`tessdata/${modelSet}/${language}.traineddata`);
  checkFile(`notices/tessdata-${modelSet}/LICENSE`);
  checkFile(`notices/tessdata-${modelSet}/UPSTREAM_COMMIT`);
}
checkFile("notices/tesseract-LICENSE-Apache-2.0.txt");
checkFile("notices/leptonica-LICENSE-BSD-2-Clause.txt");
checkFile("notices/LICENSES.txt");
checkFile("notices/GlyphMend-DEPENDENCIES.md");
checkFile("notices/GlyphMend-THIRD_PARTY_NOTICES.md");
checkFile("notices/browser/BROWSER_DEPENDENCY_NOTICES.md");
checkFile("notices/browser/BROWSER_DEPENDENCIES.json");
checkFile("notices/rust/RUST_DEPENDENCY_NOTICES.md");
checkFile("notices/rust/RUST_DEPENDENCIES.json");
const sourceManifestPath = path.join(runtimeDir, "runtime-source-manifest.json");
let sourceManifest;
if (checkFile("runtime-source-manifest.json")) {
  try {
    sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
    if (sourceManifest.target !== target || sourceManifest.platform !== platform) {
      fail(`Desktop runtime source manifest target mismatch (expected ${target}, got ${sourceManifest.target || "missing"}).`);
    }
    if (sourceManifest.pdfium?.file !== pdfiumName) fail(`PDFium manifest entry must name ${pdfiumName}.`);
    if (!sourceManifest.pdfium?.fileSha256) fail("PDFium source manifest is missing the extracted library SHA-256.");
    else if (!hasVerifiedPdfium(runtimeDir, sourceManifest)) {
      fail("PDFium matches neither its verified upstream digest nor its assembled bundle digest and provenance.");
    }
    if (!sourceManifest.tessdata?.modelDigests) fail("OCR model digests are missing from the source manifest.");
    for (const modelSet of ["fast", "best"]) {
      for (const language of languages) {
        const relative = `tessdata/${modelSet}/${language}.traineddata`;
        const expected = sourceManifest.tessdata?.modelDigests?.[modelSet]?.[language];
        if (!expected) {
          fail(`OCR model digest is missing from the source manifest: ${modelSet}/${language}`);
        } else if (existsSync(path.join(runtimeDir, relative))
          && digest(path.join(runtimeDir, relative)) !== expected) {
          fail(`OCR model SHA-256 does not match the source manifest: ${modelSet}/${language}`);
        }
      }
    }
  } catch (error) {
    fail(`Could not validate desktop runtime source manifest: ${error.message}`);
  }
}

checkFile("notices/pdfium/pdfium.txt", "PDFium upstream license notice");

if (platform === "linux" || platform === "macos") {
  const nativeFiles = walkFiles(path.join(runtimeDir, "lib")).filter((file) => platform === "linux" ? /\.so(?:\.|$)/.test(file) : /\.dylib$/.test(file));
  if (!nativeFiles.some((file) => /tesseract/i.test(path.basename(file)))) fail(`The ${platform} Tesseract runtime library is not bundled.`);
  if (!nativeFiles.some((file) => /lept/i.test(path.basename(file))) && platform === "linux") fail("The Linux Leptonica runtime library is not bundled.");
  if (!nativeFiles.some((file) => /leptonica|^liblept/i.test(path.basename(file))) && platform === "macos") fail("The macOS Leptonica runtime library is not bundled.");
  if (!walkFiles(path.join(runtimeDir, `notices/native/${platform}`)).some((file) => /(?:license|copying|notice|copyright|spdx-)/i.test(path.basename(file)))) {
    fail(`The ${platform} native dependency bundle has no license text files.`);
  }
} else {
  checkFile("notices/native/windows/vcpkg-packages.txt");
  if (!walkFiles(path.join(runtimeDir, "notices/native/windows")).some((file) => /\.copyright$/i.test(file))) {
    fail("The Windows native dependency bundle has no copyright notices.");
  }
}

const manifestPath = path.join(runtimeDir, "runtime-manifest.json");
if (!checkFile("runtime-manifest.json")) {
  // The errors below are more useful once the manifest exists.
} else {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.distribution !== "desktop" || manifest.target !== target || manifest.platform !== platform) {
      fail(`Desktop runtime manifest target mismatch (expected ${target}, got ${manifest.target || "missing"}).`);
    }
    if (manifest.pdfium?.fileSha256 !== sourceManifest?.pdfium?.fileSha256
      || manifest.pdfium?.archiveSha256 !== sourceManifest?.pdfium?.archiveSha256
      || manifest.pdfium?.bundledFileSha256 !== digest(path.join(runtimeDir, "pdfium", pdfiumName))) {
      fail("Assembled PDFium provenance or bundled digest does not match the source manifest and library.");
    }
    if (!Array.isArray(manifest.files) || !manifest.files.length) {
      fail("Desktop runtime manifest does not list packaged files.");
    } else {
      for (const entry of manifest.files) {
        const fullPath = path.join(runtimeDir, entry.path);
        if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
          fail(`Runtime manifest file is missing: ${entry.path}`);
        } else if (statSync(fullPath).size !== entry.bytes || digest(fullPath) !== entry.sha256) {
          fail(`Runtime manifest checksum mismatch: ${entry.path}`);
        }
      }
    }
    if (!Array.isArray(manifest.runtimeLibraries)) fail("Runtime manifest does not identify platform native libraries.");
    else if (manifest.runtimeLibraries.some((file) => !manifest.files.some((entry) => entry.path === file))) {
      fail("Runtime manifest native library list contains a file that is not checksum-listed.");
    }
    const listedBytes = Array.isArray(manifest.files)
      ? manifest.files.reduce((total, entry) => total + Number(entry.bytes || 0), 0)
      : 0;
    if (manifest.totalBytes !== listedBytes) fail("Runtime manifest totalBytes does not match its file list.");
  } catch (error) {
    fail(`Could not validate desktop runtime manifest: ${error.message}`);
  }
}

if (failures.length) {
  console.error("Desktop runtime validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    "Recovery: use a checkout dedicated to this OS target, then run `npm run desktop:clean:runtime`, `npm run desktop:prepare`, and `npm run build:desktop` from the repository root.",
  );
  process.exitCode = 1;
} else {
  const size = walkFiles(runtimeDir).reduce((total, file) => total + statSync(file).size, 0);
  console.log(`Desktop runtime validation passed for ${target} (${(size / 1024 / 1024).toFixed(1)} MiB of resources).`);
}
