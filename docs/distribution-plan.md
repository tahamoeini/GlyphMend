# Distribution status and release gates

This page records what the repository configures. It does not assert that a workflow has passed or that a release artifact is currently public. Check the linked GitHub Actions runs and Releases page for live status.

## Product modes

| Mode | Processing path | Distribution path |
| --- | --- | --- |
| Browser/PWA | MuPDF WebAssembly and bundled browser OCR; no Companion required. | Static build in web-app/dist; the browser workflow uploads an artifact but does not deploy the website. |
| Browser + Companion | User-paired loopback API to the standalone Rust service. | Portable Companion archives are built by the manual Companion release workflow. |
| GlyphMend Desktop | Bundled Rust service over Tauri IPC; no loopback listener. | Native installers are built by the Desktop prerelease workflow. |

All modes use the browser interface's shared Semantic Document IR validation and Markdown/DOCX exporters.

## Configured package targets

| Product | Targets configured in the workflows | Release behavior |
| --- | --- | --- |
| Companion | Windows x64/ARM64, macOS x64/ARM64, Linux x64/ARM64. | Unsigned packages with runtime files, OCR data, notices, checksums, SPDX SBOM, and provenance. A successful run publishes a GitHub Release. |
| Desktop | Windows x64 NSIS, Ubuntu 24.04 x64 .deb, macOS Intel .dmg, macOS Apple silicon .dmg. | Unsigned beta installers with checksums and SBOMs; a successful run creates a tagged draft prerelease. |
| Browser/PWA | Static web assets. | The workflow uploads a build artifact. Deployment to the public site is a separate operation. |

These are configured build targets, not a promise of clean-install compatibility on every operating-system version. The Desktop release workflow checks package contents and native runtime dependencies; the installed WebView still needs a full offline, restart, and upgrade validation. Windows machines may need network access during installation if WebView2 is missing.

## Current repository evidence

- This checkout contains the Git tag companion-v0.1.0-beta.1. A local Git tag alone does not prove that a public GitHub Release or its assets exist.
- The benchmark results checked into this repository are browser-only. They do not satisfy the paired-run stable-promotion gate.
- Every workflow is manually dispatched. The repository does not automatically run CI on pushes or pull requests.
- Companion and Desktop artifacts are unsigned. Stable direct distribution requires the signing/notarization and validation described in the [Desktop guide](desktop.md).

## Release gates

- **Companion stable release:** the manual workflow accepts a stable SemVer only when companion/benchmarks/results/stable-promotion.json passes the evidence gate.
- **Desktop stable distribution:** add and validate Windows code signing and macOS signing/notarization, then complete clean-machine installation and packaged-WebView lifecycle checks.
- **Performance or accuracy claims:** publish only results supported by repeatable paired measurements for the stated document class and configuration.

See [CI/CD and releases](ci.md), [roadmap](roadmap.md), and the [benchmark guide](../companion/benchmarks/README.md).
