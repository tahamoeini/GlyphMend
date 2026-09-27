# Companion benchmark corpus

`corpus/manifest.json` identifies six synthetic, CC0 PDFs: text-heavy, scanned English, multi-column, table, equation, and image-heavy. Hand-authored text and structure labels are recorded before extractor output is evaluated. Each entry includes the PDF SHA-256.

Recreate and validate the fixtures from the repository root:

```sh
node companion/benchmarks/generate-corpus.mjs
node companion/benchmarks/check-corpus.mjs
```

Run every fixture at least three times in browser and Companion modes on the same machine. Keep Fast and High Accuracy OCR runs separate. Each raw run records corpus and document hashes, engine/build versions, platform, browser version, OCR mode, page count, elapsed latency, peak resident memory, recognized text, reading order, structure labels, and fallback details.

Save raw runs as JSON with the corpus manifest digest, environment versions, browser-regression evidence, and one record per document/mode/repeat. Each record contains the fixture ID and hash, `recognizedText`, ordered text lines, structure labels, elapsed milliseconds, and peak memory in MiB. The evaluator computes character error rate, word error rate, normalized reading-order edit error, and structure F1 from the manifest labels, then carries latency and peak memory into the paired report.

Create a promotion report with:

```sh
node companion/benchmarks/evaluate-results.mjs raw-runs.json results/stable-promotion.json
node companion/benchmarks/check-stable-promotion.mjs results/stable-promotion.json
```

Stable promotion requires at least three paired measurements per class, finite latency and memory values for both modes, a quality improvement in at least two thirds of paired runs for at least one quality measure per class, and recorded passing browser-regression evidence for every class. The workflow fails closed if evidence is absent or does not match the corpus manifest. No benchmark result or performance claim is included until these measurements have actually been run. The initial release is a prerelease.
