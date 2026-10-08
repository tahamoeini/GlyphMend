# CI/CD and releases

## Workflow model

`.github/workflows/platform-ci.yml` is the single CI entry point. Pull requests and pushes to `main` run lightweight licensing and dependency checks, lint, typecheck, browser and Desktop frontend builds, Rust formatting, Clippy, compilation, and Cargo dependency policy checks. The automatic path does not run test suites or a native four-platform build matrix.

Manual dispatch offers three modes:

| Mode | Runs |
| --- | --- |
| `quick` | The same lightweight checks used for pull requests and pushes, with the browser build artifact uploaded. |
| `full` | The lightweight checks, browser tests, Rust workspace tests, Tauri adapter and service tests, browser-to-Companion integration, and native compilation checks across the supported Desktop targets. |
| `benchmark` | The paired browser/Companion benchmark with selected repeat count and OCR model. Before measurement, its runner also executes browser license, lint, typecheck, test, and production-build checks. |

No test suite runs on pull requests or pushes to `main`. The `full` mode runs the complete moved validation set; `benchmark` is also manually selected and runs the browser test suite as a benchmark preflight. A workflow definition is not evidence of a successful run; review the Actions run for the revision under consideration.

## Root npm workspace

Use Node.js 22 and run npm commands from the repository root. `package.json` and the root `package-lock.json` cover both `web-app` and the Tauri build tools. For Desktop, install optional platform dependencies with `npm ci --include=optional` and keep a separate checkout for each OS target, including Windows and WSL.

~~~bash
npm ci
npm run dev:web
npm run build:web
npm run lint
npm run typecheck
~~~

`npm run build:web` synchronizes branding, verifies browser-only build boundaries and MuPDF assets, then creates `web-app/dist`. Deploying that directory to the public site is a separate operation.

For Desktop development and packaging:

~~~bash
npm ci --include=optional
npm run dev:desktop
npm run build:desktop
~~~

`dev:desktop` prepares the target's pinned local runtime and starts the shared Vite UI at the Tauri development URL. `build:desktop` keeps the production frontend bundling path and creates the platform installer. Root commands:

| Command | Purpose |
| --- | --- |
| `npm run dev:web` | Run the browser/PWA development server. |
| `npm run build:web` | Build and verify the browser/PWA in `web-app/dist`. |
| `npm run dev:desktop` | Prepare host runtime resources and start the Tauri app with the shared Vite UI. |
| `npm run build:desktop` | Prepare resources and notices, build the production Desktop frontend, package the native installer, and verify runtime manifests. |
| `npm run build:desktop:web` | Build only the desktop-mode frontend for Tauri. |
| `npm run desktop:prepare` | Fetch and verify pinned PDFium and OCR model resources for the current OS checkout. |
| `npm run desktop:clean:runtime` | Remove recognized generated runtime data; refuses unrecognized top-level entries. |
| `npm run desktop:verify:runtime` | Verify the prepared/assembled resources and their checksums. |
| `npm run desktop:licenses` | Collect browser and Rust dependency notices for the Desktop package. |
| `npm run desktop:icon` | Regenerate Tauri platform icons from the brand source asset. |
| `npm run brand:sync` | Regenerate browser brand assets and PWA metadata from `branding.json`. |
| `npm run lint` / `npm run typecheck` | Run the browser source quality checks. |
| `npm run test` | Run the browser test suite locally; CI runs it only in manually selected modes. |
| `npm run license:check` | Check browser dependency licensing against the root lockfile. |

See the [Desktop guide](desktop.md) for native prerequisites, the unresolved WSL2 rendering issue, and runtime recovery.

## Manual full validation and benchmarks

The `full` mode runs `npm test`, `cargo test --workspace --exclude companion-tauri`, the browser-to-Companion runtime integration, `node --test` for the Tauri adapter, and Tauri service/IPC tests. It also compiles the native Desktop host on Windows x64, Ubuntu x64, macOS Intel, and Apple silicon. This heavier work is intentionally user-selected rather than part of routine pull-request CI. The separate `benchmark` mode also runs the browser license, lint, typecheck, test, and build checks before it measures the six-document corpus.

The `benchmark` mode repeats paired measurements on the labeled six-document corpus and uploads raw/evaluated evidence. It is a manual measurement, not a release claim. Stable Companion promotion remains blocked until repeated, reproducible results and browser regression evidence pass the checked-in gate.

## Versioned release

Manually dispatch `.github/workflows/platform-release.yml` from `main` and provide one prerelease version, such as `2.1.0-beta.1`. This is the only user-facing release entry point. It builds the browser distribution, six standalone Companion packages, and four Desktop installers in parallel; reusable Companion and Desktop packaging workflows are called internally. The Desktop job validates packaged runtimes with native digital-PDF and raster-only-PDF extraction smoke tests and checks installer contents. The parent then creates one unsigned draft prerelease tagged `glyphmend-v<version>`. Assets include checksums, product notices, SPDX SBOMs, and provenance attestations. The draft remains unpublished until a maintainer reviews and publishes it.

The Windows installer uses the WebView2 bootstrapper and may need network access when WebView2 is absent. Stable public distribution requires code signing on Windows, signing and notarization on macOS, and clean-machine validation. See [distribution status](distribution-plan.md).

## Dependency and extraction upgrades

- **JavaScript packages:** update the relevant workspace `package.json` and regenerate the single root `package-lock.json`; run the license and dependency checks.
- **Rust crates:** update the relevant Cargo.toml and Cargo.lock; keep the pinned toolchain intentional and run `cargo deny check`.
- **PDFium and OCR models:** the Desktop runtime preparation script is the pin/hash source of truth. Update its pins deliberately and regenerate notices and runtime manifests through packaging.
- **Extraction behavior:** when changing extraction semantics or cached result compatibility, review `EXTRACTION_VERSION` and checkpoint invalidation in `web-app/src/app.js`. Do not bump it for unrelated UI changes.
- **Branding:** edit root `branding.json` and source assets, then use `npm run brand:sync` (the frontend lifecycle scripts also run it automatically).
