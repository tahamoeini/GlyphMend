# GlyphMend Desktop

GlyphMend Desktop is the installable distribution of the existing local-first interface. It uses the same Rust `companion-service` and PDFium/Tesseract provider as the standalone Companion, but it calls them through Tauri IPC in the app process. Desktop does not start a loopback HTTP server. The browser engine remains available as a per-job option.

The standalone Companion CLI is a headless loopback service for pairing with the browser; it is not a separate PDF-to-Markdown UI. Install GlyphMend Desktop to use the interface and bundled engine without opening a browser.

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

Use Node.js 22 and the Rust toolchain pinned in `companion/rust-toolchain.toml`. Install the host's Tauri/WebView prerequisites and Tesseract/Leptonica development libraries first. Keep a separate checkout for each development OS, including Windows and WSL: Tauri's native npm binding and `resources/runtime` contents are target-specific. The root npm workspace installs both frontend and Tauri build tools from one lockfile. Use `npm ci --include=optional` so npm installs the platform-specific Tauri CLI package.

On Windows, install the Microsoft C++ Build Tools and select the **Desktop development with C++** workload, including the x64/x86 MSVC tools and a Windows SDK. This project builds the `x86_64-pc-windows-msvc` Rust target, which needs `link.exe`. Run development commands from **Developer PowerShell for Visual Studio** so the MSVC tools are available on `PATH`. Tauri also requires Microsoft Edge WebView2 for Windows development. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows) and [Microsoft's MSVC Build Tools guide](https://learn.microsoft.com/en-us/cpp/overview/acquire-msvc?view=msvc-170).

On Ubuntu 24.04 and WSL, install the Linux packages used by the CI and packaging jobs:

```bash
sudo apt-get update
sudo apt-get install -y build-essential curl wget file libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev libgtk-3-dev \
  libtesseract-dev libleptonica-dev libcurl4-openssl-dev pkg-config patchelf
```

On macOS, install the Xcode Command Line Tools and the native OCR build dependencies with `brew install tesseract leptonica pkg-config`. Use Tauri's [platform prerequisites](https://v2.tauri.app/start/prerequisites/) for host-specific system packages and tooling.

Run the single desktop development command from the repository root:

```bash
npm ci --include=optional
npm run dev:desktop
```

`dev:desktop` prepares the pinned runtime and starts Tauri. Tauri's `beforeDevCommand` starts the shared Vite frontend at `http://127.0.0.1:1420`, and `devUrl` loads that server in the native WebView; development no longer depends on an old generated `dist/` directory. The installer path remains a bundled production build. For release packaging use `npm run build:desktop`. `npm run build:desktop:web` builds only the desktop-mode frontend. `npm run desktop:prepare` prepares runtime data explicitly, while `npm run desktop:clean:runtime` removes recognized generated data.

Runtime preparation is idempotent when the current checkout already contains verified resources for the same target. If it finds missing, stale, or mismatched resources, it fails with the exact cleanup command. Run `npm run desktop:clean:runtime` and then `npm run desktop:prepare`; the cleaner refuses unrecognized top-level entries in `resources/runtime`. Do not put user data inside generated runtime directories. Do not switch OS targets inside one checkout. Use separate Windows and WSL/Linux checkouts so the runtime and npm optional native binary remain isolated. Windows development also requires the Microsoft C++ Build Tools and a Developer PowerShell with `link.exe` on `PATH`.

### Known WSL2 development issue

WSL2/WSLg launch is not currently verified. In the latest reported runs, Tauri starts but the window remains blank or gray. The same result was reported with `WEBKIT_DISABLE_DMABUF_RENDERER=1` and with `GDK_BACKEND=x11`; neither is a confirmed fix. Keep WSL2 as a separate Linux checkout, and do not treat a successful process start as a successful UI launch. The repository has no verified workaround yet. Native Linux and Windows launch behavior must be checked independently from WSLg.

## Release process

The consolidated CI workflow runs lightweight checks automatically for pull requests and pushes to `main`. Its manually selected `full` mode runs the moved test suites and native compilation checks. The single `platform-release.yml` workflow builds the browser package, standalone Companion packages, and Desktop installers under one prerelease version, then creates one unsigned **draft prerelease** after all packaging and runtime smoke checks pass. The draft is not public until a maintainer publishes it.

Do not create a release tag, publish a draft, or distribute installers as part of ordinary code implementation. Stable releases need configured signing/notarization and a clean-machine install, offline, restart, and upgrade validation run.

## Related guides

- [Browser operations](browser.md)
- [Companion engine and loopback API](companion-engine.md)
- [Distribution status and release gates](distribution-plan.md)
- [CI/CD and release workflows](ci.md)
- [Compliance and data handling](compliance.md)
