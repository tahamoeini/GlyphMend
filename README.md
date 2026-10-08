<p align="center">
  <img src="web-app/public/brand/glyphmend-mark.svg" alt="GlyphMend logo" width="72" height="72">
</p>

<h1 align="center">GlyphMend</h1>

<p align="center"><strong>Faithful document reconstruction from PDF to structured Markdown.</strong></p>

<p align="center">GlyphMend is a local-first PDF reconstruction product. The browser platform is the complete default: it extracts documents on the user's device, stores resumable checkpoints locally, and exports Markdown and DOCX without a backend.</p>

<p align="center"><a href="https://glyphmend.negar.team/" target="_blank" rel="noopener noreferrer">Open the platform</a></p>

<p align="center">
  <a href="https://www.producthunt.com/products/glyphmend?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-glyphmend" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1247011&amp;theme=dark&amp;t=1789071061228">
      <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1247011&amp;theme=light&amp;t=1789071058947" alt="GlyphMend - Faithful document reconstruction from PDF to Text. | Product Hunt" width="250" height="54">
    </picture>
  </a>
</p>

Choose one of three modes:

- **Browser/PWA:** open GlyphMend in a supported browser or install the PWA. Browser extraction, local checkpoints, workspace import/export, Markdown, and DOCX work without the Companion.
- **Browser + Companion:** run the separate local Companion, pair through its loopback endpoint, and select it for an individual job. The browser remains the interface and fallback.
- **GlyphMend Desktop:** install the native app and use the bundled interface. Its local PDFium/Tesseract engine is the default; browser extraction remains available for an individual job.

The two native modes exchange the same versioned Semantic Document IR v2 as the browser engine. The standalone Companion uses the versioned loopback API; Desktop calls the same Rust service through Tauri IPC without starting an HTTP listener.

No speed or accuracy advantage is claimed until independently labeled benchmarks support one for a specific document class.

## Start the browser platform

```bash
cd web-app
npm ci
npm run dev
```

Build the static application with `npm run build`. See the [Browser guide](docs/browser.md) for local processing, OCR, checkpoints, deployment, and troubleshooting.

## Optional Rust Companion

The Companion is opt-in and processes the PDF locally. Download links and connection instructions are in the app's Companion area and on the [GitHub Releases page](https://github.com/tahamoeini/glyph-mend/releases). Start the downloaded program, connect using its loopback endpoint and one-time pairing code, then select Companion for an individual job. Browser remains the default.

Companion extraction offers Fast OCR by default and High Accuracy OCR as an explicit option. Both model sets for English, Russian, Persian, and Simplified Chinese are bundled in portable release packages. The initial prerelease is unsigned and may trigger Windows SmartScreen or macOS Gatekeeper warnings; verify its published checksum before running. A release remains a prerelease until benchmark results demonstrate repeatable improvements and browser-only behavior remains unchanged.

See [Companion architecture and API](docs/companion-engine.md) and [release requirements](docs/ci.md).

## GlyphMend Desktop

The Desktop release workflow targets Windows x64 (NSIS setup), Ubuntu 24.04 x64 (`.deb`), and macOS Intel and Apple silicon (`.dmg`). It stages unsigned draft prereleases; Windows SmartScreen and macOS Gatekeeper may warn or block launch. Stable public distribution requires code signing and macOS notarization.

The standard Windows installer uses the WebView2 bootstrapper and may need an internet connection to install WebView2 on a machine without its runtime. The alternative offline WebView2 installer adds about 127 MB and is not currently bundled. After installation, GlyphMend's frontend, PDFium, Tesseract, and all supported OCR models are bundled for offline work. The Desktop guide records the package and runtime checks: [GlyphMend Desktop](docs/desktop.md).

## Product contract

| PDF content | Output |
| --- | --- |
| Titles, paragraphs, and lists | Structured Markdown |
| Recoverable tables and formulas | Markdown tables and editable LaTeX math, with source crops for uncertain formulas |
| Source images and unresolved graphics | Preserved visual references and quality details |
| Scanned pages | OCR in English, Russian, Persian, or Simplified Chinese when enabled |
| Page boundaries | Optional page markers |
| Extraction provenance | Semantic Document IR v2 with per-page engine and fallback details |

The reconstruction policy is conservative: preserve source evidence and expose uncertainty instead of inventing document structure. Markdown is the canonical text artifact; DOCX is a shared export layered on top.

## Licensing

The browser interface is licensed under AGPL-3.0-or-later; its [license](web-app/LICENSE) and deployed-version source links are available in the app footer. The Rust crates are separately licensed under Apache-2.0 OR MIT. Desktop bundles include these licenses and target-specific runtime notices.

## Documentation

- [Browser operations](docs/browser.md)
- [Browser application](web-app/README.md)
- [Companion engine and API](docs/companion-engine.md)
- [GlyphMend Desktop distribution](docs/desktop.md)
- [Distribution implementation plan and audit decisions](docs/distribution-plan.md)
- [Architecture and repository layout](docs/architecture.md)
- [CI and release workflow](docs/ci.md)
- [Branding](docs/branding.md)
- [Active roadmap](docs/roadmap.md)
- [Documentation index](docs/README.md)
