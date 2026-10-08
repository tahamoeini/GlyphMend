# Compliance and data handling

This page records the license, dependency, artifact, and document-data controls implemented in this repository. It is an engineering inventory, not a legal opinion, certification, or jurisdiction-specific compliance assessment.

## Project licensing

- The browser application is licensed under AGPL-3.0-or-later; see [web-app/LICENSE](../web-app/LICENSE). The browser package integrates MuPDF.js, which the project documents under its AGPL/commercial licensing route. Network-interactive deployments must meet the applicable source-availability terms.
- Rust Companion crates are licensed under Apache-2.0 OR MIT; the license texts are in companion/LICENSE-APACHE and companion/LICENSE-MIT.
- Desktop bundle metadata declares the frontend and Rust licenses together. Packaged releases collect the applicable project and third-party license notices.
- For component-level details, use [companion/DEPENDENCIES.md](../companion/DEPENDENCIES.md), [companion/THIRD_PARTY_NOTICES.md](../companion/THIRD_PARTY_NOTICES.md), web-app/package.json, and the Rust manifests.

For primary license references, see the [GNU AGPL v3 text](https://www.gnu.org/licenses/agpl-3.0.html) and [Artifex's current licensing information](https://artifex.com/licensing). Review upstream terms when changing a library, native runtime, or OCR model. The project license files and dependency summaries do not replace review of the exact artifacts being redistributed.

## Dependency and release controls

- `npm run license:check` checks browser dependency licensing against the single root npm lockfile.
- cargo deny check applies the Rust advisory, license, and dependency policy in companion/deny.toml. The Tauri advisory exceptions are listed there and should be reviewed as that dependency tree changes.
- Runtime preparation pins PDFium and OCR model sources and verifies downloaded hashes. Packaging generates runtime manifests and preserves upstream notices.
- The unified release workflow produces checksums, product notices, SPDX SBOMs, and provenance attestations for the versioned browser, Companion, and Desktop artifacts. Verify the actual release assets and workflow run before distribution.

A passing package-license or dependency-policy check is one control; it does not certify every legal obligation for a deployment.

## Document data paths

- Browser/PWA extraction runs on the user's device. PDFs and extracted pages are stored in the browser profile for resumable work; workspace export, import, and reset are explicit actions.
- Browser + Companion sends the selected PDF to the user's paired loopback Companion only after the user selects it for a job. The API accepts bounded PDF data and rejects paths and remote URLs.
- Desktop sends job data through registered Tauri IPC commands to the local Rust service. It does not start a loopback HTTP listener.
- These local document-processing paths do not mean the application never uses a network: the browser must load its deployed assets, and installation/build workflows may retrieve dependencies and pinned runtime files.

See [browser operations](browser.md), the [Companion API guide](companion-engine.md), and the [Desktop guide](desktop.md) for the detailed boundaries.
