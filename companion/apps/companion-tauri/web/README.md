# GlyphMend Desktop Tauri host

This host packages the normal GlyphMend interface and initializes the shared Rust job service with the bundled PDFium/Tesseract provider. It calls bounded registered Tauri commands directly; it does not start the standalone Companion's loopback server. Browser extraction remains available from the Desktop interface.

See the [GlyphMend Desktop guide](../../../../docs/desktop.md) for native requirements, local development, resource preparation, package targets, and release gates. See the [distribution status](../../../../docs/distribution-plan.md) for configured targets and remaining release evidence.

Use Node.js 22 and the Rust toolchain pinned in `companion/rust-toolchain.toml`. From the repository root, install the shared npm workspace and run the Desktop commands:

```bash
npm ci --include=optional
npm run dev:desktop
```

Use a separate checkout for each OS, including Windows and WSL. Install the OS-specific Tauri/WebView and Tesseract/Leptonica prerequisites before running the single development command. The root `npm run build:desktop` command creates a native installer; `npm run desktop:prepare` prepares resources and `npm run desktop:clean:runtime` clears recognized generated files when recovery is needed. IPC adapter and Rust service tests run in the manual full-validation workflow.

WSL2/WSLg currently has an unresolved reported blank/gray window after launch, including with the attempted WebKit DMA-BUF and X11 settings. See the [known issue and status](../../../../docs/desktop.md#known-wsl2-development-issue); do not treat process startup as proof that the UI rendered.

The IPC adapter sends at most 64 KiB per part and the Rust boundary caps each assembled input chunk at 1 MiB, limits incomplete assemblies, validates job identifiers, and delegates job lifecycle and IR validation to `companion-service`.
