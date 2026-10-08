import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getSpdxText } from "../../../../../web-app/scripts/spdx-license-text.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "../../../../..");
const companionRoot = path.join(repositoryRoot, "companion");
const noticesDir = path.resolve(scriptDir, "../resources/runtime/notices/rust");
const sourceManifestPath = path.resolve(scriptDir, "../resources/runtime/runtime-source-manifest.json");
const target = process.env.TARGET || (fs.existsSync(sourceManifestPath)
  ? JSON.parse(fs.readFileSync(sourceManifestPath, "utf8")).target : undefined);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: companionRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function licenseIds(expression) {
  const withoutExceptions = String(expression).replace(/\bWITH\s+[A-Za-z0-9][A-Za-z0-9.+-]*/gi, "");
  return [...new Set(withoutExceptions.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) || [])]
    .filter((id) => !["AND", "OR", "WITH"].includes(id.toUpperCase()) && !id.startsWith("LicenseRef-"));
}

function exceptionIds(expression) {
  const result = [];
  for (const match of String(expression).matchAll(/\bWITH\s+([A-Za-z0-9][A-Za-z0-9.+-]*)/g)) {
    result.push(match[1]);
  }
  return [...new Set(result)];
}

function findLicenseFiles(directory, declaredFile) {
  const files = [];
  if (declaredFile) {
    const explicit = path.resolve(directory, declaredFile);
    if (fs.existsSync(explicit) && fs.statSync(explicit).isFile()) files.push(explicit);
  }
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:license|licence|copying|notice|copyright)(?:[._-].*)?$/i.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
  return [...new Set(files)];
}

function safeName(value) {
  return value.replaceAll("/", "__").replaceAll("@", "").replaceAll(" ", "_");
}

if (!target) throw new Error("TARGET must be set to the Rust release target triple.");
const metadata = JSON.parse(run("cargo", ["metadata", "--locked", "--format-version", "1", "--filter-platform", target]));
const packages = new Map(metadata.packages.map((item) => [item.id, item]));
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const root = metadata.packages.find((item) => item.name === "companion-tauri");
if (!root) throw new Error("cargo metadata did not include the companion-tauri package.");

const included = new Set();
const queue = [root.id];
while (queue.length) {
  const id = queue.pop();
  if (included.has(id)) continue;
  included.add(id);
  const node = nodes.get(id);
  for (const dependency of node?.deps || []) {
    const kinds = dependency.dep_kinds || [];
    const isRuntimeDependency = !kinds.length || kinds.some((item) => item.kind === null);
    if (isRuntimeDependency) queue.push(dependency.pkg);
  }
}

fs.rmSync(noticesDir, { recursive: true, force: true });
fs.mkdirSync(noticesDir, { recursive: true });
const rows = [];
const failures = [];
for (const id of [...included].filter((item) => item !== root.id).sort()) {
  const packageInfo = packages.get(id);
  if (!packageInfo || packageInfo.source === null) continue;
  const manifestPath = packageInfo.manifest_path;
  const packageRoot = path.dirname(manifestPath);
  const noticePath = path.join(noticesDir, `${safeName(packageInfo.name)}-${packageInfo.version}`);
  fs.mkdirSync(noticePath, { recursive: true });
  const files = findLicenseFiles(packageRoot, packageInfo.license_file);
  if (files.length) {
    for (const file of files) fs.copyFileSync(file, path.join(noticePath, path.basename(file)));
  } else {
    const ids = licenseIds(packageInfo.license || "");
    if (!ids.length) {
      failures.push(`${packageInfo.name}@${packageInfo.version} has no license file or SPDX license expression`);
    } else {
      for (const licenseId of ids) {
        try {
          fs.writeFileSync(path.join(noticePath, `SPDX-${licenseId}.txt`), await getSpdxText(licenseId));
        } catch (error) {
          failures.push(`${packageInfo.name}@${packageInfo.version}: ${error.message}`);
        }
      }
    }
  }
  for (const exceptionId of exceptionIds(packageInfo.license || "")) {
    try {
      const text = await getSpdxText(exceptionId);
      fs.writeFileSync(path.join(noticePath, `SPDX-exception-${exceptionId}.txt`), text);
    } catch (error) {
      failures.push(`${packageInfo.name}@${packageInfo.version}: ${error.message}`);
    }
  }
  fs.writeFileSync(
    path.join(noticePath, "PACKAGE.txt"),
    `${packageInfo.name}@${packageInfo.version}\nLicense: ${packageInfo.license || "UNSPECIFIED"}\nRepository: ${packageInfo.repository || ""}\nSource: ${packageInfo.source || ""}\n`,
  );
  rows.push({ name: packageInfo.name, version: packageInfo.version, license: packageInfo.license, noticeDirectory: path.basename(noticePath) });
}

const report = [
  "# Rust runtime dependency notices",
  "",
  `This inventory was collected for target ${target} from the locked normal dependency graph of companion-tauri. Each directory contains the source crate's license file(s) or SPDX text and exact crate metadata.`,
  "",
  "| Crate | Version | License | Notice files |",
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.license || "unspecified"} | ${row.noticeDirectory}/ |`),
  "",
].join("\n");
fs.writeFileSync(path.join(noticesDir, "RUST_DEPENDENCY_NOTICES.md"), report);
fs.writeFileSync(path.join(noticesDir, "RUST_DEPENDENCIES.json"), `${JSON.stringify(rows, null, 2)}\n`);

if (failures.length) {
  console.error("Could not create complete Rust runtime notices:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Collected license notices for ${rows.length} Rust runtime crates on ${target}.`);
}
