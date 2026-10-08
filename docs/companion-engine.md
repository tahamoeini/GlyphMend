# Rust processing engine and Companion API

GlyphMend has one Rust processing service shared by two local-engine modes:

- In **browser + local engine** mode, the installed GlyphMend app runs headless and exposes the service through the user-paired loopback API.
- In **Desktop** mode, the app calls that service through bounded Tauri IPC and does not start the HTTP listener.

The browser/PWA remains usable without either local mode. The Rust CLI source is retained for development and benchmark tooling; it is not a separate user-facing product and does not provide a direct PDF-to-Markdown command. See the [Desktop guide](desktop.md) for launch and distribution details.

## Engine and OCR

The provider uses PDFium for native PDF text, page geometry, PDF objects, and rendering. Tesseract supports English, Russian, Persian, Simplified Chinese, and the bundled English/Persian pair for mixed scans. Fast is the default OCR model set; High Accuracy uses the larger Best model set and may take longer and use more memory. See the Tesseract project's [data-file guide](https://github.com/tesseract-ocr/tessdoc/blob/main/Data-Files.md) for its model tradeoffs.

Capability discovery reports the engine version, supported IR version, and available OCR choices. Frontend providers share the same result contract and Semantic Document IR validation.

## User-initiated loopback pairing

The browser connects only to an explicitly supplied loopback endpoint. The local app binds to loopback, validates the exact allowed browser origin, and requires a one-use pairing code before issuing a session token. The browser does not send document data until the user connects and selects the local engine for a job. A browser local-network permission prompt may appear; declining it leaves browser extraction available.

The API accepts bounded PDF bytes and extraction options. It rejects arbitrary local paths and remote URLs. Request size, metadata, temporary input storage, concurrent jobs, and provider execution are bounded. Cancellation reaches the active job. Input chunks are content-hashed and idempotent; progress events can be replayed after a temporary disconnect.

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

Document extraction uses the `glyphmend.document.extract.v2` capability, `inputKind=document`, bounded PDF chunks, and metadata such as `ocrAccuracy: "fast" | "high-accuracy"`, `ocrLanguage: "eng" | "eng+fas" | "rus" | "fas" | "chi_sim"`, `extractEquations`, and selected page numbers. Protocol v1.4 adds the optional equation setting; the browser omits it for older v1 peers. Input is identified by its digest, not a caller-supplied path or URL.

Results use Semantic Document IR v2 and include per-page source geometry, native text and PDFium object bounds, engine/version metadata, OCR status, and fallback details. The browser validates the result before updating checkpoints, then uses the shared Markdown and DOCX exporters. The service does not replace the browser's exporters.

After the browser durably checkpoints a completed batch, it acknowledges the result so the service can release its in-memory IR. Until acknowledgement, the result remains available for retry or resume.

Wire schemas are in [`companion/schemas/`](../companion/schemas/). Shared IR schemas and cross-runtime fixtures define the stable data contract.

## Failure and fallback

Connection denial, unsupported APIs, protocol mismatch, engine unavailability, invalid output, or extraction failure can send the current uncommitted batch to the browser provider. Previously checkpointed pages are reused. User cancellation stops the local job and does not start fallback work.

## Resource and security boundaries

- Loopback binding only, exact-origin validation, and short-lived single-use pairing.
- Session-scoped jobs and bearer authentication.
- Bounded PDF upload; no path or URL intake.
- Limits on request size, job count, storage, execution time, and concurrency.
- Serialized PDFium calls; bounded OCR and semantic processing.
- Bounded replayable progress and terminal events.

Desktop retains the Tauri IPC boundary. Its frontend has no Tauri filesystem or shell plugin, and the packaged app does not run a local HTTP server.

## Distribution

The local engine ships inside each integrated GlyphMend Desktop installer, together with target PDFium, OCR libraries and model data, runtime manifests, and license notices. In headless mode the same installed app exposes the loopback bridge. The release workflow builds the browser artifact and Windows x64, Ubuntu x64, macOS Intel, and macOS Apple silicon Desktop packages under one calculated version. It creates one draft prerelease and no separate Companion archives.

The Desktop artifacts are currently unsigned. Stable distribution requires signing/notarization and clean-machine validation. Paired benchmark evidence is required before making claims that the Rust provider is faster or more accurate than browser extraction. See [distribution status](distribution-plan.md) and [CI/release details](ci.md).

## Local development and benchmarks

Use `npm run dev:companion` from the repository root to run the Tauri app in headless Companion mode against the shared desktop-mode Vite frontend at `http://127.0.0.1:1420`. Use `npm run dev:desktop` to run normal Tauri Desktop mode. Both require the host's native prerequisites and target-specific runtime resources; use separate checkouts for Windows and WSL/Linux. Place WSL checkouts under the WSL Linux filesystem, not on a mounted Windows drive; see the [Desktop guide](desktop.md#local-development).

The source CLI can still be built for benchmark and developer diagnostics. The six-document corpus, repeated paired runner, evaluation report, and stable-promotion gate are documented in the [benchmark guide](../companion/benchmarks/README.md).
