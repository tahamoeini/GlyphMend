# Companion dependency record

The Companion uses native system libraries at runtime. Release archives contain
the platform PDFium library, Tesseract and Leptonica runtime libraries, and both
English OCR model sets. The release workflow records resolved versions and
SHA-256 digests in each archive.

| Component | Source / pinned line | Purpose |
| --- | --- | --- |
| Rust toolchain | 1.97.0 (`rust-toolchain.toml`) | Companion host and extractor |
| `pdfium-render` | 0.9.4, `thread_safe` feature | PDF text, page geometry, objects, and rendering |
| PDFium runtime | Chromium release `8066` | Native PDF engine, packaged beside the executable |
| `leptess` / Tesseract | leptess 0.14.0; platform Tesseract package resolved at release | English OCR through Tesseract |
| Leptonica | Platform package resolved at release | Image input for Tesseract |
| English fast model | `tesseract-ocr/tessdata_fast`, `eng.traineddata` | Default Fast OCR choice |
| English best model | `tesseract-ocr/tessdata_best`, `eng.traineddata` | Optional High Accuracy OCR choice |
| REST service | Axum 0.8.9 / Tokio 1.53.1 | Authenticated loopback API |

`cargo deny check` applies the repository's advisory and license policy to the
Rust dependency graph. Release archives also contain third-party notices, an
SPDX SBOM, a runtime manifest, and checksums. The SBOM and runtime manifest
capture platform-native libraries and model digests that Cargo metadata alone
does not describe.

The English model sets have different speed and accuracy profiles; see the
[Tesseract data-file documentation](https://github.com/tesseract-ocr/tessdoc/blob/main/Data-Files.md).
