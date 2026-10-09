import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z",
  "web-app/scripts", "companion/apps/companion-tauri/src-tauri/scripts", "companion/apps/companion-tauri/web"],
{ cwd: root, encoding: "utf8" }).split("\0").filter((file) => file.endsWith(".mjs") || file.endsWith(".js"));
for (const file of [...new Set(files)]) {
  execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "inherit" });
}
const smokePdf = readFileSync(path.join(root, "companion/apps/companion-tauri/src-tauri/tests/ocr-smoke.pdf"));
if (!smokePdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
  throw new Error("The compile-time OCR smoke fixture is missing or is not a PDF.");
}
console.log(`Syntax checked ${new Set(files).size} frontend-tool and desktop-packaging scripts without executing tests.`);
