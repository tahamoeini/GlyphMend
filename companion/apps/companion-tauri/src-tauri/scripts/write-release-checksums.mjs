import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [directory, outputName] = process.argv.slice(2);
if (!directory || !/^SHA256SUMS-[a-z0-9.-]+\.txt$/.test(outputName || "")) {
  throw new Error("Usage: node write-release-checksums.mjs <release-directory> SHA256SUMS-<platform>.txt");
}
const files = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.startsWith("SHA256SUMS"))
  .map((entry) => entry.name).sort();
if (!files.length) throw new Error(`No release assets to checksum in ${directory}`);
const lines = files.map((name) => {
  const digest = createHash("sha256").update(readFileSync(path.join(directory, name))).digest("hex");
  return `${digest}  ${name}`;
});
writeFileSync(path.join(directory, outputName), `${lines.join("\n")}\n`);
console.log(`Checksummed ${files.length} release assets in ${outputName}.`);
