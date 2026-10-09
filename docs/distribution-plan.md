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
| Integrated Desktop | Windows x64 NSIS, Ubuntu 24.04 x64 `.deb`, macOS Intel `.dmg`, macOS Apple silicon `.dmg` | Shared web interface, bundled Rust engine and native runtime data, runtime manifest, notices, platform-specific checksum file, SPDX SBOM, and provenance. macOS uses a 15.0 baseline but advertises the build host's later patch minimum when needed; inspect Info.plist and the runtime manifest for the exact required version. Build resources are checksum-validated. Installed/extracted resource checks and PDF/OCR smoke tests run only when `release_smoke` is enabled. |

There is no standalone Companion release matrix. All artifacts use one calculated prerelease version and are attached to one draft GitHub prerelease after every package job succeeds. The draft remains unpublished until a maintainer reviews and publishes it.

These targets are build configurations, not a clean-install guarantee for every OS version. The packaged engine smoke checks validate extraction against the staged installer resources; they do not replace a clean-machine GUI install, offline launch, restart, workspace restore, or upgrade check. Windows may need internet access during installation to obtain WebView2 if it is not already installed.

## Current evidence

- The six-document benchmark results checked into the repository are browser-only and do not meet the paired-run promotion gate.
- The only GitHub Actions workflow has a `workflow_dispatch` trigger and no automatic push, pull-request, schedule, or tag triggers. Every mode is manually selected. `quick` contains npm dependency, source-quality, and frontend build checks without tests or Rust toolchain setup; full validation and release add Rust quality/compilation checks, and paired benchmarks and release packaging are separate manual modes.
- Earlier release logs showed a missing browser dependency report, PDFium binding reuse failures, an unreliable custom OCR bitmap, and Windows notice collection mistaking `share/doc` for an installed package. The workflow now generates the report, reads real vcpkg package records, reuses verified PDFium bindings, and provides an optional smoke check with a readable raster fixture. These changes do not establish a successful hosted release of the current revision.
- Release mode skips test suites by default and retains source-quality, dependency, compilation, and generated runtime integrity checks. Enable `release_smoke` to validate installed-package resources; draft notes record that choice. Native runners wait for cheaper checks and browser packaging, and the release matrix stops its remaining builds after a platform failure.
- Browser and Desktop packages are unsigned. Stable distribution needs configured signing/notarization and clean-machine install validation.

## Release gates

- **Stable engine release:** require the paired benchmark promotion gate and browser regression evidence for every corpus class before making comparative performance or accuracy claims.
- **Stable Desktop distribution:** configure and validate Windows signing and macOS signing/notarization; complete clean-machine installation and packaged WebView lifecycle checks.
- **Release evidence:** review the exact workflow revision, uploaded artifacts, checksums, SBOMs, provenance, installer contents, and smoke-test results before publishing the draft.

See [the unified validation and release workflow](ci.md), [the Desktop guide](desktop.md), [the roadmap](roadmap.md), and the [benchmark guide](../companion/benchmarks/README.md).
