# Distribution status and release gates

This page records what the repository configures. It does not assert that a workflow has passed or that a release artifact is currently public. Check the linked GitHub Actions runs and Releases page for live status.

## Product modes

| Mode | Processing path | Distribution path |
| --- | --- | --- |
| Browser/PWA | Browser provider uses MuPDF WebAssembly and bundled browser OCR; no Companion required. | Static build in web-app/dist and a versioned browser artifact. |
| Browser + Companion | Paired provider connects through the user-authorized loopback API to the standalone Rust service. | Portable Companion archives are produced by the unified release workflow. |
| GlyphMend Desktop | Bundled provider uses the same Rust service over Tauri IPC; no loopback listener. | Platform-specific native installers are produced by the unified release workflow. |

All modes use the browser interface's shared Semantic Document IR validation and Markdown/DOCX exporters.

## Configured package targets

| Product | Targets configured in the workflows | Release behavior |
| --- | --- | --- |
| Companion | Windows x64/ARM64, macOS x64/ARM64, Linux x64/ARM64. | Unsigned packages with runtime files, OCR data, notices, checksums, SPDX SBOM, and provenance. |
| Desktop | Windows x64 NSIS, Ubuntu 24.04 x64 .deb, macOS Intel .dmg, macOS Apple silicon .dmg. | Unsigned installers with runtime smoke checks, checksums, SPDX SBOM, and provenance. |
| Browser/PWA | Static web assets. | Versioned static artifact with third-party notices, checksum, SPDX SBOM, and provenance. Deployment to the public site is separate. |

All three distributions use one shared version and are attached to one draft prerelease after their parallel package jobs succeed.

These are configured build targets, not a promise of clean-install compatibility on every operating-system version. The Desktop release workflow checks package contents and native runtime dependencies; the installed WebView still needs a full offline, restart, and upgrade validation. Windows machines may need network access during installation if WebView2 is missing.

## Current repository evidence

- The benchmark results checked into this repository are browser-only. They do not satisfy the paired-run stable-promotion gate.
- Lightweight CI runs automatically for pull requests and pushes to `main`; tests, native matrix compilation, and benchmarks remain manual.
- Companion and Desktop artifacts are unsigned. Stable direct distribution requires the signing/notarization and validation described in the [Desktop guide](desktop.md).

## Release gates

- **Stable Companion release:** remains blocked until the paired benchmark evidence passes the stable-promotion gate.
- **Desktop stable distribution:** add and validate Windows code signing and macOS signing/notarization, then complete clean-machine installation and packaged-WebView lifecycle checks.
- **Performance or accuracy claims:** publish only results supported by repeatable paired measurements for the stated document class and configuration.

See [CI/CD and releases](ci.md), [roadmap](roadmap.md), and the [benchmark guide](../companion/benchmarks/README.md).
