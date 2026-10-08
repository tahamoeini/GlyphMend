# GlyphMend architecture and repository layout

## Product boundary

GlyphMend has three local processing modes:

- **Browser/PWA:** the complete default product. It opens PDFs in the browser, extracts pages in a worker, stores resumable workspace data in IndexedDB, and exports Markdown and DOCX.
- **Browser + Companion:** the browser remains the interface. After the user pairs the optional local Companion and selects it for a job, it sends that job's PDF bytes to the Companion's loopback API.
- **GlyphMend Desktop:** a Tauri host that bundles the Rust service and calls it over registered IPC commands. It does not start the Companion HTTP server.

All engines return the versioned Semantic Document IR v2. The browser validates results and owns the shared review, checkpoint, Markdown, and DOCX paths. A Companion failure falls back to browser extraction for the current uncommitted batch; cancellation does not start fallback work.

The frontend keeps one provider contract across three providers: browser-local extraction, the user-paired loopback Companion, and the bundled Desktop engine through Tauri IPC. Capability reporting and IR validation remain at that boundary. Browser extraction is available without a Companion and is the fallback when a paired provider is unavailable or fails.

## Data flow

~~~text
PDF selected in the shared GlyphMend interface
  -> provider selected for this job
     -> Browser provider: MuPDF WebAssembly and browser OCR
     -> Paired Companion provider: loopback API, PDFium, Tesseract
     -> Bundled Desktop provider: Tauri IPC, PDFium, Tesseract
  -> validate Semantic Document IR v2
  -> checkpoint in the current browser profile
  -> shared review and source comparison
  -> shared Markdown and DOCX exporters
~~~

Browser + Companion transfers PDF bytes only after user-initiated pairing and engine selection. The Companion rejects filesystem paths and remote URLs. Desktop transfers bounded chunks through registered Tauri commands and has no local HTTP listener.

## State and persistence

Browser and Desktop use the same frontend persistence code, but their browser profiles are separate. Workspace checkpoints and preferences are stored in the profile's IndexedDB/local storage; Desktop WebView data is kept in the per-user application data directories configured by Tauri. There is no automatic database bridge between a browser profile and Desktop. Users can export a checkpoint and import it into another profile.

The PWA service worker is included in the browser build and omitted from Desktop. Browser and Desktop builds use separate entry points and engine adapters. Browser-only mode requires no local service. The Companion CLI is a headless loopback service and does not itself provide a PDF-to-Markdown interface; the installed Desktop app is the standalone UI with a bundled engine.

## Repository layout

~~~text
branding.json              Canonical product identity
brand/                     Source brand assets
web-app/                   Browser/PWA, shared interface, storage, and exporters
companion/                 Rust workspace, protocol schemas, benchmarks, and Tauri host
docs/                      Current product and operations documentation
docs/archive/              Historical implementation records
research/                  Research plans and design references
.github/workflows/         Consolidated CI/release workflows and reusable package jobs
~~~

## Verification workflows

`platform-ci.yml` runs lightweight checks on pull requests and pushes to `main`. Its manually selected full-validation mode runs browser, Rust, Tauri, and browser-to-Companion tests plus native compilation checks. The separate manual benchmark mode runs the paired benchmark and its browser quality preflight. `platform-release.yml` is the single release entry point; it calls reusable Companion and Desktop packaging workflows, builds the browser package in parallel, and stages the outputs in one versioned draft release. See [CI/CD and releases](ci.md) and [distribution status](distribution-plan.md).
