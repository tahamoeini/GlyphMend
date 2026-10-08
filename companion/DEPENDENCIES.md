# GlyphMend engine dependency record

This record describes the Rust engine and the target-specific runtime bundled inside the integrated GlyphMend Desktop app. The same engine can be exposed to the browser by running the app in headless Companion mode. GlyphMend does not publish separate Companion runtime archives.

| Component | Source / pinned line | Purpose |
| --- | --- | --- |
| Rust toolchain | 1.97.0 (`rust-toolchain.toml`) | Shared service, providers, loopback bridge, and Tauri host |
| `pdfium-render` | 0.9.4, `thread_safe` feature | PDF text, page geometry, page objects, and rendering |
| PDFium runtime | Chromium release `8066` | Native PDF engine; target library and archive hash are pinned in runtime preparation |
| `leptess` / Tesseract | leptess 0.14.0; host package used to build the app | Multilingual OCR |
| Leptonica | Host package used to build the app | Image input for Tesseract |
| Fast models | `tesseract-ocr/tessdata_fast`: `eng`, `rus`, `fas`, `chi_sim` | Default Fast OCR option |
| Best models | `tesseract-ocr/tessdata_best`: `eng`, `rus`, `fas`, `chi_sim` | Optional High Accuracy OCR option |
| Loopback service | Axum 0.8.9 / Tokio 1.53.1 | User-paired browser connection in headless mode |
| Desktop transport | Tauri IPC | Bounded in-process calls from the integrated interface |

`cargo deny check` applies the advisory and license policy in `companion/deny.toml`. Desktop packaging records resolved native runtime versions and hashes in its manifests and includes upstream notices, an SPDX SBOM, and checksums. Cargo metadata alone does not describe platform-native libraries or model files.

Runtime resource pins and preparation instructions are maintained in `companion/apps/companion-tauri/src-tauri/scripts/prepare-runtime.mjs`. See the Tesseract project's [data-file guide](https://github.com/tesseract-ocr/tessdoc/blob/main/Data-Files.md) for model tradeoffs.
