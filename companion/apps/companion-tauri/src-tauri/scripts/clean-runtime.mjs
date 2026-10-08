import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(scriptDir, "../resources/runtime");
const generatedEntries = [
  "lib",
  "notices",
  "pdfium",
  "runtime-manifest.json",
  "runtime-source-manifest.json",
  "tessdata",
];

if (!existsSync(runtimeDir)) {
  console.log("No prepared Desktop runtime resources to clean.");
} else {
  const generatedEntrySet = new Set(generatedEntries);
  const unexpected = readdirSync(runtimeDir).filter((name) => name !== ".gitkeep" && !generatedEntrySet.has(name));

  if (unexpected.length) {
    throw new Error(`Refusing to remove unrecognized runtime entries: ${unexpected.join(", ")}`);
  }

  for (const name of generatedEntries) {
    rmSync(path.join(runtimeDir, name), { recursive: true, force: true });
  }
  console.log("Removed prepared Desktop runtime resources; .gitkeep was preserved.");
}
