# GlyphMend architecture and repository layout

## Product boundary

GlyphMend has three user-facing modes backed by one shared interface and one Rust processing service:

- **Browser/PWA:** the complete default product. It opens PDFs in the browser, extracts pages in a worker, stores resumable workspace data in IndexedDB, and exports Markdown and DOCX.
- **Browser + local engine:** the browser remains the interface. The user launches the installed GlyphMend app with `--headless-companion`; the app starts the loopback bridge, opens a one-time pairing URL, and processes selected jobs locally.
- **GlyphMend Desktop:** the same installed app opened normally. Tauri presents the shared interface and calls the bundled Rust service through registered IPC commands; it does not start the HTTP bridge.

All engines return the versioned Semantic Document IR v2. The browser validates results and owns the shared review, checkpoint, Markdown, and DOCX paths. A Companion failure falls back to browser extraction for the current uncommitted batch; cancellation does not start fallback work.

The frontend keeps one provider contract across browser-local extraction, a user-paired loopback engine, and the bundled Desktop engine through Tauri IPC. Capability reporting and IR validation remain at that boundary. Browser extraction is available without an installed app and remains the fallback when the paired engine is unavailable or fails.

## Data flow

~~~text
PDF selected in the shared GlyphMend interface
  -> provider selected for this job
     -> Browser provider: MuPDF WebAssembly and browser OCR
     -> Paired local engine: loopback API, PDFium, Tesseract, headless GlyphMend app
     -> Bundled Desktop provider: Tauri IPC, PDFium, Tesseract
  -> validate Semantic Document IR v2
  -> checkpoint in the current browser profile
  -> shared review and source comparison
  -> shared Markdown and DOCX exporters
~~~

Browser + local engine transfers PDF bytes only after user-initiated pairing and engine selection. The bridge rejects filesystem paths and remote URLs and binds only to loopback. Desktop transfers bounded chunks through registered Tauri commands and has no local HTTP listener. Both transports use the same Rust job service and capability contract.

## State and persistence

Browser and Desktop use the same frontend persistence code, but their browser profiles are separate. Workspace checkpoints and preferences are stored in the profile's IndexedDB/local storage; Desktop WebView data is kept in the per-user application data directories configured by Tauri. There is no automatic database bridge between a browser profile and Desktop. Users can export a checkpoint and import it into another profile.

The PWA service worker is included in the browser build and omitted from Desktop. Browser and Desktop builds use separate entry points and engine adapters. Browser-only mode requires no local service. The retained Companion CLI is for developer diagnostics and benchmarks; it is not a separately distributed user app and does not provide a PDF-to-Markdown command. The installed GlyphMend app supplies both the standalone UI and headless browser-pairing mode.

## Repository layout

~~~text
branding.json              Canonical product identity
brand/                     Source brand assets
web-app/                   Browser/PWA, shared interface, storage, and exporters
companion/                 Rust workspace, protocol schemas, benchmarks, and Tauri host
docs/                      Current product and operations documentation
docs/archive/              Historical implementation records
research/                  Historical research and design references
.github/workflows/         One manually dispatched workflow with quick, full, benchmark, and release modes
~~~

## Verification workflows

The single `platform-ci.yml` workflow runs only on manual dispatch and has no automatic push, pull-request, schedule, or tag trigger. Its quick mode is test-free; full validation, paired benchmarks, and release packaging are separate manual selections. Test suites run only in full validation or the benchmark preflight. Release runs no tests by default; the `release_smoke` checkbox opts into installed-package PDF/OCR checks. Release builds the browser artifact and integrated Desktop installers; it does not create a separate Companion package. Its SemVer prerelease is calculated from Conventional Commit history and attached to one draft release, with notes stating whether smoke checks ran. See [CI/CD and releases](ci.md) and [distribution status](distribution-plan.md).
