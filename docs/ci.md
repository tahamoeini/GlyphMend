# Validation and release workflow

## Workflow entry point

`.github/workflows/platform-ci.yml` is the repository's only GitHub Actions workflow, and it runs only when manually dispatched from the Actions page with **Run workflow**. It has no push, pull-request, schedule, or tag trigger. Every check, benchmark, and release is an explicit manual selection.

Choose one mode:

| Mode | What it runs |
| --- | --- |
| `quick` | npm licensing and production dependency audit, lint, typecheck, generated-brand check, and browser and Desktop frontend builds. Manual `quick` also uploads the browser build. It does not install the Rust toolchain, run test suites, or create installers. |
| `full` | All quick checks, Rust formatting, Clippy, Tauri host compilation, Rust dependency policy, browser tests, Rust workspace and Companion integration tests, Tauri adapter/service tests, and native Tauri compilation checks across Windows x64, Ubuntu x64, macOS Intel, and Apple silicon. |
| `benchmark` | Repeated paired browser/Companion extraction measurements for the selected OCR model and repeat count. The benchmark preflight also runs the browser license, lint, typecheck, test, and build checks. |
| `release` | Runs the quick web and Rust checks alongside shared prerelease-version calculation. Package jobs wait for those checks and the version, build the browser artifact and four integrated Desktop installers, and smoke-test each packaged native engine before creating one draft GitHub prerelease. |

None of the test suites run in `quick`. All four modes are manual selections; `full`, `benchmark`, and `release` are deliberately separate from the fast path. A workflow definition or local build is not evidence that a hosted run passed; inspect the run for the revision being considered.

## Root npm workspace

Use Node.js 22 and run npm commands from the repository root. The root `package.json` and `package-lock.json` include the web frontend and Tauri build tools.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the shared JavaScript workspaces for browser work. |
| `npm ci --include=optional` | Install the host's optional Tauri CLI package for Desktop work. Keep one checkout per OS target. For WSL, use a checkout under the Linux filesystem, not `/mnt/<drive>`. |
| `npm run dev:web` | Start the browser/PWA Vite server. |
| `npm run build:web` | Build and verify the browser/PWA in `web-app/dist`. |
| `npm run dev:desktop` | Prepare pinned host resources and start the shared frontend inside Tauri using the loopback Vite dev server. |
| `npm run dev:companion` | Start the same Tauri app in headless Companion mode, paired to the local desktop-mode Vite origin. |
| `npm run build:desktop:web` | Build only the Desktop-mode frontend. |
| `npm run build:desktop` | Prepare resources and notices, build the production frontend, create a native installer, and verify its runtime manifest. |
| `npm run desktop:prepare` | Fetch and verify the pinned PDFium and OCR model resources for the current OS. |
| `npm run desktop:clean:runtime` | Reset stale runtime data in a checkout dedicated to the current OS/architecture target. Use a separate checkout for another target. |
| `npm run desktop:verify:runtime` | Validate the prepared runtime files, target, manifest, and checksums. |
| `npm run desktop:licenses` | Collect browser and Rust dependency notices for the Desktop package. |
| `npm run desktop:icon` | Regenerate Tauri platform icons from the brand source asset. |
| `npm run lint` / `npm run typecheck` | Check browser source quality and types. |
| `npm test` | Run the browser test suite locally. In GitHub Actions it runs only in `full` or the benchmark preflight. |
| `npm run license:check` | Check browser dependency licensing against the shared lockfile. |
| `npm run release:next-version` | Print the next shared SemVer prerelease from version tags and commit history. |

The Desktop development command uses `devUrl` at `http://127.0.0.1:1420`. Tauri's `beforeDevCommand` starts the shared Vite app in desktop mode. Installer builds continue to use the bundled production frontend. The dev launcher also applies Tauri's optional WebKit compositor workaround only for WSL sessions. See the [Desktop guide](desktop.md) for native prerequisites, runtime recovery, and the reported WSL2 blank-window issue.

Release package jobs set `TARGET` to the matrix Rust triple. The Tauri launcher forwards that value to `tauri build --target` unless a target is already supplied, so the executable, runtime assembly, and installer all use `companion/target/<triple>/release`.

## Manual full validation

The `full` mode runs the Rust quality and host compilation checks alongside the retained browser tests, Rust workspace tests, browser-to-Companion runtime integration, Tauri adapter tests, Tauri service and bounded-IPC tests, and native target compilation. Run it manually when a change needs broad validation. The four-platform job builds the native host without producing installers.

The `benchmark` mode runs the paired six-document corpus with the selected number of repetitions and OCR model, then uploads raw and evaluated evidence. Its runner performs browser license, lint, typecheck, test, and production-build preflight checks before measuring. A benchmark is measurement evidence, not a product performance claim. Stable Rust-provider promotion requires the checked-in promotion gate and browser regression evidence for every corpus class.

## Review of Actions run 37810064919

The [reviewed workflow run](https://github.com/tahamoeini/glyph-mend/actions/runs/37810064919) ran the earlier release workflow definitions. The authenticated Actions job logs show that validation succeeded, browser packaging failed, and the Ubuntu and both macOS Desktop package jobs failed. The Windows package jobs and draft-release job were cancelled before completion, so they were not verified as passing or failing.

- Browser packaging tried to copy `web-app/DEPENDENCIES.md`, which was not generated. Release packaging now generates and checks the report with `web-app/scripts/license-report.mjs --check` before assembling the browser archive.
- The raster-only OCR runtime smoke failed on Ubuntu and both macOS architectures even though digital-text extraction passed. The macOS OCR output was `ISL YPAMEND`, which recovered the final `MEND` portion but not the entire custom bitmap word; the Ubuntu job ended with a failed extraction state, and its old test did not print the service events needed to explain that state. The current smoke uses the shorter raster token `MEND` and prints terminal service events and fallback diagnostics on failure. That adjustment has not yet passed in a hosted run. If it passes, it confirms recovery of this smoke token from a raster page; benchmark runs remain the evidence for accuracy. A successful release run is still required to verify the adjustment on every target.
- The browser job failed at its package assembly step, before SBOM generation and artifact upload. The Ubuntu standalone Companion package did succeed; the Windows Companion jobs, Windows Desktop package, and draft-release gate were cancelled before completion. The run did not create a release.
- The run warned that `actions/upload-artifact` v4.6.2 still targeted Node.js 20 and was being forced onto Node.js 24. The consolidated workflow now pins upload-artifact v7.0.0 for browser, benchmark, and release artifacts.

The previous workflow produced separate Companion and Desktop package sets. Those workflows are removed; the consolidated release produces the browser package and one integrated Desktop installer per configured target. The reviewed run is historical evidence for that earlier workflow only; a successful run of the current revision is still required to confirm current release packaging and smoke checks.

## Versioned release

Manually dispatch `platform-ci.yml` from the default branch and select `release`. The workflow runs the quick web checks, Rust quality/compilation checks, and next-version calculation in parallel. Package jobs wait for the checks and version. Run `npm run release:next-version` locally to preview it. The script uses the highest valid `glyphmend-v*` tag after the first unified release. Until that tag exists, it uses the root package version as the baseline and includes the commit that first introduced the root package; old `companion-v*` tags are excluded because they versioned the separate engine, not this unified app.

Version impact follows Conventional Commits:

Use commit subjects in the form `<type>(optional-scope)!: summary`. For example, `feat(desktop): bundle the local engine`, `fix(ci): preserve the browser dependency report`, or `chore(docs): clarify manual validation`. A breaking change may use `!` after its type or a `BREAKING CHANGE:` footer.

- Breaking-change markers produce a major increment.
- `feat` produces a minor increment.
- `fix` and `perf` produce a patch increment.
- `build`, `chore`, `ci`, `docs`, `refactor`, `revert`, `style`, and `test` do not increment the version by themselves.
- Unrecognized or nonconventional commit messages default to the `feat` increment. If there are no release-bearing commits, version calculation stops with an error.

The browser artifact includes the static site, license text, generated dependency report, third-party notices, checksum, SPDX SBOM, and provenance. Before SBOM generation, the release workflow synchronizes the calculated version across the root manifest, browser manifest, and root lockfile. Desktop jobs produce Windows x64 NSIS, Ubuntu 24.04 x64 `.deb`, macOS Intel `.dmg`, and Apple silicon `.dmg` packages with the same version. Each Desktop job inspects the packaged resources and runs digital-text plus raster-OCR extraction smoke checks against those packaged resources. One unsigned draft prerelease is created only after every package job succeeds; it is not published automatically.

Stable distribution still requires Windows code signing, macOS signing and notarization, and clean-machine install and upgrade validation. Windows installation may need network access to obtain WebView2 when it is absent. See [distribution status](distribution-plan.md).

## Updating dependencies and runtime data

- **JavaScript:** update the relevant workspace manifest and regenerate the root `package-lock.json`. Run the license and production dependency checks manually.
- **Rust:** update the relevant manifest and `companion/Cargo.lock`; preserve the pinned toolchain and resolve `cargo deny check` findings deliberately.
- **PDFium and OCR models:** update the pins and hashes in the Desktop runtime preparation script, then regenerate notices and manifests through packaging.
- **Extraction semantics:** review `EXTRACTION_VERSION` and checkpoint invalidation in `web-app/src/app.js` when changing extraction behavior or cached result compatibility.
- **Branding:** edit root `branding.json` and source assets, then run `npm run brand:sync`.
