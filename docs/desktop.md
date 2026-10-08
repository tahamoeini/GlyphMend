# GlyphMend Desktop and local Companion mode

GlyphMend ships one installable app containing the shared web interface and the Rust processing service. The app supports two launch modes: normal Desktop mode, where Tauri presents the interface and calls the bundled engine through IPC; and headless Companion mode, where the app starts the loopback service for the browser interface. There is no separate Companion installer.

The hosted or self-hosted browser application remains a complete third usage path and needs no installed app. In all three paths, the frontend uses the same result validation, review, checkpoint, Markdown, and DOCX export code.

## Product modes

| Mode | Interface | Processing |
| --- | --- | --- |
| Browser/PWA | Browser | Browser provider; local extraction and OCR. No Companion required. |
| Browser + local engine | Browser | The installed GlyphMend app runs headless and exposes the user-paired loopback API. |
| GlyphMend Desktop | Installed app | Shared web interface in Tauri; bundled Rust engine through Tauri IPC. No loopback server. |

The CLI source in the Rust workspace remains for development and benchmark tooling. It does not provide a standalone PDF-to-Markdown command and is not a separate user download.

## Configured Desktop targets

| Platform | Artifact | Build runner | Runtime notes |
| --- | --- | --- | --- |
| Windows x64 | NSIS setup `.exe` | Windows x64 | WebView2 bootstrapper; Tesseract/Leptonica use the static `x64-windows-static-md` triplet. PDFium and OCR models are bundled. |
| Ubuntu 24.04 x64 | `.deb` | Ubuntu 24.04 x64 | WebKitGTK 4.1 and GTK runtime packages are installer dependencies; the native OCR libraries and models are bundled. |
| macOS Intel | `.dmg` | macOS 15 Intel | Requires macOS 15 or later. No Developer ID signature or notarization; relocated libraries receive ad hoc signatures. Clean-install compatibility still needs validation. |
| macOS Apple silicon | `.dmg` | macOS 15 Apple silicon | Requires macOS 15 or later. No Developer ID signature or notarization; relocated libraries receive ad hoc signatures. Clean-install compatibility still needs validation. |

These are configured build targets, not a clean-install support guarantee. There is no cross-platform installer. AppImage and Linux ARM are not initial targets.

## Install and offline behavior

The Windows installer uses Tauri's WebView2 bootstrapper. A machine without WebView2 may need an internet connection during installation. The current installer does not include the approximately 127 MB offline WebView2 installer. After install, the frontend, PDFium, Tesseract, and Fast/Best OCR data for English, Russian, Persian, and Simplified Chinese are bundled. Extraction does not download models or send document content to a remote service. See Tauri's [Windows installer modes](https://v2.tauri.app/distribute/windows-installer/) for current behavior and size tradeoffs.

Windows SmartScreen and macOS Gatekeeper can warn about or block these unsigned prereleases. Stable public distribution requires Windows code signing and macOS signing plus notarization. Linux packages target Ubuntu 24.04 and the GTK/WebKitGTK system libraries declared as package dependencies.

## Processing, fallback, and saved work

Desktop uses the bundled Rust provider by default for new jobs. The engine selector can choose browser processing for an individual job. The interface reports selected and used engines, available capabilities and IR version, and any fallback. If the Rust engine fails, the current uncommitted batch can fall back to browser extraction. User cancellation does not start a second extraction.

The browser and Desktop builds share frontend persistence code, but their WebView/browser profiles are separate. Checkpoints, preferences, and activity history use IndexedDB in the current profile. Export a workspace checkpoint to move it to another browser profile or installation; import it there explicitly. There is no automatic database bridge between Desktop and the browser. The PWA service worker is omitted from Desktop, whose frontend assets are embedded in the app.

Desktop runs bounded registered Tauri commands in-process. It has no local HTTP listener and the frontend is not granted general filesystem or shell access.

## Runtime resources

The target-specific resource tree includes:
- PDFium for the host target.
- Fast and Best OCR data for English, Russian, Persian, and Simplified Chinese.
- Native OCR libraries where required by the host.
- Project and upstream license notices, source/runtime manifests, file sizes, and SHA-256 checksums.

`prepare-runtime.mjs` downloads only pinned sources and verifies the PDFium archive and model revisions. The bundle step assembles host-native OCR libraries, writes the final manifest, and fails when required files, notices, or checksums are missing. Packaged-runtime release smoke checks run digital-text and raster-OCR extraction against the files staged from each platform installer.

Runtime paths are derived from the app resource directory, not the current working directory. `npm run desktop:prepare` reuses resources only when their target manifest and pinned file checksums match the current OS/architecture. If the manifest names another target, use a separate checkout for that OS; do not clean the other target's resources. If resources are incomplete or stale in a checkout dedicated to the current target, recover from the repository root with `npm run desktop:clean:runtime` followed by `npm run desktop:prepare`. The cleaner removes only recognized generated entries and refuses unknown contents.

Packaging relocates native libraries so installers do not depend on the build machine's library paths. The source manifest preserves PDFium's digest from the checksum-verified upstream archive; the assembled manifest separately records `pdfium.bundledFileSha256` after relocation and macOS ad hoc signing. Preparation accepts an assembled library only when its bundle digest and source provenance match, so a subsequent build can reuse verified resources without treating relocation as corruption. Validation checks both manifests and the actual installed or extracted runtime. macOS dependencies are collected recursively from the executable and PDFium's Mach-O references, including versioned Homebrew aliases, and every bundled library is checked for architecture, deployment minimum, and signature. The current Homebrew bottles come from macOS 15 runners; these packages do not claim macOS 12 compatibility.

## Local development

Use Node.js 22 and the Rust toolchain pinned in `companion/rust-toolchain.toml`. Keep a separate checkout for each OS target, including separate Windows and WSL/Linux checkouts: the optional Tauri CLI binding, generated runtime data, and native build outputs are host-specific. For WSL, keep the Linux checkout in the WSL filesystem, for example `~/src/glyph-mend`, rather than a Windows-mounted path such as `/mnt/f/Projects/glyph-mend`. Microsoft recommends keeping Linux-tool projects in the WSL filesystem for performance and to avoid cross-OS file handling ([Working across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems)). Install the platform prerequisites before starting the app.

### Windows

Install Microsoft C++ Build Tools with the **Desktop development with C++** workload, including the x64/x86 MSVC tools and a Windows SDK. This project builds `x86_64-pc-windows-msvc` and needs `link.exe` on `PATH`. Run the command from Developer PowerShell for Visual Studio. Windows development also requires Microsoft Edge WebView2. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows) and [Microsoft's MSVC Build Tools guide](https://learn.microsoft.com/en-us/cpp/overview/acquire-msvc?view=msvc-170).

### Ubuntu and WSL

Install the Linux packages used by the build and packaging workflow:

```bash
sudo apt-get update
sudo apt-get install -y build-essential curl wget file libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev libgtk-3-dev \
  libtesseract-dev libleptonica-dev libcurl4-openssl-dev pkg-config patchelf
```

See Tauri's [platform prerequisites](https://v2.tauri.app/start/prerequisites/) for the current host package requirements.

### macOS

Install Xcode Command Line Tools and native OCR build dependencies:

```bash
brew install tesseract leptonica pkg-config
```

### Commands

Run all npm commands from the repository root:

```bash
npm ci --include=optional
npm run dev:desktop
```

This is the single Desktop development command. It prepares the current OS's pinned runtime, then starts Tauri. The Tauri hooks set the repository root as their working directory: `beforeDevCommand` starts the shared Vite frontend in desktop mode at `http://127.0.0.1:1420`, `beforeBuildCommand` creates the production frontend through the desktop build helper, and `beforeBundleCommand` stages the prepared runtime. Development does not depend on a previously generated `dist` directory. Installer builds keep the production frontend path:

```bash
npm run build:desktop
```

For browser pairing with the local engine during development, use `npm run dev:companion`. For the installed app, start GlyphMend with the `--headless-companion` argument. The app hides its window, starts the existing loopback bridge, and opens the one-time pairing URL. To use browser-only mode, launch the browser app without pairing.

### Reported WSL2 issue

WSL2/WSLg is not visually verified. The reported commands ran from `/mnt/f/Projects/glyph-mend`, where runtime preparation found existing resources for another OS target; continuing with the direct `tauri dev` command bypassed that failed preparation. Use a separate WSL checkout under the Linux filesystem and the root `npm run dev:desktop` command, which prepares resources before launching and stops on a target mismatch. The Tauri launcher warns when it is run from a Windows-mounted WSL path.

The latest user-reported runs also showed a blank or gray window with `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `GDK_BACKEND=x11`. The Tauri dev launcher now detects WSL and sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` for that development session unless the caller already set the variable. Tauri documents this as an optional Wayland workaround that may resolve black WebKit views ([Linux distribution guide](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/distribute/flatpak.mdx#L356)); it has not yet been confirmed on this WSL setup. Run the single root command above and confirm that the GlyphMend interface renders. A successful process start is not a successful UI launch. Check WSLg, native Linux, and Windows separately.

## Release process

The only Actions workflow runs on manual dispatch; it has no automatic push, pull-request, schedule, or tag trigger. The `quick`, `full`, `benchmark`, and `release` modes are all explicit selections. In `release`, the quick web checks, Rust checks, and shared SemVer prerelease calculation run in parallel. Package jobs wait for those results, then build the browser artifact and four integrated Desktop installers, inspect package contents, and run both packaged-engine smoke cases per target. If all outputs succeed, the workflow creates one unsigned draft prerelease. It creates no standalone Companion packages and does not publish the draft automatically.

Stable distribution still requires signing/notarization and clean-machine validation of install, offline launch, restart, workspace recovery, and upgrade. See [distribution status](distribution-plan.md) and [the unified CI guide](ci.md).

## Related guides

- [Browser operations](browser.md)
- [Companion engine and loopback API](companion-engine.md)
- [Distribution status and release gates](distribution-plan.md)
- [Validation and release workflow](ci.md)
- [Compliance and data handling](compliance.md)
