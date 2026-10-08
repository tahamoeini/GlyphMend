# CI and releases

## Browser checks

From `web-app/`:

```bash
npm ci
npm run license:check
npm run lint
npm run typecheck
npm test
npm run build
```

`.github/workflows/web-app.yml` runs these checks and verifies that browser output contains no Tauri API dependency. The Browser/PWA remains the standalone default.

Every repository GitHub Actions workflow is started with `workflow_dispatch`. Pushes, pull requests, and tag creation do not start CI/CD automatically; choose a workflow under the Actions tab when you want to run it.

## Rust Companion checks

From `companion/`:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The Rust workspace's default members exclude the experimental Tauri host; run the Desktop workflow or its target-specific checks to validate that crate. OCR development builds require Tesseract and Leptonica development libraries.

## Desktop CI and native runtime smoke tests

`.github/workflows/companion-tauri.yml` runs manually for Windows x64, Ubuntu 24.04 x64, macOS Intel, and Apple silicon. It builds both web adapters, checks the Tauri IPC adapter, runs Rust tests, and builds the host without packaging. The Tauri IPC assembly enforces a 64 KiB part limit, 1 MiB input limit, and a cap on incomplete buffered chunks.

The Desktop prerelease workflow runs only when manually dispatched from the default branch with a version. It builds on the same native hosts with the prepared runtime and smoke-tests digital PDF text plus an image-only PDF page through the shared Rust job service and OCR provider. The extraction smoke test resolves the bundled runtime from a temporary path containing spaces; the Windows installer inspection also uses an install path containing spaces. It checks that the pinned PDFium library, OCR models, notices, and runtime manifest are present, and generates a native runtime SBOM and checksums.

For a local frontend/IPC check, from `web-app/` and the Tauri web folder:

```bash
cd web-app
npm ci
npm run build
npm run build:desktop

cd ../companion/apps/companion-tauri/web
npm ci
node --test src/tauri-adapter.test.mjs
```

For the app host, install native Tauri and Tesseract/Leptonica prerequisites for the current OS, prepare resources, then run `npm run tauri -- dev`. The [Desktop guide](desktop.md) documents the target layout and runtime preparation.

## GlyphMend Desktop prerelease

`.github/workflows/glyphmend-desktop-release.yml` is manually dispatched from the default branch with a prerelease version of the form `X.Y.Z-beta.N`. It builds four distinct installers: Windows x64 NSIS `.exe`, Ubuntu 24.04 x64 `.deb`, macOS Intel `.dmg`, and macOS Apple silicon `.dmg`. It validates runtime resources and notices, fingerprints every resource file, and adds SHA-256 checksums and an SPDX SBOM.

After every native package job succeeds, the manually started workflow creates a `glyphmend-vX.Y.Z-beta.N` tag and an unsigned **draft prerelease**. Drafts are not public until published. Do not dispatch the release workflow unless creating that tag and draft release is intended. Stable direct distribution requires configured Windows signing and macOS signing/notarization.

The standard Windows installer uses a WebView2 bootstrapper and may need network access if WebView2 is missing. The optional WebView2 offline installer adds about 127 MB and is not included. Desktop package sizes and minimum OS support still need confirmation from native release artifacts and clean-machine validation.

## Standalone Companion manual release

`.github/workflows/companion-release.yml` is the separate unsigned portable CLI release. It builds Windows x64/ARM64, macOS x64/ARM64, and Linux x64/ARM64 packages. Each package contains PDFium, Tesseract/Leptonica runtime files, English/Russian/Persian/Simplified Chinese Fast and Best models, notices, checksums, an SPDX SBOM, and provenance attestations.

This workflow is dispatched manually from the default branch and currently publishes its Companion release when run. It is distinct from the Desktop draft-only release workflow. The Companion package workflow pins PDFium Chromium 8066 and the OCR model commits, and checks the PDFium archive hash before packaging.

## Acceptance still pending

Native CI and release artifacts must pass their real runners before we report supported packages and sizes. A packaged WebView test remains required for launch, WebAssembly/worker startup, offline reload, IndexedDB checkpoints/logs, restart, and upgrade behavior. The unsigned launch experience is not equivalent to a signed/notarized stable release.
