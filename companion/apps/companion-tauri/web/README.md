# GlyphMend Tauri host

This host packages the shared GlyphMend interface and initializes the Rust job service with the bundled PDFium/Tesseract provider.

- Normal launch shows the Desktop interface and calls the engine through bounded Tauri IPC.
- Launch with `--headless-companion` hides the interface window, starts the loopback bridge, and opens the browser pairing URL.
- Browser-only mode requires neither launch mode.

All modes use the same frontend contract, engine capabilities, IR validation, browser provider fallback, and exports. There is no separate Companion package.

See the [Desktop guide](../../../../docs/desktop.md) for native requirements, development, runtime preparation, package targets, and outstanding WSLg status. See [distribution status](../../../../docs/distribution-plan.md) and the [unified workflow](../../../../docs/ci.md) for release outputs and validation modes.

From the repository root, install the shared npm workspaces and start the normal Desktop mode:

```bash
npm ci --include=optional
npm run dev:desktop
```

Use `npm run dev:companion` for headless browser pairing. The Desktop development config serves the shared Vite frontend at `http://127.0.0.1:1420`; installer builds still bundle the production frontend. Keep one checkout per OS target. A WSL checkout belongs under its Linux filesystem, such as `~/src/glyph-mend`, rather than `/mnt/<drive>`. The root `npm run build:desktop` command creates an installer. For incomplete resources in a target-specific checkout, runtime recovery uses `npm run desktop:clean:runtime` followed by `npm run desktop:prepare`; if the manifest names another target, use that target's separate checkout instead of cleaning it.

WSL2/WSLg still has a reported blank/gray window and is not visually verified. The Tauri dev launcher applies `WEBKIT_DISABLE_COMPOSITING_MODE=1` in WSL unless overridden; see the [known issue and status](../../../../docs/desktop.md#reported-wsl2-issue).

The IPC adapter sends at most 64 KiB per part and the Rust boundary caps each assembled input chunk at 1 MiB, limits incomplete assemblies, validates job identifiers, and delegates job lifecycle and IR validation to `companion-service`.
