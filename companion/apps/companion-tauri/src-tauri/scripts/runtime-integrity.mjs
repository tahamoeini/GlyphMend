import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// Relocation changes PDFium's bytes. Keep its upstream digest immutable and
// accept a relocated copy only when the assembled manifest records its provenance.
export function hasVerifiedPdfium(runtimeDir, sourceManifest) {
  try {
    const relative = `pdfium/${sourceManifest.pdfium.file}`;
    const actual = sha256(path.join(runtimeDir, relative));
    if (actual === sourceManifest.pdfium.fileSha256) return true;
    const assembled = JSON.parse(readFileSync(path.join(runtimeDir, "runtime-manifest.json"), "utf8"));
    return assembled.target === sourceManifest.target
      && assembled.pdfium?.file === sourceManifest.pdfium.file
      && assembled.pdfium?.archiveSha256 === sourceManifest.pdfium.archiveSha256
      && assembled.pdfium?.fileSha256 === sourceManifest.pdfium.fileSha256
      && assembled.pdfium?.bundledFileSha256 === actual
      && assembled.files?.some((entry) => entry.path === relative && entry.sha256 === actual)
      && assembled.files?.some((entry) => entry.path === "runtime-source-manifest.json"
        && entry.sha256 === sha256(path.join(runtimeDir, entry.path)));
  } catch {
    return false;
  }
}
