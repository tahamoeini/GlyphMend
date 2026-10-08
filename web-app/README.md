# GlyphMend Browser Platform

> **Faithful document reconstruction from PDF to structured Markdown.**

This is the complete browser-only GlyphMend product. It runs locally on the user's device without a backend, account, document upload, telemetry requirement, or installed engine. A user may optionally pair with the headless mode of the installed GlyphMend app and choose its Rust engine for an individual job; the browser remains the default and fallback.

For operations and troubleshooting, see the [browser guide](../docs/browser.md). For local-engine pairing and API details, see the [Companion guide](../docs/companion-engine.md).

## Complete local workflow

- PDF.js source-page viewer.
- MuPDF WebAssembly structured extraction in a Web Worker, with text, images, font information, and page geometry.
- Conservative heading and table detection; validated formulas are exported as editable LaTeX/Word math, with source crops retained when reconstruction is uncertain. Repeated header/footer cleanup, wrap dehyphenation, and cross-page paragraph repair remain enabled.
- Bundled Tesseract WebAssembly fallback for English, Russian, Persian, and Simplified Chinese scanned pages, forced OCR, and configurable render DPI.
- Source figures retained as PNG assets when supported.
- Editable Markdown, safe preview, source comparison, search, and quality metrics.
- Pause, cancel, resume, workspace import/export, and incremental IndexedDB checkpoints.
- Shared Markdown, plain text, Word, quality-report, log, and complete-bundle exports.
- Editable Word equations, with source image crops for formulas that need review.
- Offline-capable installable PWA after the first successful load.

## Run and build

Use Node.js 22 and npm from the repository root (the frontend is an npm workspace):

```bash
npm ci
npm run dev:web
```

```bash
npm test # browser suite; run locally or through manual full validation
npm run build:web
npm run preview --workspace glyphmend-browser
```

The production output is `web-app/dist/`. Serve it over HTTPS; browsers restrict workers and service workers on `file://` URLs.

The installed Desktop frontend is built with `npm run build:desktop:web`. It uses the Tauri IPC adapter and omits the PWA service worker. From the repository root, run `npm run dev:desktop` to develop the installed app, `npm run dev:companion` to run the headless local engine with the browser UI, or `npm run build:desktop` to package the installer. Keep Windows, WSL, Linux, and macOS checkouts separate because native npm bindings and runtime resources are target-specific. Put a WSL checkout under the Linux filesystem (for example `~/src/glyph-mend`), not on `/mnt/<drive>`. The Tauri dev launcher warns about a mounted Windows checkout and applies the optional WebKit compositor workaround in WSL; WSLg still needs a visual launch confirmation. See [GlyphMend Desktop](../docs/desktop.md#reported-wsl2-issue).

## Optional Companion

The browser can pair with the installed GlyphMend app running `--headless-companion`. It returns Semantic Document IR v2 to this application; the same browser Markdown and DOCX exporters remain in use. If loopback access is denied or the local engine is unavailable, unsupported, or fails, the browser engine processes the job. No separate Companion installer is distributed. See the [Companion guide](../docs/companion-engine.md).

## Licensing

The browser platform, including the MuPDF.js integration, is licensed under AGPL-3.0-or-later. The complete license is in [LICENSE](./LICENSE). The app footer links to the corresponding source tree and license for the deployed build; deployments outside the GitHub workflow must set the matching VITE_SOURCE_URL and VITE_LICENSE_URL build variables. Network-interactive deployments must make the corresponding source for the running version available under the AGPL terms.

This is an engineering implementation of the project’s chosen license route, not legal advice. MuPDF.js is also available under a commercial license from Artifex. Tesseract.js is Apache-2.0 and the bundled English data package is MIT licensed. The Rust service and Tauri host are separately licensed as Apache-2.0 OR MIT; the integrated Desktop package includes their dependency notices.

## Interface materials

GlyphMend uses a HIG-aligned Liquid Glass interpretation, not native Liquid Glass. The internal [design-system fixture](./design-system.html) demonstrates opaque document surfaces and limited chrome-only glass. The same semantic tokens drive light and dark modes; no Apple proprietary fonts are bundled.
