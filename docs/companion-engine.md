# Rust Companion engine and API

The Rust Companion is an optional local PDF extraction engine. Users download and start it, connect from the browser, and select it for an individual job. The browser engine remains the default and is available without a Companion.

GlyphMend Desktop is a separate distribution that reuses this Rust service and provider through bounded Tauri IPC in the app process. It does not start the Companion's loopback HTTP server. Desktop defaults to its bundled engine, while browser extraction remains selectable per job. The standalone CLI/loopback Companion remains independently usable. See the [Desktop guide](desktop.md).

The Companion uses PDFium for native PDF text, page geometry, page objects, and rendering. Tesseract OCR supports English, Russian, Persian, Simplified Chinese, and a bundled English/Persian pair for mixed scans. Select the OCR language in the browser; the Companion offers Fast (default) and High Accuracy model sets. The paired model can take longer and use more memory than a single language. The Tesseract project documents the speed/accuracy tradeoff between model sets in its [data-file guide](https://github.com/tesseract-ocr/tessdoc/blob/main/Data-Files.md).

## User initiated loopback connection

The browser connects only to an explicitly provided loopback endpoint. The Companion binds to loopback, checks the exact allowed web origin, and requires a one-use pairing code before issuing a session token. The browser does not send a document until the user connects and selects Companion for the job. A browser local-network permission prompt may appear; declining it leaves browser extraction available.

The API accepts PDF bytes and bounded extraction options. It rejects arbitrary local paths and remote URLs. Request size, metadata, runtime input storage, concurrent jobs, and provider execution are bounded. Cancellation is delivered to the active job. Input chunks are content-hashed and idempotent; events are replayable so a client can recover progress after a temporary disconnect.

## Versioned REST API

Protocol v1 negotiates a protocol version and Semantic Document IR version at `POST /v1/session`. Authenticated endpoints are:

```text
GET  /v1/capabilities
POST /v1/jobs
PUT  /v1/jobs/:id/chunks/:sequence
POST /v1/jobs/:id/complete
GET  /v1/jobs/:id/events?after=N&limit=128&waitMs=15000
GET  /v1/jobs/:id/result
POST /v1/jobs/:id/result/acknowledge
POST /v1/jobs/:id/cancel
```

Document extraction uses the `glyphmend.document.extract.v2` capability, `inputKind=document`, PDF bytes uploaded in bounded chunks, and metadata such as `ocrAccuracy: "fast" | "high-accuracy"`, `ocrLanguage: "eng" | "eng+fas" | "rus" | "fas" | "chi_sim"`, `extractEquations`, and selected page numbers. Protocol v1.4 adds the optional equation setting; the browser omits it when communicating with older v1 companions. Input is identified by its digest, not by a caller-supplied path or URL. Capability discovery reports engine version, supported IR version, and available OCR choices.

Results are Semantic Document IR v2 and contain per-page source geometry, text and PDFium object bounds, engine/version metadata, OCR status, and fallback details. When enabled, formula-like native or OCR text is emitted as editable LaTeX math with a review diagnostic that points back to the source PDF page. The browser validates the IR before updating checkpoints, then uses the existing shared Markdown and DOCX exporters. The Companion cannot replace the browser's export implementation.

After the browser has durably checkpointed a completed batch, it acknowledges the result so the Companion can release its in-memory IR. Until acknowledgement, the result remains available for retry and resume.

The wire schemas are under [`companion/schemas/`](../companion/schemas/). The shared IR schema and cross-runtime fixtures define the stable data contract.

## Failure and fallback behavior

Connection denial, missing or unsupported Companion APIs, protocol mismatch, Companion unavailability, invalid output, or an extraction failure causes the current uncommitted batch to run in the browser engine. Previously checkpointed pages are reused. User cancellation stops the Companion job and does not trigger fallback work.

## Resource and security boundaries

- Loopback endpoints only; exact-origin check and short-lived, single-use pairing.
- Session-scoped jobs and bearer authentication.
- PDF-only bounded upload; no path or URL intake.
- Per-request size, job count, storage, timeout, and concurrency limits.
- PDFium calls are safely serialized; bounded OCR and semantic processing may run concurrently.
- Progress and terminal events are available through a bounded replayable event stream.

## Release packages

Each unsigned portable archive contains the Companion executable, required PDFium and Tesseract runtime files, Fast and Best models for English, Russian, Persian, and Simplified Chinese, third-party notices, an unsigned distribution manifest, and checksums. The unified release workflow also uploads workflow artifacts and one versioned GitHub draft release with an SPDX SBOM and provenance attestations. It builds Windows x64, macOS x64/arm64, and Linux x64/arm64 without code-signing certificates or Apple notarization. Windows SmartScreen and macOS Gatekeeper may warn or block launch; each archive and release page identifies the packages as unsigned. Linux packages are built on Ubuntu 24.04 and target compatible glibc systems.

Run `.github/workflows/platform-release.yml` manually from `main` with a prerelease version such as `2.1.0-beta.1`. The workflow accepts prerelease versions, and Companion and Desktop packages share the `glyphmend-v<version>` tag and are attached alongside the browser artifact to one draft prerelease. The draft requires maintainer review before publication. Stable Companion promotion remains gated on measured benchmark evidence and a browser regression review. The Companion CLI is a headless loopback service for browser pairing; the installed Desktop app is the standalone UI with the same bundled Rust engine.

Stable promotion requires repeatable, independently measured improvements by document class and no browser-only regression.

The standalone Companion has no in-app update mechanism. Users obtain a newer published package from the Releases page and start it using the included platform launch script. Browser workspace checkpoints remain in the browser profile; replacing the Companion does not move or migrate those checkpoints.

## Local verification and benchmark fixtures

From the repository root, run `node companion/benchmarks/generate-corpus.mjs` to rebuild the six synthetic CC0 PDFs, then run `node companion/benchmarks/check-corpus.mjs` to check labels and file hashes. Hand-authored gold text and structure labels are recorded before extractor output is evaluated. Benchmark reports include at least three paired browser/Companion runs per class, character and reading-order error, structure F1, latency, peak memory, tool versions, and browser-regression evidence. Stable promotion fails closed when results are missing or incomplete.

Download archives provide `run-companion.sh` for macOS/Linux and `run-companion.bat` for Windows. Starting the Companion displays a one-use pairing code and opens the supported GlyphMend browser origin; connection and file submission remain user initiated.
