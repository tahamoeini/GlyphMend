# GlyphMend architecture and repository layout

## Product boundary

GlyphMend has three local processing modes:

- **Browser/PWA:** the complete default product. It opens PDFs in the browser, extracts pages in a worker, stores resumable workspace data in IndexedDB, and exports Markdown and DOCX.
- **Browser + Companion:** the browser remains the interface. After the user pairs the optional local Companion and selects it for a job, it sends that job's PDF bytes to the Companion's loopback API.
- **GlyphMend Desktop:** a Tauri host that bundles the Rust service and calls it over registered IPC commands. It does not start the Companion HTTP server.

All engines return the versioned Semantic Document IR v2. The browser validates results and owns the shared review, checkpoint, Markdown, and DOCX paths. A Companion failure falls back to browser extraction for the current uncommitted batch; cancellation does not start fallback work.

## Data flow

~~~text
PDF selected in Browser/PWA or Desktop
  -> selected engine for this job
      -> Browser/PWA: MuPDF WebAssembly and bundled browser OCR
      -> Browser + Companion: loopback API, PDFium, Tesseract
      -> Desktop: Tauri IPC, PDFium, Tesseract
  -> validate Semantic Document IR v2
  -> checkpoint in browser storage
  -> review and source comparison
  -> shared Markdown and DOCX exporters
~~~

Browser + Companion transfers PDF bytes only after user-initiated pairing and engine selection. The Companion rejects filesystem paths and remote URLs. Desktop transfers bounded chunks through registered Tauri commands and has no local HTTP listener.

## State and persistence

Browser and Desktop use the same frontend persistence code, but their browser profiles are separate. Workspace checkpoints and preferences are stored in the profile's IndexedDB/local storage; Desktop WebView data is kept in the per-user application data directories configured by Tauri. There is no automatic database bridge between a browser profile and Desktop. Users can export a checkpoint and import it into another profile.

The PWA service worker is included in the browser build and omitted from Desktop. Browser and Desktop builds use separate entry points and engine adapters.

## Repository layout

~~~text
branding.json              Canonical product identity
brand/                     Source brand assets
web-app/                   Browser/PWA, shared interface, storage, and exporters
companion/                 Rust workspace, protocol schemas, benchmarks, and Tauri host
docs/                      Current product and operations documentation
docs/archive/              Historical implementation records
research/                  Research plans and design references
.github/workflows/         Manually dispatched CI, benchmark, and release workflows
~~~

## Verification workflows

Every workflow currently uses workflow_dispatch; none is configured to run on pushes, pull requests, or tags.

- **web-app.yml:** browser license checks, dependency audit, lint, typecheck, tests, production build, and artifact upload.
- **companion.yml:** Rust checks, dependency policy, and browser-to-Companion runtime integration.
- **companion-tauri.yml:** native Desktop CI across Windows, Ubuntu, macOS Intel, and Apple silicon.
- **companion-benchmarks.yml:** paired browser/Companion benchmark runs.
- **companion-release.yml:** unsigned standalone Companion packages and GitHub Release publication.
- **glyphmend-desktop-release.yml:** unsigned Desktop installers and a draft prerelease.

Workflow definitions describe intended checks; inspect the Actions run for evidence that a specific revision passed. See [CI/CD and releases](ci.md) and [distribution status](distribution-plan.md).
