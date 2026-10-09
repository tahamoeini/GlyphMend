import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function readVcpkgNotices(root, triplet) {
  if (!root) throw new Error("VCPKG_ROOT or VCPKG_INSTALLATION_ROOT is required for Windows native notices.");
  if (!/^[a-z0-9-]+$/.test(triplet)) throw new Error(`Invalid vcpkg triplet: ${triplet}`);
  const statusFile = path.join(root, "installed/vcpkg/status");
  const packages = new Map();
  for (const paragraph of readFileSync(statusFile, "utf8").split(/\r?\n\s*\r?\n/)) {
    const fields = Object.fromEntries(paragraph.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
      return match ? [[match[1], match[2]]] : [];
    }));
    if (fields.Architecture !== triplet || fields.Status !== "install ok installed" || fields.Feature) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.Package || "")) {
      throw new Error(`Invalid installed vcpkg package name: ${fields.Package}`);
    }
    if (!fields.Version) throw new Error(`Installed vcpkg package ${fields.Package} has no version metadata.`);
    const copyright = path.join(root, "installed", triplet, "share", fields.Package, "copyright");
    if (!existsSync(copyright) || !statSync(copyright).isFile() || !statSync(copyright).size) {
      throw new Error(`Missing or empty vcpkg copyright notice for installed package ${fields.Package}`);
    }
    packages.set(fields.Package, { package: fields.Package, version: fields.Version,
      portVersion: fields["Port-Version"] || "0", copyright });
  }
  if (!packages.has("tesseract")) throw new Error(`No installed Tesseract package found for ${triplet} in ${statusFile}.`);
  return [...packages.values()].sort((left, right) => left.package.localeCompare(right.package));
}

export function writeVcpkgNotices(root, triplet, noticesDir) {
  const packages = readVcpkgNotices(root, triplet);
  mkdirSync(noticesDir, { recursive: true });
  const records = packages.map(({ copyright, ...record }) => {
    const notice = `${record.package}.copyright`;
    copyFileSync(copyright, path.join(noticesDir, notice));
    return { ...record, notice };
  });
  writeFileSync(path.join(noticesDir, "vcpkg-packages.json"), `${JSON.stringify(records, null, 2)}\n`);
  writeFileSync(path.join(noticesDir, "vcpkg-packages.txt"),
    records.map((record) => `${record.package}:${triplet} ${record.version}#${record.portVersion}`).join("\n") + "\n");
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.VCPKG_ROOT || process.env.VCPKG_INSTALLATION_ROOT;
  const triplet = process.env.VCPKGRS_TRIPLET || process.env.VCPKG_TRIPLET || process.env.VCPKG_DEFAULT_TRIPLET || "x64-windows-static-md";
  const packages = readVcpkgNotices(root, triplet);
  console.log(`Verified native copyright notices for ${packages.length} installed vcpkg packages on ${triplet}.`);
}
