import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hasVerifiedPdfium, sha256 } from "./runtime-integrity.mjs";
import { collectMacDependencyGraph, parseOtoolDependencies } from "./macos-dependencies.mjs";
import { isNewerMacVersion, selectMacPackageMinimum } from "./macos-package-policy.mjs";
import { createSpdxTextFetcher, SPDX_DATA_COMMIT } from "../../../../../web-app/scripts/spdx-license-text.mjs";

test("uses a macOS host's patch minimum consistently and never lowers the configured floor", () => {
  assert.equal(selectMacPackageMinimum("15.0", "15.7.5"), "15.7.5");
  assert.equal(isNewerMacVersion("15.7.5", selectMacPackageMinimum("15.0", "15.7.5")), false);
  assert.equal(selectMacPackageMinimum("16.0", "15.7.5"), "16.0");
  assert.equal(isNewerMacVersion("15.10", "15.7.5"), true);
  assert.equal(isNewerMacVersion("15.0.0", "15.0"), false);
  assert.throws(() => selectMacPackageMinimum("15.0", "unknown"), /Invalid macOS/);
});

test("loads libpng from immutable SPDX data, retries transient HTTP failures, and caches success", async () => {
  const urls = [];
  const getText = createSpdxTextFetcher(async (url) => {
    urls.push(url);
    return urls.length === 1 ? { ok: false, status: 503 }
      : { ok: true, text: async () => "PNG Reference Library License version 2" };
  });
  assert.match(await getText("libpng-2.0"), /PNG Reference/);
  await getText("libpng-2.0");
  assert.equal(urls.length, 2);
  assert.equal(urls[0], `https://raw.githubusercontent.com/spdx/license-list-data/${SPDX_DATA_COMMIT}/text/libpng-2.0.txt`);
});

test("loads SPDX exceptions from the same canonical text directory", async () => {
  let requested;
  const getText = createSpdxTextFetcher(async (url) => {
    requested = url;
    return { ok: true, text: async () => "LLVM exception text" };
  });
  assert.equal(await getText("LLVM-exception"), "LLVM exception text");
  assert.match(requested, /\/text\/LLVM-exception\.txt$/);
});

test("retries interrupted SPDX response bodies without caching incomplete text", async () => {
  let attempts = 0;
  const getText = createSpdxTextFetcher(async () => ({ ok: true, text: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("connection closed");
    return "complete license text";
  } }));
  assert.equal(await getText("MIT"), "complete license text");
  assert.equal(attempts, 2);
});

test("fails missing or malformed license texts rather than silently omitting notices", async () => {
  let attempts = 0;
  const missing = createSpdxTextFetcher(async () => { attempts += 1; return { ok: false, status: 404 }; });
  await assert.rejects(missing("unknown-license"), /unavailable \(404\)/);
  assert.equal(attempts, 1);
  const html = createSpdxTextFetcher(async () => ({ ok: true, text: async () => "<!DOCTYPE html><html>error</html>" }));
  await assert.rejects(html("MIT"), /HTML response/);
});

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "glyphmend-packaging-"));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())
      || !path.basename(root).startsWith("glyphmend-packaging-")) throw new Error("Unsafe fixture cleanup path");
    rmSync(root, { recursive: true, force: true });
  });
  const put = (relative, contents = "fixture") => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return file;
  };
  return { root, put };
}

function pdfiumFixture(t, relocated = false) {
  const temporary = fixture(t);
  const root = path.join(temporary.root, "runtime");
  const put = (relative, contents) => temporary.put(`runtime/${relative}`, contents);
  const library = put("pdfium/libpdfium.so", "verified upstream bytes");
  const source = { target: "x86_64-unknown-linux-gnu", pdfium: {
    file: "libpdfium.so", archiveSha256: "pinned-archive", fileSha256: sha256(library),
  } };
  const sourceFile = put("runtime-source-manifest.json", JSON.stringify(source));
  if (relocated) put("pdfium/libpdfium.so", "relocated bytes");
  const assembled = { ...source, pdfium: { ...source.pdfium, bundledFileSha256: sha256(library) }, files: [
    { path: "pdfium/libpdfium.so", sha256: sha256(library) },
    { path: "runtime-source-manifest.json", sha256: sha256(sourceFile) },
  ] };
  const save = () => put("runtime-manifest.json", JSON.stringify(assembled));
  save();
  return { root, put, source, assembled, save };
}

test("accepts verified upstream PDFium before relocation", (t) => {
  const { root, source } = pdfiumFixture(t);
  assert.equal(hasVerifiedPdfium(root, source), true);
});

test("accepts relocated PDFium without changing upstream provenance", (t) => {
  const { root, source, assembled } = pdfiumFixture(t, true);
  assert.notEqual(source.pdfium.fileSha256, assembled.pdfium.bundledFileSha256);
  assert.equal(hasVerifiedPdfium(root, source), true);
});

test("rejects corrupted packaged PDFium and a missing assembly manifest", (t) => {
  const { root, put, source } = pdfiumFixture(t, true);
  put("pdfium/libpdfium.so", "corrupted bytes");
  assert.equal(hasVerifiedPdfium(root, source), false);
  rmSync(path.join(root, "runtime-manifest.json"));
  assert.equal(hasVerifiedPdfium(root, source), false);
});

test("rejects mismatched assembly target, upstream provenance, and source manifest", (t) => {
  const { root, put, source, assembled, save } = pdfiumFixture(t, true);
  assembled.target = "other-target";
  save();
  assert.equal(hasVerifiedPdfium(root, source), false);
  assembled.target = source.target;
  assembled.pdfium.archiveSha256 = "different-archive";
  save();
  assert.equal(hasVerifiedPdfium(root, source), false);
  assembled.pdfium.archiveSha256 = source.pdfium.archiveSha256;
  save();
  put("runtime-source-manifest.json", "changed source manifest");
  assert.equal(hasVerifiedPdfium(root, source), false);
});

test("validates an extracted Linux runtime after relocation and rejects subsequent corruption", (t) => {
  const { root, put, source, assembled, save } = pdfiumFixture(t, true);
  source.platform = "linux";
  source.distribution = "desktop";
  source.tessdata = { modelDigests: {} };
  for (const model of ["fast", "best"]) {
    source.tessdata.modelDigests[model] = {};
    for (const language of ["eng", "rus", "fas", "chi_sim"]) {
      const file = put(`tessdata/${model}/${language}.traineddata`, "model");
      source.tessdata.modelDigests[model][language] = sha256(file);
    }
    put(`notices/tessdata-${model}/LICENSE`, "license");
    put(`notices/tessdata-${model}/UPSTREAM_COMMIT`, "commit");
  }
  for (const notice of ["tesseract-LICENSE-Apache-2.0.txt", "leptonica-LICENSE-BSD-2-Clause.txt",
    "LICENSES.txt", "GlyphMend-DEPENDENCIES.md", "GlyphMend-THIRD_PARTY_NOTICES.md",
    "browser/BROWSER_DEPENDENCY_NOTICES.md", "browser/BROWSER_DEPENDENCIES.json",
    "rust/RUST_DEPENDENCY_NOTICES.md", "rust/RUST_DEPENDENCIES.json",
    "pdfium/pdfium.txt", "native/linux/package.copyright"]) put(`notices/${notice}`, "notice");
  put("lib/libtesseract.so", "native library");
  put("lib/liblept.so", "native library");
  put("runtime-source-manifest.json", JSON.stringify(source));
  Object.assign(assembled, source, { pdfium: assembled.pdfium });
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
  assembled.files = walk(root).filter((file) => path.basename(file) !== "runtime-manifest.json")
    .map((file) => ({ path: path.relative(root, file).split(path.sep).join("/"),
      bytes: statSync(file).size, sha256: sha256(file) }));
  assembled.runtimeLibraries = ["lib/libtesseract.so", "lib/liblept.so"];
  assembled.totalBytes = assembled.files.reduce((total, file) => total + file.bytes, 0);
  save();
  const validate = () => spawnSync(process.execPath, [fileURLToPath(new URL("./validate-runtime.mjs", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, TARGET: source.target, GLYPHMEND_TEST_RESOURCE_DIR: path.dirname(root) },
  });
  const verified = validate();
  assert.equal(verified.status, 0, verified.stderr);
  put("pdfium/libpdfium.so", "corrupted packaged library");
  const corrupted = validate();
  assert.equal(corrupted.status, 1);
  assert.match(corrupted.stderr, /PDFium|checksum/);
});

test("collects macOS direct and recursive dependencies, including libarchive, with cycles and rpaths", (t) => {
  const { root, put } = fixture(t);
  const executable = put("bin/glyphmend");
  const pdfium = put("runtime/pdfium/libpdfium.dylib");
  const tesseract = put("Cellar/tesseract/5/lib/libtesseract.dylib");
  const archive = put("Cellar/libarchive/3/lib/libarchive.13.dylib");
  const lept = put("Cellar/leptonica/1/lib/liblept.dylib");
  const inspections = new Map([
    [executable, { dependencies: [tesseract, archive, "/usr/lib/libSystem.B.dylib"], rpaths: [] }],
    [pdfium, { dependencies: ["/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"], rpaths: [] }],
    [tesseract, { dependencies: ["@rpath/liblept.dylib"], rpaths: [path.dirname(lept)] }],
    [archive, { dependencies: [archive, tesseract], rpaths: [] }],
    [lept, { dependencies: [archive], rpaths: [] }],
  ]);
  const graph = collectMacDependencyGraph({ executable, pdfium, cellar: path.join(root, "Cellar"),
    inspect: (file) => inspections.get(file) });
  assert.equal(graph.libraries.size, 3);
  assert.deepEqual([...graph.packages].sort(), ["leptonica", "libarchive", "tesseract"]);
});

test("omits a dylib's own install name while preserving executable dependencies", () => {
  const output = "file:\n\t@rpath/libpdfium.dylib (compatibility version 0.0.0, current version 0.0.0)\n"
    + "\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)\n";
  assert.deepEqual(parseOtoolDependencies("libpdfium.dylib", output), ["/usr/lib/libSystem.B.dylib"]);
  assert.equal(parseOtoolDependencies("companion-tauri", output).length, 2);
});

test("reuses original Homebrew sources for previously relocated PDFium references", (t) => {
  const { root, put } = fixture(t);
  const executable = put("bin/glyphmend");
  const pdfium = put("runtime/pdfium/libpdfium.dylib");
  const original = put("Cellar/libarchive/3/lib/libarchive.13.dylib");
  put("runtime/lib/libarchive.13.dylib", "relocated library");
  const graph = collectMacDependencyGraph({ executable, pdfium, cellar: path.join(root, "Cellar"),
    inspect: (file) => file === executable ? { dependencies: [original], rpaths: [] }
      : file === pdfium ? { dependencies: ["@rpath/libarchive.13.dylib"], rpaths: ["@loader_path/../lib"] }
        : { dependencies: [], rpaths: [] } });
  assert.equal(graph.libraries.get("libarchive.13.dylib"), original);
});

test("resolves inherited executable rpaths relative to the executable", (t) => {
  const { root, put } = fixture(t);
  const executable = put("bin/glyphmend");
  const pdfium = put("runtime/pdfium/libpdfium.dylib");
  const first = put("Cellar/first/1/lib/first.dylib");
  const second = put("Cellar/second/1/lib/second.dylib");
  const graph = collectMacDependencyGraph({ executable, pdfium, cellar: path.join(root, "Cellar"),
    inspect: (file) => file === executable
      ? { dependencies: [first], rpaths: ["@loader_path/../Cellar/second/1/lib"] }
      : { dependencies: file === first ? ["@rpath/second.dylib"] : [], rpaths: [] } });
  assert.equal(graph.libraries.get("second.dylib"), second);
});

test("resolves a cached relocated executable using recorded Homebrew origins", (t) => {
  const { root, put } = fixture(t);
  const executable = put("bin/glyphmend");
  const pdfium = put("runtime/pdfium/libpdfium.dylib");
  const archive = put("Cellar/libarchive/3/lib/libarchive.13.dylib");
  const graph = collectMacDependencyGraph({ executable, pdfium, cellar: path.join(root, "Cellar"),
    previousSources: { "libarchive.13.dylib": archive },
    inspect: (file) => ({ dependencies: file === executable ? ["@rpath/libarchive.13.dylib"] : [],
      rpaths: file === executable ? ["@executable_path/../Resources/runtime/lib"] : [] }) });
  assert.equal(graph.libraries.get("libarchive.13.dylib"), archive);
});

test("fails unresolved macOS dependencies instead of producing an incomplete installer", (t) => {
  const { root, put } = fixture(t);
  const executable = put("bin/glyphmend");
  const pdfium = put("runtime/pdfium/libpdfium.dylib");
  mkdirSync(path.join(root, "Cellar"));
  assert.throws(() => collectMacDependencyGraph({ executable, pdfium, cellar: path.join(root, "Cellar"),
    inspect: () => ({ dependencies: ["@rpath/missing.dylib"], rpaths: [] }) }), /Cannot resolve/);
});

test("checksums the installer and SBOM using filenames unique to each platform", (t) => {
  const { root, put } = fixture(t);
  const installer = put("release/App.deb", "installer bytes");
  const sbom = put("release/SBOM.json", "SBOM bytes");
  put("release/SHA256SUMS-old.txt", "old checksums");
  const script = fileURLToPath(new URL("./write-release-checksums.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, path.join(root, "release"), "SHA256SUMS-linux.txt"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(root, "release/SHA256SUMS-linux.txt"), "utf8"),
    `${sha256(installer)}  App.deb\n${sha256(sbom)}  SBOM.json\n`);
});
