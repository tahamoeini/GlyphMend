# Distribution status and release gates

This page describes configured product paths and repository behavior. It does not assert that a workflow passed or that a release is publicly available. Check the linked Actions run and Releases page for live evidence.

## User-facing product paths

| Mode | Interface | Engine | Distribution |
| --- | --- | --- | --- |
| Browser/PWA | Browser | Browser provider using MuPDF WebAssembly and bundled browser OCR. No Companion required. | Static site plus a versioned browser archive. Deploying the site is separate. |
| Browser + local engine | Browser | Installed GlyphMend app started in headless Companion mode; user-paired loopback API to the Rust service. | The engine ships inside the same GlyphMend Desktop app; no separate Companion package. |
| GlyphMend Desktop | Installed Tauri app | Same Rust service and PDFium/Tesseract provider through registered IPC. No loopback listener. | One native installer for each configured OS/architecture target. |

All modes use the shared interface's Semantic Document IR validation, review, checkpoint, Markdown, and DOCX export paths. The source-only Rust CLI remains useful for development and benchmark runs; it is not a separate user-facing PDF-to-Markdown application.

## Configured artifacts

| Artifact | Configured targets | Release contents |
| --- | --- | --- |
| Browser/PWA | Static web assets | Browser build, project license, generated dependency report, third-party notices, checksum, SPDX SBOM, and provenance. |
| Integrated Desktop | Windows x64 NSIS, Ubuntu 24.04 x64 `.deb`, macOS Intel `.dmg`, macOS Apple silicon `.dmg` | Shared web interface, bundled Rust engine and native runtime data, runtime manifest, notices, checksum, SPDX SBOM, and provenance. Each package is inspected and its extracted runtime is used for digital-text and raster-OCR smoke checks. |

There is no standalone Companion release matrix. All artifacts use one calculated prerelease version and are attached to one draft GitHub prerelease after every package job succeeds. The draft remains unpublished until a maintainer reviews and publishes it.

These targets are build configurations, not a clean-install guarantee for every OS version. The packaged engine smoke checks validate extraction against the staged installer resources; they do not replace a clean-machine GUI install, offline launch, restart, workspace restore, or upgrade check. Windows may need internet access during installation to obtain WebView2 if it is not already installed.

## Current evidence

- The six-document benchmark results checked into the repository are browser-only and do not meet the paired-run promotion gate.
- The only GitHub Actions workflow has a `workflow_dispatch` trigger and no automatic push, pull-request, schedule, or tag triggers. Every mode is manually selected. `quick` contains npm dependency, source-quality, and frontend build checks without tests or Rust toolchain setup; full validation and release add Rust quality/compilation checks, and paired benchmarks and release packaging are separate manual modes.
- The reviewed [Actions run 37810064919](https://github.com/tahamoeini/glyph-mend/actions/runs/37810064919) showed browser packaging failing on a missing dependency-report file and raster-only OCR smoke failures on Ubuntu and macOS. The consolidated workflow generates the dependency report. Its packaged OCR smoke now uses the shorter raster token `MEND` and reports terminal service events and fallback diagnostics on failure; this adjustment remains unverified until a successful release run checks every target.
- Browser and Desktop packages are unsigned. Stable distribution needs configured signing/notarization and clean-machine install validation.

## Release gates

- **Stable engine release:** require the paired benchmark promotion gate and browser regression evidence for every corpus class before making comparative performance or accuracy claims.
- **Stable Desktop distribution:** configure and validate Windows signing and macOS signing/notarization; complete clean-machine installation and packaged WebView lifecycle checks.
- **Release evidence:** review the exact workflow revision, uploaded artifacts, checksums, SBOMs, provenance, installer contents, and smoke-test results before publishing the draft.

See [the unified validation and release workflow](ci.md), [the Desktop guide](desktop.md), [the roadmap](roadmap.md), and the [benchmark guide](../companion/benchmarks/README.md).
