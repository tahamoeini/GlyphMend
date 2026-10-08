# Distribution implementation plan and audit decisions

This is the repository-side record for the browser, Browser + Companion, and GlyphMend Desktop distribution work. The original implementation brief remains the source plan; this page records its audit decisions, code extension points, and release gates.

## Audit findings and decisions

- `web-app/` is the complete local-first Browser/PWA. It owns the browser extraction engine, IndexedDB checkpoints, workspace import/export, and Markdown/DOCX exporters.
- `companion/crates/companion-contract`, `companion-core`, `companion-service`, and `companion-extractor` contain the versioned protocol/IR contract, job lifecycle, and PDFium/Tesseract provider. The standalone host remains in `companion-cli` plus the loopback bridge.
- `companion/apps/companion-tauri/src-tauri` is the Desktop host. Its commands delegate to the shared job service; Desktop uses the Tauri resource resolver and does not initialize the loopback bridge.
- Desktop and browser have separate Vite entry points. `web-app/src/browser-entry.js` registers the PWA service worker; `desktop-entry.js` registers only Tauri IPC. `verify-mupdf-assets.mjs` rejects Tauri API references in the browser build; `verify-desktop-build.mjs` rejects loopback transport in the Desktop build.
- Normal CLI and Tauri release binaries register `PdfiumTesseractProvider`. The diagnostic mock remains for tests and is not exposed by these hosts.
- The standalone Companion resolves PDFium beside its executable/system library and OCR data from its documented runtime layout. Desktop instead resolves `runtime/pdfium` and `runtime/tessdata` relative to Tauri's resource directory.
- The existing companion release workflow pins PDFium Chromium 8066 and model commits `87416418657359cb625c412a48b6e1d6d41c29bd` (Fast) and `e12c65a915945e4c28e237a9b52bc4a8f39a0cec` (Best). Desktop keeps four languages and both model sets.

## Platform choices

- **Windows x64:** NSIS setup; Tauri's WebView2 bootstrapper; statically link the vcpkg `x64-windows-static-md` OCR libraries and load PDFium from bundled resources. The offline WebView2 installer is not bundled, so first-time WebView2 installation may need internet.
- **Linux x64:** Ubuntu 24.04 `.deb` primary artifact; declare WebKitGTK 4.1/GTK dependencies and bundle the target OCR runtime libraries with resource-relative loader paths. Do not claim older Linux support until a native clean-machine test proves it.
- **macOS Intel and Apple silicon:** separate `.dmg` builds on macOS 15 runners; configured deployment minimum is macOS 12.0. Validate this minimum with installed-package testing. Stable direct distribution needs signing and notarization.
- **OCR data:** ship English, Russian, Persian, and Simplified Chinese Fast and Best sets in every Desktop package. Do not silently download or remove language models to reduce size.
- **Service worker:** omit it from Desktop because assets ship with the app. Packaged WebView launch, worker/WASM initialization, offline reload, and IndexedDB restart/upgrade remain release gates.

## Measured local asset sizes

Measured on 2026-10-08 after the local Browser and Desktop production builds, with the prepared Windows x64 runtime inputs:

| Input | Bytes | MiB |
| --- | ---: | ---: |
| Browser `web-app/dist` including its PWA worker | 73,016,079 | 69.63 |
| Desktop frontend assets without a service worker | 72,979,799 | 69.60 |
| Windows x64 PDFium, eight OCR models, and prepared project/upstream/browser/Rust notices | 68,373,163 | 65.21 |
| Desktop frontend plus prepared runtime inputs | 141,352,962 | 134.80 |

The pinned PDFium archive hash and all eight prepared OCR model hashes were verified locally. These are uncompressed input sizes; they exclude the Tauri executable, Windows static OCR libraries and their vcpkg notices, installer overhead, and native libraries for other operating systems. Final installer sizes are a native release-workflow gate and are not yet available.

## Implemented release engineering

- Browser and Tauri adapters are selected at Vite build time.
- The Rust provider accepts explicit Desktop resource paths and fails closed if bundled PDFium is missing.
- IPC input is split into bounded parts and reassembled with per-job limits; existing shared job cancellation, progress, result retrieval, acknowledgement, and IR validation remain in the Rust service.
- Resource preparation pins PDFium and OCR models. Runtime assembly inventories platform libraries and license files, writes per-file SHA-256 values, and fails closed when required resources are absent.
- Browser checks run in `web-app.yml`. Desktop CI builds on four native runner/architecture combinations. All workflows are started manually; the Desktop release workflow creates its tag and unsigned draft prerelease only after a user dispatches it and all package jobs succeed.

## Remaining release gates

1. Run the new native CI and release jobs on all four targets; verify the generated Tauri configuration and relocated native dependencies on their actual operating systems.
2. Install each native artifact from a clean user profile; test paths with spaces, no-network launch after installation, PDFium text extraction, scanned-page OCR, and missing-runtime errors.
3. Verify WebView workers, WASM, browser extraction fallback, IndexedDB checkpoints and logs, offline reload, restart, and upgrade in the installed app.
4. Record each full installer size and verify the final package contents, WebView/system prerequisites, notices, checksums, and per-platform SBOM.
5. Configure and test Windows signing and macOS signing/notarization before stable public release.

No release tag or public artifact has been created by this implementation. No speed or accuracy advantage is claimed for the Companion or Desktop engine.
