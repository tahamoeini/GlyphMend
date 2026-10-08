# Compliance and data handling

This page records the license, dependency, artifact, and document-data controls implemented in the repository. It is an engineering inventory, not a legal opinion, certification, or jurisdiction-specific compliance assessment.

## Project licensing

- The browser application is licensed under AGPL-3.0-or-later; see [web-app/LICENSE](../web-app/LICENSE). The browser package integrates MuPDF.js, which the project documents under its AGPL/commercial licensing route. Network-interactive deployments must meet the applicable source-availability terms.
- Rust crates are licensed under Apache-2.0 OR MIT; see the license texts in [companion](../companion/).
- Desktop bundle metadata declares the frontend and Rust licenses together. Packaged Desktop releases collect project and third-party runtime notices.
- For component-level details, see [the dependency record](../companion/DEPENDENCIES.md), [third-party notices](../companion/THIRD_PARTY_NOTICES.md), `web-app/package.json`, and the Rust manifests.

For primary license references, see the [GNU AGPL v3 text](https://www.gnu.org/licenses/agpl-3.0.html) and [Artifex's licensing information](https://artifex.com/licensing). Review upstream terms when changing a library, native runtime, or OCR model. Project license files and dependency summaries do not replace review of the exact artifacts being redistributed.

## Dependency and release controls

- `npm run license:check` checks browser dependency licensing against the single root npm lockfile.
- `cargo deny check` applies the Rust advisory, license, and dependency policy in `companion/deny.toml`. Advisory exceptions should be reviewed when the Rust dependency graph changes.
- Runtime preparation pins PDFium and OCR model sources and verifies downloaded hashes. Packaging generates runtime manifests and preserves upstream notices.
- The manually dispatched release mode produces checksums, notices, SPDX SBOMs, and provenance for the versioned browser and integrated Desktop artifacts. Verify the actual release run and assets before distribution.
- The only GitHub Actions workflow runs only on manual dispatch. Quick mode excludes test suites; full validation, benchmark, and release work require separate manual mode selections.

A passing package-license or dependency-policy check is one control; it does not certify every legal obligation for a deployment.

## Document data paths

- Browser/PWA extraction runs on the user's device. PDFs and extracted pages are stored in the browser profile for resumable work; workspace export, import, and reset are explicit actions.
- Browser + local engine sends PDF bytes to the user's paired loopback service only after the user connects and selects that provider for a job. The API accepts bounded PDF data and rejects paths and remote URLs.
- Desktop sends bounded job data through registered Tauri IPC commands to the local Rust service. It does not start a loopback HTTP listener.
- These local processing paths do not mean the application never uses a network: the browser must load its deployed assets, while installation and build workflows may retrieve dependencies and pinned runtime files.

See [browser operations](browser.md), the [Companion API guide](companion-engine.md), the [Desktop guide](desktop.md), and [the unified CI/release guide](ci.md) for details.
