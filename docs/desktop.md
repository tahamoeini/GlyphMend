# GlyphMend Desktop

GlyphMend Desktop is the installable distribution of the existing local-first interface. It uses the same Rust `companion-service` and PDFium/Tesseract provider as the standalone Companion, but it calls them through Tauri IPC in the app process. Desktop does not start a loopback HTTP server. The browser engine remains available as a per-job option.

## Configured release targets

| Platform | Artifact | Build runner | Runtime notes |
| --- | --- | --- | --- |
| Windows x64 | NSIS setup `.exe` | Windows x64 | WebView2 bootstrapper; Tesseract/Leptonica use the static `x64-windows-static-md` triplet; PDFium and all OCR models are bundled. |
| Ubuntu 24.04 x64 | `.deb` | Ubuntu 24.04 x64 | WebKitGTK 4.1 and GTK runtime packages are installer dependencies; Tesseract/Leptonica and their non-system native libraries are bundled. |
| macOS Intel | `.dmg` | macOS 15 Intel | Unsigned; bundle assembly checks the app and bundled libraries against the configured macOS 12.0 minimum. Clean-install compatibility still requires validation. |
| macOS Apple silicon | `.dmg` | macOS 15 Apple silicon | Unsigned; bundle assembly checks the app and bundled libraries against the configured macOS 12.0 minimum. Clean-install compatibility still requires validation. |

Each architecture is a separate artifact. There is no cross-platform installer. AppImage and Linux ARM are not initial Desktop targets.

These are workflow targets, not a clean-install support guarantee. The package workflow inspects native contents and dependencies, but installed-app compatibility still needs clean-machine validation.

## Install and offline behavior

The Windows installer uses Tauri's WebView2 bootstrapper. A machine without WebView2 may need an internet connection during installation. The current installer does not include the approximately 127 MB WebView2 offline installer. Once installed, the frontend, PDFium, Tesseract, and Fast/Best OCR data for English, Russian, Persian, and Simplified Chinese are bundled; extraction does not download models or send document content to a remote service. See Tauri's [Windows installer modes](https://v2.tauri.app/distribute/windows-installer/) for their current behavior and size tradeoffs.

Windows SmartScreen and macOS Gatekeeper can warn or block these unsigned prereleases. Stable public distribution requires Windows code signing and macOS signing plus notarization. Linux packages target Ubuntu 24.04 and the linked GTK/WebKitGTK system libraries declared by the `.deb`.

## Updating Desktop

No in-app updater is configured. Desktop installers are produced by the manually dispatched release workflow and remain drafts until a maintainer publishes them. To update, obtain the published installer for the target operating system and follow its installer flow. Export a workspace checkpoint before upgrading if the data is important; checkpoints can be imported again through the app. The release workflow does not yet verify checkpoint recovery across an installed-app upgrade.

## Local processing and saved work

The Desktop engine is the default for new Desktop jobs. The extraction engine selector offers browser processing for an individual job. The app shows the selected engine, the available capability/IR version, the engine used, and any fallback. A Companion error can move the current uncommitted batch to browser extraction; user cancellation does not start another extraction.

Workspace checkpoints, preferences, and the activity log continue to use the browser application's IndexedDB store. Tauri's stable application identifier and per-user data directories keep WebView data outside the install directory; job input files use the user cache directory and are removed with the job service. Use **Export checkpoint** for a portable backup and **Import workspace** to restore it in another installation or browser profile. Desktop and browser profiles are separate; there is no automatic database bridge between them.

The Desktop build omits the PWA service worker and embeds its frontend assets in the app. The native CI currently verifies the desktop frontend, IPC adapter, native provider, package contents, and installer resource paths. A packaged WebView test must still verify launch, worker/WASM startup, offline reload, and IndexedDB recovery through restart and upgrade before a public release is considered ready.

## Native resources and notices

The Tauri resource tree uses this layout:

```text
runtime/
  pdfium/<target library>
  tessdata/fast/{eng,rus,fas,chi_sim}.traineddata
  tessdata/best/{eng,rus,fas,chi_sim}.traineddata
  lib/<target native OCR dependencies>       # Linux and macOS
  notices/                                    # project and third-party license texts
  runtime-source-manifest.json
  runtime-manifest.json                       # per-file SHA-256 and sizes
```

`prepare-runtime.mjs` verifies the pinned PDFium archive hash, fetches OCR models from pinned Tesseract commits, and writes project and upstream notices. The Tauri pre-bundle step collects target-native Tesseract/Leptonica libraries, writes the final manifest, and fails if required models, notices, or checksums are missing. Linux and macOS runtime lookup uses Tauri's resource path. The PDFium and model paths are not derived from the current working directory.

The app process exposes only the bounded registered job commands. The frontend has no Tauri filesystem or shell plugin and the packaged app does not use a local HTTP listener.

## Local development

Use Node.js 22 and the Rust toolchain pinned in `companion/rust-toolchain.toml`. Install the host's Tauri/WebView prerequisites and Tesseract/Leptonica development libraries first. Keep a separate checkout for each development OS: Tauri's CLI binary in `node_modules` and the contents of `resources/runtime` are OS-specific, so a Windows checkout cannot be shared with WSL. The Tauri CLI install explicitly includes npm optional dependencies:

```bash
cd web-app
npm ci
npm run build:desktop

cd ../companion/apps/companion-tauri/web
npm ci --include=optional
npm run icon
npm run prepare:runtime
npm run tauri -- dev
```

The runtime preparation downloads the pinned PDFium library and OCR model files; it does not run during normal browser builds. If reusing a checkout that already has runtime files from another OS or an interrupted preparation, run `npm run clean:runtime` before `npm run prepare:runtime`. The cleaner removes only recognized generated runtime entries and refuses to remove unknown files. Windows packaging CI uses statically linked vcpkg libraries. Linux and macOS package assembly is performed by the native release workflow so it can inspect and relocate the target libraries with the appropriate tools.

## Release process

All GitHub Actions workflows are started manually; pushes, pull requests, and tags do not trigger CI/CD. Run `.github/workflows/companion-tauri.yml` from the Actions tab for native Desktop checks on Windows x64, Ubuntu x64, macOS Intel, and Apple silicon. The separate `.github/workflows/glyphmend-desktop-release.yml` must be manually dispatched from the default branch with a prerelease version of the form `X.Y.Z-beta.N`. After all native installers pass validation, it creates the matching `glyphmend-vX.Y.Z-beta.N` tag and an unsigned **draft prerelease**. The draft is not public until someone publishes it in GitHub.

Do not create a release tag, publish a draft, or distribute installers as part of ordinary code implementation. Stable releases need configured signing/notarization and a clean-machine install, offline, restart, and upgrade validation run.

## Related guides

- [Browser operations](browser.md)
- [Companion engine and loopback API](companion-engine.md)
- [Distribution status and release gates](distribution-plan.md)
- [CI/CD and release workflows](ci.md)
- [Compliance and data handling](compliance.md)
