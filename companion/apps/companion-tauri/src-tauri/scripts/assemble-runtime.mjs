import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasVerifiedPdfium, sha256 } from "./runtime-integrity.mjs";
import { collectMacDependencyGraph, parseOtoolDependencies } from "./macos-dependencies.mjs";
import { getSpdxText } from "../../../../../web-app/scripts/spdx-license-text.mjs";
import { isNewerMacVersion } from "./macos-package-policy.mjs";
import { writeVcpkgNotices } from "./windows-notices.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "../../../../..");
const runtimeDir = path.resolve(scriptDir, "../resources/runtime");
const runtimeLibDir = path.join(runtimeDir, "lib");
const sourceManifestPath = path.join(runtimeDir, "runtime-source-manifest.json");
const previousManifestPath = path.join(runtimeDir, "runtime-manifest.json");
const previousManifest = existsSync(previousManifestPath)
  ? JSON.parse(readFileSync(previousManifestPath, "utf8")) : {};
const previousFiles = previousManifest.files || [];

function run(command, args, { allowFailure = false, encoding = "utf8" } = {}) {
  const result = spawnSync(command, args, { encoding, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return { output: String(result.stdout || "").trim(), status: result.status };
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function lddPaths(file) {
  const { output, status } = run("ldd", [file], { allowFailure: true });
  if (status !== 0 || output.includes("not found")) {
    throw new Error(`Could not resolve native runtime dependencies for ${file}: ${output}`);
  }
  return output.split(/\r?\n/).flatMap((line) => {
    const direct = line.match(/=>\s*(\/\S+)/);
    const loader = line.match(/^\s*(\/\S+)\s+\(/);
    return direct ? [direct[1]] : loader ? [loader[1]] : [];
  });
}

function isLinuxSystemLibrary(file) {
  return /^(?:linux-vdso|ld-linux|libc\.so|libm\.so|libpthread\.so|libdl\.so|librt\.so|libgcc_s\.so|libstdc\+\+\.so)/.test(path.basename(file));
}

function copyUniqueLibrary(source, destinationRoot) {
  const sourceName = path.basename(source);
  const sourcePath = realpathSync(source);
  const actualName = path.basename(sourcePath);
  const destination = path.join(destinationRoot, actualName);
  if (existsSync(destination)) {
    const oldHash = createHash("sha256").update(readFileSync(destination)).digest("hex");
    const newHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    if (oldHash !== newHash && !canReplaceAssembledLibrary(destination, oldHash)) {
      throw new Error(`Native dependency name collision: ${sourcePath} and ${destination}`);
    }
    if (oldHash !== newHash) copyFileSync(sourcePath, destination);
  } else {
    copyFileSync(sourcePath, destination);
  }
  if (sourceName !== actualName) {
    const alias = path.join(destinationRoot, sourceName);
    if (existsSync(alias)) {
      const oldHash = createHash("sha256").update(readFileSync(alias)).digest("hex");
      const newHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
      if (oldHash !== newHash && !canReplaceAssembledLibrary(alias, oldHash)) {
        throw new Error(`Native dependency alias collision: ${sourceName}`);
      }
      if (oldHash !== newHash) copyFileSync(sourcePath, alias);
    } else {
      copyFileSync(sourcePath, alias);
    }
    return alias;
  }
  return destination;
}

function canReplaceAssembledLibrary(file, digest) {
  const relative = path.relative(runtimeDir, file).split(path.sep).join("/");
  return previousFiles.some((entry) => entry.path === relative && entry.sha256 === digest);
}

function collectLinuxLibraries(seedFiles) {
  const queue = [];
  const bundledSources = new Set();
  for (const seed of seedFiles) {
    const source = seed;
    const resolvedSource = realpathSync(source);
    if (resolvedSource === runtimeDir || resolvedSource.startsWith(`${runtimeDir}${path.sep}`)) {
      queue.push(resolvedSource);
    } else {
      bundledSources.add(resolvedSource);
      queue.push(copyUniqueLibrary(source, runtimeLibDir));
    }
  }
  const visited = new Set();
  while (queue.length) {
    const current = realpathSync(queue.pop());
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dependency of lddPaths(current)) {
      if (isLinuxSystemLibrary(dependency)) continue;
      bundledSources.add(realpathSync(dependency));
      const copied = copyUniqueLibrary(dependency, runtimeLibDir);
      queue.push(copied);
    }
  }
  const executable = path.resolve(repositoryRoot, "companion/target", target, "release", "companion-tauri");
  const productName = JSON.parse(readFileSync(path.join(scriptDir, "..", "tauri.conf.json"), "utf8")).productName;
  run("patchelf", ["--set-rpath", `$ORIGIN/../lib/${productName}/runtime/lib`, executable]);
  const pdfium = path.join(runtimeDir, "pdfium", "libpdfium.so");
  run("patchelf", ["--set-rpath", "$ORIGIN/../lib", pdfium]);
  for (const file of walkFiles(runtimeLibDir)) {
    if (/\.so(?:\.|$)/.test(file)) run("patchelf", ["--set-rpath", "$ORIGIN", file]);
  }
  writeLinuxNotices([...bundledSources]);
}

function writeLinuxNotices(files) {
  const noticesDir = path.join(runtimeDir, "notices/native/linux");
  mkdirSync(noticesDir, { recursive: true });
  const packages = new Map();
  for (const file of files) {
    const ownership = run("dpkg-query", ["-S", file], { allowFailure: true }).output;
    const packageName = ownership.match(/^([^:,]+):/)?.[1];
    if (packageName) packages.set(packageName, true);
  }
  const records = [];
  for (const packageName of [...packages.keys()].sort()) {
    const copyrightPath = `/usr/share/doc/${packageName}/copyright`;
    if (!existsSync(copyrightPath)) {
      throw new Error(`Missing Debian copyright notice for bundled runtime package ${packageName}`);
    }
    copyFileSync(copyrightPath, path.join(noticesDir, `${packageName}.copyright`));
    records.push({ package: packageName, version: run("dpkg-query", ["-W", "-f=${Version}", packageName]).output });
  }
  writeFileSync(path.join(noticesDir, "packages.json"), `${JSON.stringify(records, null, 2)}\n`);
}

function otoolDependencies(file) {
  const output = run("otool", ["-L", file]).output;
  return parseOtoolDependencies(file, output);
}

function validateMacDeploymentTarget(files) {
  const configPath = path.join(scriptDir, "..", "tauri.conf.json");
  const configured = process.env.GLYPHMEND_MACOS_MINIMUM_SYSTEM_VERSION
    || JSON.parse(readFileSync(configPath, "utf8")).bundle?.macOS?.minimumSystemVersion;
  if (!configured) throw new Error("Tauri macOS minimumSystemVersion is not configured.");
  for (const file of files) {
    const expectedArch = target.startsWith("aarch64-") ? "arm64" : "x86_64";
    if (!run("lipo", ["-archs", file]).output.split(/\s+/).includes(expectedArch)) {
      throw new Error(`${file} does not contain the required ${expectedArch} architecture.`);
    }
    const loadCommands = run("otool", ["-l", file]).output;
    const minimums = [...loadCommands.matchAll(/\bminos\s+(\d+(?:\.\d+){1,2})/g)].map((match) => match[1]);
    if (loadCommands.includes("LC_VERSION_MIN_MACOSX")) {
      minimums.push(...[...loadCommands.matchAll(/cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version (\d+(?:\.\d+){1,2})/g)]
        .map((match) => match[1]));
    }
    if (!minimums.length) {
      throw new Error(`Could not determine the minimum macOS version from load commands in ${file}.`);
    }
    for (const minimum of minimums) {
      if (isNewerMacVersion(minimum, configured)) {
        throw new Error(`${file} requires macOS ${minimum}, above the effective package minimum ${configured}. Rebuild native dependencies for that target or use a compatible build host.`);
      }
    }
  }
}

async function collectMacLibraries(executable) {
  const pdfium = path.join(runtimeDir, "pdfium", "libpdfium.dylib");
  const { libraries, packages } = collectMacDependencyGraph({
    executable,
    pdfium,
    cellar: run("brew", ["--cellar"]).output,
    previousSources: previousManifest.runtimeLibrarySources || {},
    inspect: (file) => ({
      dependencies: otoolDependencies(file),
      rpaths: [...run("otool", ["-l", file]).output.matchAll(/\bpath\s+(.+?)\s+\(offset \d+\)/g)]
        .map((match) => match[1]),
    }),
  });
  if (!libraries.size) throw new Error("The macOS host has no non-system runtime libraries.");
  mkdirSync(runtimeLibDir, { recursive: true });
  for (const source of libraries.values()) copyUniqueLibrary(source, runtimeLibDir);
  const filesToPatch = [executable, pdfium, ...new Set(walkFiles(runtimeLibDir))];
  for (const file of filesToPatch) {
    for (const dependency of otoolDependencies(file)) {
      if (dependency.startsWith("/System/") || dependency.startsWith("/usr/lib/")) continue;
      if (!existsSync(path.join(runtimeLibDir, path.basename(dependency)))) {
        throw new Error(`macOS runtime dependency is not bundled: ${dependency} (required by ${file}).`);
      }
      if (dependency !== `@rpath/${path.basename(dependency)}`) {
        run("install_name_tool", ["-change", dependency, `@rpath/${path.basename(dependency)}`, file]);
      }
    }
    if (file !== executable && file !== pdfium) {
      const name = path.basename(file);
      run("install_name_tool", ["-id", `@rpath/${name}`, file]);
      addRpath(file, "@loader_path");
    }
  }
  addRpath(executable, "@executable_path/../Resources/runtime/lib");
  addRpath(pdfium, "@loader_path/../lib");
  validateMacDeploymentTarget(filesToPatch);
  for (const file of filesToPatch.filter((file) => file !== executable)) {
    run("codesign", ["--force", "--sign", "-", file]);
    run("codesign", ["--verify", "--strict", file]);
  }
  await writeMacNotices(packages);
  return Object.fromEntries(libraries);
}

function addRpath(file, rpath) {
  const loadCommands = run("otool", ["-l", file]).output;
  if (loadCommands.includes(`path ${rpath} (`)) return;
  run("install_name_tool", ["-add_rpath", rpath, file]);
}

async function writeMacNotices(packages) {
  const noticesDir = path.join(runtimeDir, "notices/native/macos");
  mkdirSync(noticesDir, { recursive: true });
  const metadata = JSON.parse(run("brew", ["info", "--json=v2", "--installed"]).output);
  const formulae = new Map((metadata.formulae || []).map((item) => [item.name, item]));
  const records = [];
  for (const packageName of [...packages].sort()) {
    const formula = formulae.get(packageName);
    if (!formula) throw new Error(`Homebrew omitted license metadata for ${packageName}`);
    const files = run("brew", ["list", "--verbose", packageName]).output.split(/\r?\n/);
    const noticeFiles = files.filter((file) => existsSync(file)
      && statSync(file).isFile()
      && /(?:^|\/)(?:LICENSE|COPYING|NOTICE|COPYRIGHT)(?:[._-].*)?$/i.test(file));
    const packageNotices = path.join(noticesDir, packageName);
    const formulaPrefix = realpathSync(run("brew", ["--prefix", packageName]).output);
    mkdirSync(packageNotices, { recursive: true });
    for (const file of noticeFiles) {
      const relative = path.relative(formulaPrefix, realpathSync(file));
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Homebrew notice file is outside the ${packageName} formula directory: ${file}`);
      }
      const destination = path.join(packageNotices, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(file, destination);
    }
    const license = formula.license || "";
    const withoutExceptions = license.replace(/\bWITH\s+[A-Za-z0-9][A-Za-z0-9.+-]*/gi, "");
    const ids = [...new Set(withoutExceptions.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) || [])]
      .filter((id) => !["AND", "OR", "WITH"].includes(id.toUpperCase()) && !id.startsWith("LicenseRef-"));
    const exceptions = [...new Set([...license.matchAll(/\bWITH\s+([A-Za-z0-9][A-Za-z0-9.+-]*)/g)].map((match) => match[1]))];
    if (!noticeFiles.length && !ids.length) {
      throw new Error(`Homebrew formula ${packageName} has no full license file or usable SPDX license expression.`);
    }
    for (const id of noticeFiles.length ? [] : ids) {
      writeFileSync(path.join(packageNotices, `SPDX-${id}.txt`), await getSpdxText(id));
    }
    for (const id of exceptions) {
      writeFileSync(path.join(packageNotices, `SPDX-exception-${id}.txt`), await getSpdxText(id));
    }
    writeFileSync(path.join(packageNotices, "PACKAGE.txt"), `${packageName}@${formula.versions?.stable || "unknown"}\nLicense: ${license || "UNSPECIFIED"}\nHomepage: ${formula.homepage || ""}\n`);
    records.push({
      name: packageName,
      version: formula.versions?.stable,
      license: license || "not-declared",
      noticeFiles: noticeFiles.map((file) => path.relative(formulaPrefix, realpathSync(file)).split(path.sep).join("/")),
    });
  }
  writeFileSync(path.join(noticesDir, "homebrew-formula-licenses.json"), `${JSON.stringify(records, null, 2)}\n`);
}

function writeWindowsNotices() {
  const root = process.env.VCPKG_ROOT || process.env.VCPKG_INSTALLATION_ROOT;
  const triplet = process.env.VCPKGRS_TRIPLET || process.env.VCPKG_TRIPLET || process.env.VCPKG_DEFAULT_TRIPLET || "x64-windows-static-md";
  const noticesDir = path.join(runtimeDir, "notices/native/windows");
  writeVcpkgNotices(root, triplet, noticesDir);
}

function collectRuntimeFiles() {
  return walkFiles(runtimeDir)
    .filter((file) => path.basename(file) !== ".gitkeep" && path.basename(file) !== "runtime-manifest.json")
    .map((file) => {
      const bytes = readFileSync(file);
      return {
        path: path.relative(runtimeDir, file).split(path.sep).join("/"),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function combineLicenses() {
  const noticesDir = path.join(runtimeDir, "notices");
  const licenseFiles = walkFiles(noticesDir)
    .filter((file) => {
      const relative = path.relative(noticesDir, file).split(path.sep).join("/");
      return (relative.startsWith("pdfium/")
        || /(?:license|copying|notice|\.copyright$)/i.test(path.basename(file))
        || path.basename(file).startsWith("SPDX-"))
        && path.basename(file) !== "LICENSES.txt";
    })
    .sort();
  const sections = [
    "GlyphMend Desktop and bundled runtime license notices",
    "======================================================",
    "",
  ];
  for (const file of licenseFiles) {
    sections.push(`--- ${path.relative(noticesDir, file).split(path.sep).join("/")} ---`, readFileSync(file, "utf8"), "");
  }
  writeFileSync(path.join(noticesDir, "LICENSES.txt"), sections.join("\n"));
}

function writeManifest(sourceManifest, files, nativeLibraries, nativeSources) {
  const manifest = {
    ...sourceManifest,
    pdfium: {
      ...sourceManifest.pdfium,
      bundledFileSha256: sha256(path.join(runtimeDir, "pdfium", sourceManifest.pdfium.file)),
    },
    runtimeLibraries: nativeLibraries,
    runtimeLibrarySources: nativeSources,
    ...(target.includes("apple-darwin") ? { macOS: {
      minimumSystemVersion: process.env.GLYPHMEND_MACOS_MINIMUM_SYSTEM_VERSION
        || JSON.parse(readFileSync(path.join(scriptDir, "..", "tauri.conf.json"), "utf8")).bundle.macOS.minimumSystemVersion,
    } } : {}),
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
  writeFileSync(path.join(runtimeDir, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
const target = process.env.TARGET || sourceManifest.target;
if (target !== sourceManifest.target) {
  throw new Error(
    `Prepared runtime target ${sourceManifest.target} does not match build target ${target}. `
    + "Use a separate checkout for each OS/architecture target. If this checkout is dedicated to the requested target, "
    + "recover from the repository root with `npm run desktop:clean:runtime` followed by `npm run desktop:prepare`.",
  );
}
const pdfiumPath = path.join(runtimeDir, "pdfium", sourceManifest.pdfium.file);
if (!existsSync(pdfiumPath)) {
  throw new Error(
    `Prepared PDFium library is missing: ${pdfiumPath}. `
    + "If this checkout is dedicated to the current target, recover from the repository root with "
    + "`npm run desktop:clean:runtime` followed by `npm run desktop:prepare`. Use a separate checkout for other targets.",
  );
}
if (!hasVerifiedPdfium(runtimeDir, sourceManifest)) {
  throw new Error("PDFium integrity check failed before runtime relocation. Clean and prepare this target's runtime before rebuilding.");
}
if (!sourceManifest.tessdata?.commits?.fast || !sourceManifest.tessdata?.commits?.best) {
  throw new Error(
    "Prepared OCR model provenance is missing. If this checkout is dedicated to the current target, "
    + "run `npm run desktop:clean:runtime` followed by `npm run desktop:prepare` from the repository root. "
    + "Use a separate checkout for other targets.",
  );
}

const binarySuffix = target.includes("windows") ? ".exe" : "";
const executable = path.resolve(repositoryRoot, "companion/target", target, "release", `companion-tauri${binarySuffix}`);
if (!existsSync(executable)) throw new Error(`Built Tauri executable is missing: ${executable}`);

const nativeLibraries = [];
let nativeSources = {};
if (target.includes("linux")) {
  mkdirSync(runtimeLibDir, { recursive: true });
  const direct = lddPaths(executable).filter((file) => /lib(?:tesseract|lept)[^/]*\.so/.test(path.basename(file)));
  if (!direct.some((file) => /tesseract/i.test(path.basename(file))) || !direct.some((file) => /lept/i.test(path.basename(file)))) {
    throw new Error("Linux Tesseract and Leptonica shared libraries are not linked into the Desktop host.");
  }
  collectLinuxLibraries([...direct, pdfiumPath]);
  nativeLibraries.push(...walkFiles(runtimeLibDir).map((file) => path.relative(runtimeDir, file).split(path.sep).join("/")));
} else if (target.includes("apple-darwin")) {
  nativeSources = await collectMacLibraries(executable);
  nativeLibraries.push(...walkFiles(runtimeLibDir).map((file) => path.relative(runtimeDir, file).split(path.sep).join("/")));
} else {
  writeWindowsNotices();
}

combineLicenses();
writeManifest(sourceManifest, collectRuntimeFiles(), nativeLibraries, nativeSources);
console.log(`Assembled and fingerprinted GlyphMend Desktop runtime resources for ${target}.`);
