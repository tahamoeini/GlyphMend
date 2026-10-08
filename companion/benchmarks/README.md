# Companion benchmark corpus

The checked-in manifest identifies six synthetic, CC0 PDFs: text-heavy, scanned English, multi-column, table, equation, and image-heavy. Hand-authored text and structure labels are recorded before extractor output is evaluated. Each entry includes the PDF SHA-256.

Recreate and validate the fixtures from the repository root:

    node companion/benchmarks/generate-corpus.mjs
    node companion/benchmarks/check-corpus.mjs

## Repeatable paired runs

The paired runner needs Node.js 22+, Chromium with its OS libraries, the Companion CLI, PDFium beside the CLI, and the selected English OCR model under tessdata/fast or tessdata/best. Set CHROME_BIN, GLYPHMEND_COMPANION, or GLYPHMEND_TESSDATA_DIR when those are outside the usual locations. The runner executes the browser license check, lint, typecheck, test suite, and production build before it measures extraction.

From the repository root, run:

    node companion/benchmarks/run-benchmarks.mjs --repeats 3 --ocr-accuracy fast --output /tmp/glyphmend-fast-raw.json

Repeat with --ocr-accuracy high-accuracy to produce a separate Best-model dataset. Each run uses identical PDF bytes in both engines, alternates engine order by repeat, records engine and model hashes, per-page fallback details, character and word error, reading order, structure labels, elapsed extraction time, and peak process-tree RSS memory. The browser platform currently uses its bundled English best_int OCR model; that model identity is recorded separately from the selected Companion model. Treat those as distinct configurations when interpreting results.

Select `benchmark` in `.github/workflows/platform-ci.yml` to run the paired benchmark manually. It installs the pinned Linux runtimes and uploads raw and evaluated results as a workflow artifact; it does not run on pushes or pull requests.

## Browser-only baseline

If Companion native libraries or OCR models are unavailable locally, run browser-only regression and quality evidence across the same corpus:

    node companion/benchmarks/run-benchmarks.mjs --browser-only --repeats 3 --output /tmp/glyphmend-browser-smoke.json
    node companion/benchmarks/evaluate-results.mjs /tmp/glyphmend-browser-smoke.json /tmp/glyphmend-browser-smoke-report.json

This report includes OCR character/word error, reading-order error, structure F1, latency, and peak Chromium process-tree memory by class. It is not paired Companion evidence and cannot pass the stable-promotion gate. Peak memory includes Chromium's baseline process tree, so compare it only against a paired run using the same browser and measurement setup.

Evaluate raw runs with:

    node companion/benchmarks/evaluate-results.mjs /tmp/glyphmend-fast-raw.json /tmp/glyphmend-fast-report.json

The report includes per-class medians as well as every paired measurement. Stable promotion requires at least three paired measurements per class, finite latency and memory values for both modes, a quality improvement in at least two thirds of paired runs for at least one quality measure per class, and recorded passing browser-regression evidence for every class:

    node companion/benchmarks/check-stable-promotion.mjs /tmp/glyphmend-fast-report.json

The gate fails closed if evidence is absent or does not match the corpus manifest. A benchmark run is evidence, not a performance claim; publish claims only for classes and configurations that show repeatable measured improvements with no browser regression. The initial Companion release is a prerelease.
