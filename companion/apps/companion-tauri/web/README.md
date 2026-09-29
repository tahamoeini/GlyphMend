# Optional Tauri desktop shell

Tauri is an experimental desktop wrapper around the same browser application and Rust Companion service. The supported installable Companion remains the CLI release; Tauri is kept out of normal CI and public release packaging.

From the repository root, assemble and compile it with:

    node companion/apps/companion-tauri/web/build-tauri.mjs
    cd companion
    cargo check -p companion-tauri

The build script runs the normal web production build, copies that output into this target, and inserts the local IPC adapter before the application modules. The adapter accesses only registered Companion commands and splits each 1 MiB document upload chunk into 64 KiB IPC messages. bundle.active remains disabled until desktop packaging, runtime bundling, signing, and notarization are separately ready.

The manual GitHub Actions workflow validates the web assembly and Rust target on Windows, macOS, and Linux. It runs only when dispatched from the Actions page.
