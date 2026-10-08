# GlyphMend Rust workspace

This workspace contains the shared Rust extraction service, loopback bridge, source CLI, and Tauri Desktop host. The installed GlyphMend app is the single local-engine distribution:
- Run it normally for the Desktop interface with the bundled engine over Tauri IPC.
- Start it with `--headless-companion` to expose the local engine for browser pairing.

The browser application also runs by itself without a local engine. There is no separate Companion installer, and the source CLI is not a standalone PDF-to-Markdown product.

## Development prerequisites

- Rust toolchain pinned in `rust-toolchain.toml`.
- Native Tesseract and Leptonica development libraries for the host when building the Rust service.
- Node.js 22 for the root npm workspace, Desktop packaging, and benchmark tools.
- Tauri/WebView prerequisites for the Desktop app; see the [Desktop guide](../docs/desktop.md).
- PDFium and selected Tesseract data when running the source CLI directly. The root Desktop runtime preparation command fetches pinned resources for the current OS.

The [dependency record](DEPENDENCIES.md) documents the engine and packaged runtime. Use separate checkouts for different operating systems, particularly Windows and WSL/Linux, because generated runtime data and optional native npm bindings are platform-specific. Keep a WSL checkout in the Linux filesystem (for example `~/src/glyph-mend`), not on `/mnt/<drive>`; see the [Desktop guide](../docs/desktop.md).

The [Tauri host guide](apps/companion-tauri/web/README.md) describes the integrated Desktop interface, headless Companion launch, and shared frontend boundary.

## Start the integrated app in headless mode

From the repository root, prepare the shared workspace and launch the Tauri app without its visible window:

```bash
npm ci --include=optional
npm run dev:companion
```

This development command prepares the current host's runtime, starts the same Tauri app in headless Companion mode, starts the desktop-mode Vite server, and opens a one-time pairing URL at `http://127.0.0.1:1420`. Pair from that local browser interface and select the local engine for a job. The loopback bridge accepts only the configured web origin and user-authorized jobs. See the [API and security guide](../docs/companion-engine.md).

To develop the normal installed-interface mode instead, run `npm run dev:desktop` from the repository root.

## Source CLI

The source-only CLI remains useful for local engine diagnostics and the paired benchmark. It is not included as a separate user download. From this directory, build and run it with:

```bash
cargo build --locked -p companion-cli
cargo run --locked -p companion-cli -- --no-open
```

The CLI prints its loopback endpoint and pairing URL. `--no-open` suppresses automatic browser opening; Ctrl+C stops it. `--web-origin` can select the exact allowed web origin for a matching deployment.

For direct CLI runs, PDFium must be beside the executable or discoverable as a system library. Set `GLYPHMEND_TESSDATA_DIR` to a root containing `fast/` and `best/` model folders with the language files requested by the browser. The integrated app instead prepares and packages pinned runtime resources.

## Validation and related documentation

The repository's only GitHub Actions workflow runs only when manually dispatched. Its fast quick mode is test-free; browser, Rust, Tauri, and pairing integration tests are available through full validation, with benchmarks and release packaging as separate manual modes. See [CI and releases](../docs/ci.md).

- [Architecture](../docs/architecture.md)
- [Companion API and behavior](../docs/companion-engine.md)
- [Desktop modes and development](../docs/desktop.md)
- [Runtime dependency record](DEPENDENCIES.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Benchmark corpus and runner](benchmarks/README.md)
