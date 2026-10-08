# GlyphMend Companion workspace

This directory contains the Rust workspace for the optional standalone Companion and the GlyphMend Desktop host. The standalone Companion exposes a user-paired loopback API. Desktop reuses the Rust service and extraction provider through Tauri IPC; it does not use that API.

The CLI is headless and does not accept a PDF and write Markdown as a standalone command. Use the browser interface with the CLI for paired processing, or install GlyphMend Desktop to use the shared interface with a bundled local engine. The browser/PWA also works on its own.

## Prerequisites

- Rust 1.97.0, pinned in rust-toolchain.toml.
- Native Tesseract and Leptonica development libraries for the target OS.
- Node.js 22 for benchmark and Desktop packaging scripts.
- PDFium and the selected Tesseract traineddata at runtime when running the standalone CLI.
- Tauri/WebView development prerequisites for Desktop; see the [Desktop guide](../docs/desktop.md).

The [dependency record](DEPENDENCIES.md) describes the runtime components. A source build of the CLI does not download PDFium or OCR data. PDFium must be beside the executable or discoverable as a system library. Set `GLYPHMEND_TESSDATA_DIR` to a directory containing `fast/` and `best/`, each with the traineddata files for the language selected in the browser. The portable release archive includes these resources and launch scripts. Desktop runtime preparation downloads the pinned PDFium and model files for its current target; see [runtime packaging](../docs/desktop.md#native-resources-and-notices).

## Build and start the standalone CLI

From this directory:

~~~bash
cargo build --locked -p companion-cli
cargo run --locked -p companion-cli -- --no-open
~~~

The CLI prints its loopback endpoint and one-time pairing URL. Open that URL in the supported GlyphMend web origin, then choose Companion for a job. The --no-open option suppresses automatic browser opening; Ctrl+C stops the Companion. The optional --web-origin argument selects an exact web origin for a matching deployment.

When OCR is enabled, GLYPHMEND_TESSDATA_DIR can point to a Tesseract data root. The runtime must contain the language models selected in the browser. The PDFium library must also be available to the process. Downloaded release archives include launch scripts and a documented runtime layout.

## Workspace checks

Use the commands in [CI/CD and releases](../docs/ci.md) for Rust formatting, Clippy, dependency policy, and compilation checks. Rust, Tauri, and browser-to-Companion tests remain available in the manually selected full-validation mode. The Tauri host uses the root npm workspace and has host-specific prerequisites.

## Related documentation

- [Architecture](../docs/architecture.md)
- [Companion API and behavior](../docs/companion-engine.md)
- [Desktop](../docs/desktop.md)
- [Dependencies](DEPENDENCIES.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Benchmark corpus and runner](benchmarks/README.md)
