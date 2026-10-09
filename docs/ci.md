# Validation and release workflow

## Workflow entry point

`.github/workflows/platform-ci.yml` is the repository's only GitHub Actions workflow, and it runs only when manually dispatched from the Actions page with **Run workflow**. It has no push, pull-request, schedule, or tag trigger. Every check, benchmark, and release is an explicit manual selection.

After pushing CI fixes, start a **new Run workflow** on `main`. GitHub's **Re-run jobs** keeps the original run's commit and workflow revision, so it cannot validate newer fixes. The run title includes its commit SHA. Compare that SHA with the completed revision you intend to validate. See [GitHub's re-run behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

Choose one mode:

| Mode | What it runs |
| --- | --- |
| `quick` | npm licensing and production dependency audit, lint, typecheck, generated-brand check, and browser and Desktop frontend builds. Manual `quick` also uploads the browser build. It does not install the Rust toolchain, run test suites, or create installers. |
| `full` | All quick checks, Rust formatting, Clippy, Tauri host compilation, Rust dependency policy, browser tests, Rust workspace and Companion integration tests, Tauri adapter/service tests, and native Tauri compilation checks across Windows x64, Ubuntu x64, macOS Intel, and Apple silicon. |
| `benchmark` | Repeated paired browser/Companion extraction measurements for the selected OCR model and repeat count. The benchmark preflight also runs the browser license, lint, typecheck, test, and build checks. |
| `release` | Runs workflow/script validation, quick web checks, Rust quality/compilation checks, and shared prerelease-version calculation, then creates the browser artifact and four integrated Desktop installers. No test suites run by default. Installed-package PDF/OCR smoke checks are optional through `release_smoke`. All successful package jobs feed one draft prerelease. |

None of the test suites run in `quick`. All four modes are manual selections; `full`, `benchmark`, and `release` are deliberately separate from the fast path. A workflow definition or local build is not evidence that a hosted run passed; inspect the run for the revision being considered.

### Release without tests

In Actions, select **Run workflow**, choose `release`, and leave **Run installed-package PDF and OCR smoke tests** (`release_smoke`) unchecked. The checkbox defaults to **false**. This skips installer installation/extraction/mounting and the native PDF/OCR test executable. It does not bypass lint, typecheck, dependency policy, Rust formatting/Clippy/compilation, builds, generated runtime checksums, notices, SBOMs, or release asset checksums. The draft release notes state whether smoke checks ran or were skipped.

To validate installed resources, enable `release_smoke` on a release run. Smoke commands use `cargo test --release` to reuse the packaging compilation profile. `full` remains the separate mode for browser, Rust, adapter, and integration test suites; the checkbox does not control those suites. Neither release setting runs the full suites.

### Cost controls and early failures

Every mode first validates all workflow definitions with pinned actionlint, syntax-checks the frontend/build/packaging scripts, and verifies that the compile-time OCR PDF fixture is present. Web checks precede Rust checks. Native release runners start only after version calculation, Rust checks, and browser packaging succeed. The release matrix cancels its remaining builds when one platform fails. Windows verifies copyright metadata immediately after dependency installation, before compiling Rust. No hosted run is automatically started by pushing these changes.

## Root npm workspace

Use Node.js 22 and run npm commands from the repository root. The root `package.json` and `package-lock.json` include the web frontend and Tauri build tools.

| Command | Purpose |
| --- | --- |
| `npm run ci:check:scripts` | Syntax-check frontend tooling and Desktop packaging scripts without running tests. Workflow YAML/shell linting runs separately through actionlint in CI. |
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

Release package jobs set `TARGET` to the matrix Rust triple. The Tauri launcher forwards that value to `tauri build --target` unless a target is already supplied; local builds use the prepared source manifest's target when `TARGET` is absent. The launcher rejects conflicting explicit and environment targets and passes the selected target to the build hooks. The executable, runtime assembly, and installer therefore all use `companion/target/<triple>/release`.

Runtime validation preserves the checksum-verified upstream PDFium digest separately from its relocated bundle digest. Both the prepared resources and the installed or extracted resources are checked. macOS packaging walks actual Mach-O dependencies recursively, includes their Homebrew license provenance, and ad hoc signs relocated libraries. The launcher selects the greater of the configured macOS floor and the host's complete `sw_vers -productVersion`, including its patch release. It passes that one value to `MACOSX_DEPLOYMENT_TARGET`, a Tauri `--config` override, and the runtime assembly hook. The runtime manifest records `macOS.minimumSystemVersion`; inspection verifies that it matches the app's `LSMinimumSystemVersion`. Libraries requiring a newer version still fail validation. This deliberately conservative policy does not claim that bottles built on 15.7.5 work on 15.0. Supporting earlier releases requires a controlled native dependency build for that target.

The shared extractor build script links `xmllite`, `iphlpapi`, `crypt32`, and `secur32` on Windows. Static libarchive and libcurl reference those Windows SDK APIs, but the Rust vcpkg discovery path does not automatically include these import libraries. Placing the fix in the extractor applies it to the Desktop app, Companion CLI, and test executables.

Windows native notices come from the installed-package records in `installed/vcpkg/status`, filtered to the build triplet, rather than from every folder in `share`. Generic `share/doc` and `share/pkgconfig` directories, feature paragraphs, uninstalled packages, and other triplets are excluded. Every real package must still have a nonempty copyright notice. The inventory records package versions and port revisions.

PDFium 0.9 permits one library binding per process. The extractor serializes initialization and lets subsequent providers reuse that same canonical library path. A missing bundled library or a request to switch to a different runtime still fails. The checked-in `companion/apps/companion-tauri/src-tauri/tests/ocr-smoke.pdf` uses readable rasterized **DOCUMENT OCR CHECK 12345**, with no PDF text layer or embedded font. Smoke checks require OCR to recover `DOCUMENT` and `12345` without an OCR error. This replaces the custom block-letter fixture that was read as `MEMO` on one runner. The optional `generate-ocr-smoke.py` script regenerates the fixture with Pillow and an explicitly supplied Arial font; fixture generation is not part of CI.

Browser, Rust, and Homebrew notice collectors share `web-app/scripts/spdx-license-text.mjs`. It downloads complete license and exception texts from an immutable official SPDX license-list-data commit, caches successful texts per process, and retries transient HTTP/network failures. It does not depend on missing or redirected `spdx.org/licenses/*.txt` pages. Native formula license files are copied first; canonical SPDX text supplies missing license files. Unknown identifiers and invalid responses fail packaging rather than silently dropping notices. Update `SPDX_DATA_COMMIT` deliberately when a dependency requires newer SPDX data.

## Manual full validation

The `full` mode runs the Rust quality and host compilation checks alongside the retained browser tests, focused packaging integrity/dependency regression tests, Rust workspace tests, browser-to-Companion runtime integration, Tauri adapter tests, Tauri service and bounded-IPC tests, and native target compilation. Run it manually when a change needs broad validation. The four-platform job builds the native host without producing installers.

The `benchmark` mode runs the paired six-document corpus with the selected number of repetitions and OCR model, then uploads raw and evaluated evidence. Its runner performs browser license, lint, typecheck, test, and production-build preflight checks before measuring. A benchmark is measurement evidence, not a product performance claim. Stable Rust-provider promotion requires the checked-in promotion gate and browser regression evidence for every corpus class.

## Review of Actions run 37810064919

The [reviewed workflow run](https://github.com/tahamoeini/glyph-mend/actions/runs/37810064919) ran the earlier release workflow definitions. The authenticated Actions job logs show that validation succeeded, browser packaging failed, and the Ubuntu and both macOS Desktop package jobs failed. The Windows package jobs and draft-release job were cancelled before completion, so they were not verified as passing or failing.

- Browser packaging tried to copy `web-app/DEPENDENCIES.md`, which was not generated. Release packaging now generates and checks the report with `web-app/scripts/license-report.mjs --check` before assembling the browser archive.
- The raster-only OCR smoke failed on Ubuntu and both macOS architectures even though digital-text extraction passed. Later supplied logs exposed two separate issues: repeated initialization of PDFium's process-global bindings, and misrecognition of the hand-drawn block letters. The extractor now reuses its verified binding and the smoke consumes the readable raster fixture described above. Local verification and a hosted release run are separate evidence; the current native installers still require revision-specific hosted validation.
- The browser job failed at its package assembly step, before SBOM generation and artifact upload. The Ubuntu standalone Companion package did succeed; the Windows Companion jobs, Windows Desktop package, and draft-release gate were cancelled before completion. The run did not create a release.
- The run warned that `actions/upload-artifact` v4.6.2 still targeted Node.js 20 and was being forced onto Node.js 24. The consolidated workflow now pins upload-artifact v7.0.0 for browser, benchmark, and release artifacts.

The previous workflow produced separate Companion and Desktop package sets. Those workflows are removed; the consolidated release produces the browser package and one integrated Desktop installer per configured target. The reviewed run is historical evidence for that earlier workflow only; a successful run of the current revision is still required to confirm current release packaging and smoke checks.

## Versioned release

Manually dispatch `platform-ci.yml` from the default branch and select `release`. Choose whether to enable `release_smoke`; its default is false. Workflow/script validation precedes web checks, and Rust checks follow successful web checks. Native package jobs also wait for version calculation and browser packaging. Run `npm run release:next-version` locally to preview the version. The script uses the highest valid `glyphmend-v*` tag after the first unified release. Until that tag exists, it uses the root package version as the baseline and includes the commit that first introduced the root package; old `companion-v*` tags are excluded because they versioned the separate engine, not this unified app.

Version impact follows Conventional Commits:

Use commit subjects in the form `<type>(optional-scope)!: summary`. For example, `feat(desktop): bundle the local engine`, `fix(ci): preserve the browser dependency report`, or `chore(docs): clarify manual validation`. A breaking change may use `!` after its type or a `BREAKING CHANGE:` footer.

- Breaking-change markers produce a major increment.
- `feat` produces a minor increment.
- `fix` and `perf` produce a patch increment.
- `build`, `chore`, `ci`, `docs`, `refactor`, `revert`, `style`, and `test` do not increment the version by themselves.
- Unrecognized or nonconventional commit messages default to the `feat` increment. If there are no release-bearing commits, version calculation stops with an error.

The browser artifact includes the static site, license text, generated dependency report, third-party notices, checksum, SPDX SBOM, and provenance. Before SBOM generation, the release workflow synchronizes the calculated version across the root manifest, browser manifest, and root lockfile. Desktop jobs produce Windows x64 NSIS, Ubuntu 24.04 x64 `.deb`, macOS Intel `.dmg`, and Apple silicon `.dmg` packages with the same version. When `release_smoke` is enabled, each Desktop job additionally inspects installed/extracted resources and runs digital-text plus raster-OCR extraction against them. One unsigned draft prerelease is created only after every package job succeeds; it is not published automatically. Skipping smoke checks is recorded in its notes.

Stable distribution still requires Windows code signing, macOS signing and notarization, and clean-machine install and upgrade validation. Windows installation may need network access to obtain WebView2 when it is absent. See [distribution status](distribution-plan.md).

Checksum files use unique names (`SHA256SUMS-browser.txt` and `SHA256SUMS-<platform>.txt`) so all assets can be attached to one release without filename collisions. Each file checksums that distribution's archive or installer and SPDX SBOM using their release filenames, with no build-directory prefix. Download those assets together and run `sha256sum --check SHA256SUMS-<platform>.txt` on Linux or `shasum -a 256 --check SHA256SUMS-<platform>.txt` on macOS.

## Updating dependencies and runtime data

- **JavaScript:** update the relevant workspace manifest and regenerate the root `package-lock.json`. Run the license and production dependency checks manually.
- **Rust:** update the relevant manifest and `companion/Cargo.lock`; preserve the pinned toolchain and resolve `cargo deny check` findings deliberately.
- **PDFium and OCR models:** update the pins and hashes in the Desktop runtime preparation script, then regenerate notices and manifests through packaging.
- **Extraction semantics:** review `EXTRACTION_VERSION` and checkpoint invalidation in `web-app/src/app.js` when changing extraction behavior or cached result compatibility.
- **Branding:** edit root `branding.json` and source assets, then run `npm run brand:sync`.
