# GlyphMend architecture and repository layout

## Product boundary

The Browser/PWA is complete without a native runtime. It owns PDF intake, resumable workspace storage, extraction settings, review, Semantic Document IR v2 validation, and Markdown/DOCX exports. Users can add the standalone Rust Companion for one job or install GlyphMend Desktop, which bundles the same Rust engine in the app process. Each engine returns the same versioned IR, including engine/version metadata and per-page fallback details.

The browser can complete an extraction without a Companion. Connection denial, unsupported APIs, an unavailable Companion, or a failed Companion job falls back to the browser engine unless the user cancelled the job.

## Data flow

```text
PDF bytes in browser
  → selected engine for this job
      ├─ Browser/PWA: MuPDF WASM + browser OCR
      ├─ Browser + Companion: loopback API → PDFium + multilingual Tesseract OCR
      └─ GlyphMend Desktop: Tauri IPC → PDFium + multilingual Tesseract OCR
  → validate Semantic Document IR v2
  → browser checkpoint and review state
  → shared Markdown renderer
  → shared DOCX exporter
```

For Browser + Companion, the user connects the loopback Companion and chooses it for a job; the browser sends the PDF bytes only for that job. The API rejects paths and remote URLs. Desktop sends bounded chunks through registered IPC commands and does not open a local HTTP listener. Raggi remains a separate product; any future document exchange uses the versioned Semantic Document IR import/export boundary.

## Top-level layout

```text
branding.json              Product identity and browser configuration
brand/                     Source brand assets
web-app/                   Complete browser platform and exports
companion/                 Rust service, loopback API, Tauri host, PDF extraction, schemas
docs/                      Current product and operations documentation
docs/archive/              Historical upgrade and roadmap records
research/archive/          Archived research
.github/workflows/         Browser CI, Companion CI, and manual Companion release
```

## Browser platform

`web-app/src/app.js` owns the interface and job orchestration. Browser extraction runs in bounded page batches, commits completed pages to IndexedDB, and uses the shared Semantic Document IR v2 validation and export path. The browser engine remains usable offline after the application and its bundled OCR runtime are available.

## Rust Companion

The Rust workspace contains the loopback bridge, bounded job service, shared protocol contracts, and portable executable. PDFium calls are serialized through the thread-safe binding. OCR and semantic work are bounded and can run concurrently. The Companion release packages bundle Fast and Best Tesseract data for English, Russian, Persian, and Simplified Chinese.

The connection is user initiated and bound to an exact web origin and a one-use pairing code. Endpoints are loopback-only, session authenticated, size limited, and time bounded. See [the Companion API guide](companion-engine.md).

## Checks and releases

- `web-app.yml`: browser tests, static build, and dependency checks.
- `companion.yml`: Rust checks and browser-to-Companion contract checks.
- `companion-tauri.yml`: native Desktop CI across Windows, Ubuntu, macOS Intel, and Apple silicon.
- `companion-release.yml`: manual, versioned unsigned portable Companion packages.
- `glyphmend-desktop-release.yml`: native unsigned Desktop packages and a draft-only prerelease workflow.

The first Companion publication is an explicitly unsigned prerelease. The workflow builds all six platform/architecture packages without paid signing credentials. Benchmark and licensing decisions remain visible in the [roadmap](roadmap.md).
