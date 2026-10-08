# Third-party notices

The integrated GlyphMend Desktop package includes or links to the following
upstream components. Its runtime notices carry the license texts for the exact
native runtime and model artifacts, and the release includes an SPDX SBOM with
resolved package versions. The same engine is used in headless Companion mode;
there is no separate Companion release archive.

| Component | License/source |
| --- | --- |
| GlyphMend Rust dependencies | Licenses recorded in `Cargo.lock`; checked by `cargo deny` |
| PDFium | BSD-3-Clause; [upstream project](https://pdfium.googlesource.com/pdfium/) and [binary distribution](https://github.com/bblanchon/pdfium-binaries) |
| Tesseract OCR | Apache-2.0; [upstream project](https://github.com/tesseract-ocr/tesseract) |
| Leptonica | BSD-2-Clause; [upstream project](https://github.com/DanBloomberg/leptonica) |
| `tessdata_fast` language models | See the upstream [`tessdata_fast` license](https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE) |
| `tessdata_best` language models | See the upstream [`tessdata_best` license](https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE) |

The packaged notices directory includes the upstream notices retrieved for
the exact runtime and model artifacts in that release. Preserve those files
when redistributing the GlyphMend Desktop installer.
