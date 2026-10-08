# CI/CD and releases

## Workflow model

All workflows in .github/workflows/ are started manually with workflow_dispatch. Pushes, pull requests, and tag creation do not trigger CI/CD. Start the relevant workflow from the GitHub Actions tab when you need hosted evidence.

| Workflow | Purpose |
| --- | --- |
| web-app.yml | Browser dependency-license check, production dependency audit, lint, typecheck, tests, production build, and build artifact. |
| companion.yml | Rust formatting, Clippy, tests, CLI build, browser-to-Companion integration, and Rust dependency policy. |
| companion-tauri.yml | Browser and Desktop frontend checks, bounded IPC checks, Rust checks, and native host builds on four runner/architecture combinations. |
| companion-benchmarks.yml | Paired browser/Companion measurements for the six-document benchmark corpus. |
| companion-release.yml | Unsigned standalone Companion packages and GitHub Release publication. |
| glyphmend-desktop-release.yml | Unsigned Desktop installer packages and a tagged draft prerelease. |

A workflow definition is not evidence of a successful run. Review the run for the revision being released and retain its artifacts and logs as appropriate.

## Browser checks

Use Node.js 22 and run from web-app/:

~~~bash
npm ci
npm run license:check
npm run lint
npm run typecheck
npm test
npm run build
npm run preview
~~~

npm run build synchronizes generated branding, checks browser-only build boundaries, verifies the copied MuPDF files, and creates dist/. npm run preview serves that production build locally. Deploying dist/ is separate from this repository's workflow.

## Rust Companion checks

Use the Rust toolchain pinned in companion/rust-toolchain.toml (currently 1.97.0), Tesseract/Leptonica development libraries, and cargo-deny. Run from companion/:

~~~bash
cargo fmt --check -p companion-contract -p companion-core -p companion-extractor -p companion-service -p companion-bridge -p companion-cli
cargo clippy --workspace --exclude companion-tauri -- -D warnings
cargo test --workspace --exclude companion-tauri
cargo build --locked -p companion-cli
cargo deny check
node tests/browser-runtime-e2e.mjs
~~~

These commands match the Companion workflow's native-crate boundary. The Tauri crate has separate OS-specific prerequisites and is checked by the Desktop workflow.

## Desktop development and CI

The Desktop CI workflow builds both web adapters, checks the IPC adapter, runs Rust checks, and builds the native host on Windows x64, Ubuntu 24.04 x64, macOS Intel, and Apple silicon. Each native runner uses Node.js 22 and installs the Tauri CLI with optional platform dependencies. It does not create installers.

For local setup, install the target OS's Tauri/WebView and Tesseract/Leptonica development prerequisites, then follow the [Desktop guide](desktop.md). Its resource-preparation command downloads the pinned PDFium runtime and OCR models; normal browser builds do not need those files.

The Desktop release workflow additionally prepares and validates bundled resources, runs native extraction smoke tests, packages the installer, inspects package contents, and creates checksums and an SPDX SBOM. It does not exercise the full installed WebView lifecycle.

## Dependency and extraction upgrades

- **Browser packages:** update web-app/package.json and package-lock.json together. Re-run the browser license check and all browser workflow checks.
- **Rust crates:** update the relevant Cargo.toml and Cargo.lock; keep the pinned toolchain intentional and run cargo deny check.
- **PDFium and OCR models:** the Desktop runtime preparation script is the pin/hash source of truth. Update its pins deliberately and regenerate the notices and runtime manifests with the package workflow.
- **Extraction behavior:** when changing extraction semantics or cached result compatibility, review EXTRACTION_VERSION and checkpoint invalidation in web-app/src/app.js. Do not bump it for unrelated UI changes.
- **Branding:** edit root branding.json and source assets, then use npm run brand:sync (the browser lifecycle scripts run it automatically).

## Companion release

Manually dispatch companion-release.yml from the default branch and provide a SemVer value without the companion-v prefix, such as 0.1.0-beta.1. The workflow builds six unsigned portable packages and publishes a GitHub Release after all jobs succeed. A stable version without a prerelease suffix must pass companion/benchmarks/check-stable-promotion.mjs against companion/benchmarks/results/stable-promotion.json.

## Desktop prerelease

Manually dispatch glyphmend-desktop-release.yml from the default branch with a beta version such as 0.1.0-beta.1. It builds four unsigned installers, tags the source with the glyphmend-v prefix followed by that version, and creates a draft prerelease after every package job succeeds. The draft remains unpublished until a maintainer publishes it. Do not dispatch this workflow unless creating the tag and draft is intended.

The Windows installer uses the WebView2 bootstrapper and may need network access when WebView2 is absent. Stable Desktop distribution additionally requires code signing on Windows, signing and notarization on macOS, and clean-machine validation. See [distribution status](distribution-plan.md).
