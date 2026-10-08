# GlyphMend Companion workspace

This directory contains the Rust workspace for the optional standalone Companion and the GlyphMend Desktop host. The standalone Companion exposes a user-paired loopback API. Desktop reuses the Rust service and extraction provider through Tauri IPC; it does not use that API.

## Prerequisites

- Rust 1.97.0, pinned in rust-toolchain.toml.
- Native Tesseract and Leptonica development libraries for the target OS.
- Node.js 22 for benchmark and Desktop packaging scripts.
- PDFium and the selected Tesseract traineddata at runtime when running the standalone CLI.
- Tauri/WebView development prerequisites for Desktop; see the [Desktop guide](../docs/desktop.md).

The [dependency record](DEPENDENCIES.md) describes the runtime components. Desktop runtime preparation downloads the pinned PDFium and model files; see [runtime packaging](../docs/desktop.md#native-resources-and-notices).

## Build and start the standalone CLI

From this directory:

~~~bash
cargo build --locked -p companion-cli
cargo run --locked -p companion-cli -- --no-open
~~~

The CLI prints its loopback endpoint and one-time pairing URL. Open that URL in the supported GlyphMend web origin, then choose Companion for a job. The --no-open option suppresses automatic browser opening; Ctrl+C stops the Companion. The optional --web-origin argument selects an exact web origin for a matching deployment.

When OCR is enabled, GLYPHMEND_TESSDATA_DIR can point to a Tesseract data root. The runtime must contain the language models selected in the browser. The PDFium library must also be available to the process. Downloaded release archives include launch scripts and a documented runtime layout.

## Workspace checks

Use the commands in [CI/CD and releases](../docs/ci.md) for Rust formatting, Clippy, tests, dependency policy, and browser-to-Companion integration. The Tauri host has separate native checks and prerequisites.

## Related documentation

- [Architecture](../docs/architecture.md)
- [Companion API and behavior](../docs/companion-engine.md)
- [Desktop](../docs/desktop.md)
- [Dependencies](DEPENDENCIES.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Benchmark corpus and runner](benchmarks/README.md)
