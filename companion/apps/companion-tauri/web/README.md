# GlyphMend Desktop Tauri host

This host packages the normal GlyphMend interface and initializes the shared Rust job service with the bundled PDFium/Tesseract provider. It calls bounded registered Tauri commands directly; it does not start the standalone Companion's loopback server. Browser extraction remains available from the Desktop interface.

See the [GlyphMend Desktop guide](../../../../docs/desktop.md) for native requirements, local development, resource preparation, package targets, and release gates. See the [distribution plan](../../../../docs/distribution-plan.md) for audit decisions and pending validation.

From the repository root, build the Desktop web frontend and check the Tauri IPC adapter with:

```bash
cd web-app
npm ci
npm run build:desktop

cd ../companion/apps/companion-tauri/web
npm ci
npm run icon
node --test src/tauri-adapter.test.mjs
```

For native app development, install the OS-specific Tauri/WebView and Tesseract/Leptonica prerequisites, prepare `runtime/` resources, then run `npm run tauri -- dev`. `npm run tauri -- build` creates a native bundle only when the runtime resource validator passes.

The IPC adapter sends at most 64 KiB per part and the Rust boundary caps each assembled input chunk at 1 MiB, limits incomplete assemblies, validates job identifiers, and delegates job lifecycle and IR validation to `companion-service`.
