# CI and Companion releases

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

The `web-app.yml` workflow runs the browser checks and production build for pull requests.

## Rust checks

From `companion/`:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Companion CI verifies the shared contract and browser client against the local API. The full PDF extraction check, which exercises both OCR models, is not run in CI or for each release package. OCR development builds require the Tesseract and Leptonica development libraries; release jobs install the platform toolchain and package the runtime libraries.

## Manual Companion release

Run `Companion Release` from GitHub Actions on the default branch and provide a SemVer version such as `0.1.0-beta.1`. The workflow builds six unsigned portable packages: Windows x64, macOS x64/arm64, and Linux x64/arm64. Each archive includes the executable, PDFium/Tesseract runtime files, both English OCR models, third-party notices, a runtime manifest, and internal checksums. The workflow also uploads release archives and checksum files as GitHub Actions artifacts, creates an SPDX SBOM, produces provenance attestations, and publishes GitHub Release assets.

All packages are explicitly unsigned; signing certificates, Apple notarization, and signing secrets are not required. Windows SmartScreen or macOS Gatekeeper may warn or block launch. The release page and each archive disclose this and provide checksums for verification. Versions containing a prerelease identifier are published as prereleases. Stable promotion remains gated on repeatable benchmark improvements and a browser regression review.

The workflow only accepts dispatches from the repository's default branch. PDFium archives are checked against pinned upstream SHA-256 digests, and OCR models are fetched from pinned Tesseract commits recorded in each package manifest. No environment secrets or paid signing service are needed for this unsigned workflow.

No historical Python release or tag is rewritten by the current workflows.
