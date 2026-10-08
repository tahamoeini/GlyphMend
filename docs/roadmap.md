# Roadmap and release readiness

This page separates repository implementation from evidence still required for distribution. Check the exact GitHub Actions run and Releases page for live status; code and workflow definitions alone do not establish success.

## Implemented in the repository

- Browser/PWA local PDF extraction, OCR, IndexedDB checkpoints, workspace import/export, review, Markdown, and DOCX.
- One Rust processing service exposed through a user-paired loopback API in headless Companion mode and through bounded Tauri IPC in Desktop mode.
- Browser fallback, capability reporting, and the shared Semantic Document IR v2 contract.
- Six-document synthetic benchmark corpus, paired-run tooling, and a stable-promotion gate.
- One root npm workspace and lockfile for the frontend and Tauri build tools.
- One Actions workflow that runs only on manual dispatch, with a fast test-free quick mode plus separate full-validation, benchmark, and release modes.
- One release process that calculates a shared prerelease version, builds the browser artifact and integrated Desktop installers, checks the staged package resources, and creates one draft release.

## Current gaps and evidence needed

1. **Paired benchmark evidence.** The checked-in benchmark results are browser-only. They do not satisfy the paired browser/Rust-provider promotion gate. Require repeated paired measurements and browser regression evidence for each document class before making comparative speed or accuracy claims.
2. **WSL2 launch.** The reported WSLg commands ran from `/mnt/f/Projects/glyph-mend`, where runtime preparation rejected resources for the Windows target before the direct Tauri command was run anyway. The root Tauri dev command now stops on mismatched resources, and the launcher warns against using a Windows-mounted WSL checkout. Retest from a WSL-filesystem checkout using `npm run dev:desktop`; that command also applies Tauri's optional `WEBKIT_DISABLE_COMPOSITING_MODE=1` workaround unless overridden. The window has not yet been visually verified after these changes.
3. **Packaged Desktop runtime.** The reviewed [Actions run 37810064919](https://github.com/tahamoeini/glyph-mend/actions/runs/37810064919) showed digital-text extraction passing but raster-only OCR failing on Ubuntu and both macOS architectures. The macOS OCR output was `ISL YPAMEND`, which recovered the final `MEND` portion but not the whole custom bitmap word; the Ubuntu test ended in a failed extraction state without printing service events. The current smoke uses the shorter raster token `MEND` and emits service-event and fallback diagnostics on failure. This change has not passed in a hosted run, does not establish OCR accuracy, and does not prove the packages pass; a successful new release run is still required.
4. **Installed WebView lifecycle.** A clean-machine check must verify GUI launch, worker/WASM startup, offline use, checkpoint recovery after restart, and upgrade behavior. Runtime extraction smoke checks do not cover those UI lifecycle cases.
5. **Stable Desktop signing.** Configure and validate Windows code signing and macOS signing/notarization before stable direct distribution.
6. **Revision-specific workflow evidence.** Every workflow mode requires manual dispatch. Inspect the exact run and its artifacts for the revision under consideration.

Do not make engine speed or accuracy claims until repeated, class-specific paired results support them. See [distribution status](distribution-plan.md), [the CI/release guide](ci.md), and the [benchmark guide](../companion/benchmarks/README.md).
