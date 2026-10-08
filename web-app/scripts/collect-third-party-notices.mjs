import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSpdxText as getSpdxLicenseText } from "./spdx-license-text.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(webRoot, "..");
const nodeModulesRoot = path.join(repositoryRoot, "node_modules");
const packageFile = JSON.parse(fs.readFileSync(path.join(webRoot, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8"));
const outputDir = path.resolve(process.argv[2] || path.join(webRoot, "../companion/apps/companion-tauri/src-tauri/resources/runtime/notices/browser"));
const packageEntries = lock.packages || {};
const included = new Map();
const visiting = new Set();
const traversalFailures = [];

function installedPackageRoot(lockKey) {
  return path.join(nodeModulesRoot, lockKey.replace(/^node_modules\//, ""));
}

function resolvePackage(ownerKey, packageName) {
  if (!ownerKey) {
    const root = `node_modules/${packageName}`;
    return packageEntries[root] ? root : null;
  }
  let prefix = ownerKey;
  while (prefix) {
    const candidate = `${prefix}/node_modules/${packageName}`;
    if (packageEntries[candidate]) return candidate;
    const nestedIndex = prefix.lastIndexOf("/node_modules/");
    if (nestedIndex >= 0) prefix = prefix.slice(0, nestedIndex);
    else if (prefix.startsWith("node_modules/")) break;
    else prefix = "";
  }
  const root = `node_modules/${packageName}`;
  return packageEntries[root] ? root : null;
}

function visit(ownerKey, packageName) {
  const key = resolvePackage(ownerKey, packageName);
  if (!key || included.has(key) || visiting.has(key)) return;
  const entry = packageEntries[key];
  if (!entry || entry.dev) return;
  const packageJsonPath = path.join(installedPackageRoot(key), "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    if (!entry.optional) traversalFailures.push(`Required installed package metadata is missing for ${key}`);
    return;
  }
  visiting.add(key);
  included.set(key, entry);
  for (const dependency of Object.keys(entry.dependencies || {})) visit(key, dependency);
  for (const dependency of Object.keys(entry.optionalDependencies || {})) visit(key, dependency);
  visiting.delete(key);
}

for (const packageName of Object.keys(packageFile.dependencies || {})) visit(null, packageName);

function findLicenseFiles(packageRoot) {
  if (!fs.existsSync(packageRoot)) return [];
  return fs.readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(?:license|licence|copying|notice|copyright)(?:[._-].*)?$/i.test(entry.name))
    .map((entry) => path.join(packageRoot, entry.name));
}

function safePackageName(name, version) {
  return `${name.replaceAll("/", "__").replaceAll("@", "")}-${version}`;
}

function licenseIds(expression) {
  const withoutExceptions = String(expression).replace(/\bWITH\s+[A-Za-z0-9][A-Za-z0-9.-]*/gi, "");
  return [...new Set(withoutExceptions.match(/[A-Za-z0-9][A-Za-z0-9.-]*/g) || [])]
    .filter((id) => !["AND", "OR", "WITH"].includes(id.toUpperCase()) && !id.startsWith("LicenseRef-"));
}

fs.mkdirSync(outputDir, { recursive: true });
const rows = [];
const failures = [...traversalFailures];
for (const [key, entry] of [...included.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const packageRoot = installedPackageRoot(key);
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    failures.push(`Installed package metadata is missing for ${key}`);
    continue;
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const version = entry.version || packageJson.version || "unknown";
  const rawLicense = entry.license || packageJson.license || "UNSPECIFIED";
  const license = typeof rawLicense === "string"
    ? rawLicense
    : typeof rawLicense?.type === "string"
      ? rawLicense.type
      : "UNSPECIFIED";
  if (license === "UNSPECIFIED") failures.push(`License metadata is missing for ${key}@${version}`);
  const licenseFiles = findLicenseFiles(packageRoot);
  const packageNoticeDir = path.join(outputDir, safePackageName(packageJson.name || key, version));
  fs.mkdirSync(packageNoticeDir, { recursive: true });
  if (licenseFiles.length) {
    for (const file of licenseFiles) fs.copyFileSync(file, path.join(packageNoticeDir, path.basename(file)));
  } else {
    const ids = licenseIds(license);
    if (!ids.length) failures.push(`No full license file or SPDX identifier is available for ${key}@${version}`);
    for (const id of ids) {
      try {
        const text = await getSpdxLicenseText(id);
        fs.writeFileSync(path.join(packageNoticeDir, `SPDX-${id}.txt`), text);
      } catch (error) {
        failures.push(`${key}@${version}: ${error.message}`);
      }
    }
  }
  const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url || "";
  const author = typeof packageJson.author === "string" ? packageJson.author : packageJson.author?.name || "";
  fs.writeFileSync(
    path.join(packageNoticeDir, "PACKAGE.txt"),
    `${packageJson.name || key}@${version}\nLicense: ${license}\nAuthor: ${author}\nRepository: ${repository}\n`,
  );
  rows.push({ name: packageJson.name || key, version, license, noticeDirectory: path.basename(packageNoticeDir) });
}

const report = [
  "# Browser runtime dependency notices",
  "",
  "This inventory covers the locked production dependency graph included in the bundled GlyphMend web interface. Each package directory contains its package license file(s) and exact package/version metadata.",
  "",
  "| Package | Version | License | Notice files |",
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.license} | ${row.noticeDirectory}/ |`),
  "",
].join("\n");
fs.writeFileSync(path.join(outputDir, "BROWSER_DEPENDENCY_NOTICES.md"), report);
fs.writeFileSync(path.join(outputDir, "BROWSER_DEPENDENCIES.json"), `${JSON.stringify(rows, null, 2)}\n`);

if (failures.length) {
  console.error("Could not create complete browser runtime notices:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Collected license texts for ${rows.length} locked browser runtime packages into ${outputDir}.`);
}
