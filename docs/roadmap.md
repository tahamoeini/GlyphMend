# Roadmap and release readiness

This page separates features and automation present in the repository from evidence still needed before broader distribution. Check GitHub Actions and Releases for live run and publication status.

## Implemented in the repository

- The Browser/PWA supports local PDF extraction, OCR, IndexedDB checkpoints, workspace import/export, review, Markdown, and DOCX.
- The optional Rust Companion exposes a versioned loopback API. Desktop reuses its service and PDFium/Tesseract provider through Tauri IPC.
- Browser and Rust fixtures validate the Semantic Document IR v2 contract.
- The benchmark corpus contains six labeled synthetic PDFs, with paired-run tooling and a stable-promotion gate.
- Manual CI and package workflows exist for the browser, Companion, benchmarks, and four Desktop targets.

## Validation still required

1. **Paired benchmark evidence.** The checked-in benchmark results currently contain browser-only runs, not paired browser/Companion evidence. Stable Companion promotion requires the benchmark gate to pass on repeated paired runs and browser regression evidence for each document class.
2. **Packaged Desktop lifecycle.** Native workflows build and inspect packages and run native extraction smoke tests. A full installed-WebView check is still needed for launch, worker/WASM startup, offline reload, checkpoint recovery after restart, and upgrade.
3. **Stable Desktop signing.** Windows signing and macOS signing/notarization must be configured and tested before stable direct distribution.
4. **Revision-specific CI evidence.** Workflows are manual. A workflow file or a local build does not establish that the current revision passed the hosted workflow.

Do not make engine speed or accuracy claims until repeated, class-specific benchmark results support them. See [distribution status](distribution-plan.md), [CI/CD](ci.md), and the [benchmark guide](../companion/benchmarks/README.md).
