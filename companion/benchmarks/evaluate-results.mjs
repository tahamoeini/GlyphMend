import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node companion/benchmarks/evaluate-results.mjs raw-runs.json results.json');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const classNames = ['text-heavy', 'scanned-english', 'multi-column', 'table', 'equation', 'image-heavy'];
const manifestPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus/manifest.json');
const manifestBytes = fs.readFileSync(manifestPath);
const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
const manifest = JSON.parse(manifestBytes);
const errors = [];
if (raw.schemaVersion !== 1) errors.push('raw run schemaVersion must be 1');
if (raw.corpusManifestSha256 !== manifestHash) errors.push('raw run corpus hash does not match the checked-in manifest');
const seenRunKeys = new Set();
for (const run of raw.runs ?? []) {
  const gold = manifest.documents.find((document) => document.documentClass === run.documentClass);
  const key = [run.documentClass, run.repeat, run.mode].join(':');
  if (!gold) {
    errors.push('raw run contains an unknown document class: ' + run.documentClass);
    continue;
  }
  if (seenRunKeys.has(key)) errors.push('raw run contains a duplicate record: ' + key);
  seenRunKeys.add(key);
  if (run.documentId !== gold.id) errors.push(key + ': documentId does not match the labeled fixture');
  if (!Number.isInteger(run.repeat) || run.repeat < 1) errors.push(key + ': repeat must be a positive integer');
  if (!['browser', 'companion'].includes(run.mode)) errors.push(key + ': mode must be browser or companion');
  if (!run.engineVersion || typeof run.engineVersion !== 'string') errors.push(key + ': engineVersion is required');
  if (run.pageCount !== gold.pages) errors.push(key + ': pageCount does not match the labeled fixture');
  if (!Array.isArray(run.fallbackDetails)) errors.push(key + ': per-page fallbackDetails are required');
}
if (!Array.isArray(raw.browserRegression?.checkedClasses)
  || classNames.some((name) => !raw.browserRegression.checkedClasses.includes(name))) {
  errors.push('browser-regression evidence must cover all six labeled classes');
}
if (!raw.environment?.platform || !raw.environment?.browserVersion || !raw.environment?.companionVersion) errors.push('platform, browser version, and Companion version are required');
if (raw.browserRegression?.passed !== true || !raw.browserRegression?.evidence) errors.push('passing browser-regression evidence is required');

function normalize(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
}

function editDistance(left, right) {
  if (left.length * right.length > 5_000_000) throw new RangeError('an evaluation string exceeds the comparison work limit');
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function errorRate(expected, actual) {
  const gold = normalize(expected);
  const recognized = normalize(actual);
  if (!gold.length) return recognized.length ? 1 : 0;
  return editDistance([...gold], [...recognized]) / [...gold].length;
}

function wordErrorRate(expectedText, actualText) {
  const expected = normalize(expectedText).split(' ').filter(Boolean);
  const actual = normalize(actualText).split(' ').filter(Boolean);
  if (!expected.length) return actual.length ? 1 : 0;
  return editDistance(expected, actual) / expected.length;
}

function readingOrderError(expectedLines, actualLines) {
  const expected = expectedLines.map(normalize);
  const actual = actualLines.map((line) => normalize(line));
  const indexes = actual.map((line, actualIndex) => {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < expected.length; index += 1) {
      const distance = errorRate(expected[index], line);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }
    return bestDistance <= 0.65 ? bestIndex : expected.length + actualIndex;
  });
  return editDistance(expected.map((_, index) => index), indexes) / Math.max(1, expected.length);
}

function structureF1(expected, actual) {
  const remaining = new Map();
  for (const label of expected.map(normalize)) remaining.set(label, (remaining.get(label) ?? 0) + 1);
  let truePositives = 0;
  for (const label of actual.map(normalize)) {
    const count = remaining.get(label) ?? 0;
    if (count > 0) {
      truePositives += 1;
      remaining.set(label, count - 1);
    }
  }
  if (truePositives === 0) return expected.length === 0 && actual.length === 0 ? 1 : 0;
  return (2 * truePositives) / (expected.length + actual.length);
}

function measureRun(gold, run) {
  if (run.documentSha256 !== gold.sha256) throw new Error(`${gold.id}: run document hash does not match the labeled fixture`);
  if (typeof run.recognizedText !== 'string' || !Array.isArray(run.readingOrder)
    || !Array.isArray(run.structureLabels) || !Array.isArray(run.fallbackDetails)) {
    throw new Error(gold.id + ': run must include text, reading order, structure labels, and fallback details');
  }
  if (!Number.isFinite(run.elapsedMs) || run.elapsedMs < 0 || !Number.isFinite(run.peakMemoryMb) || run.peakMemoryMb < 0) {
    throw new Error(`${gold.id}: elapsedMs and peakMemoryMb must be non-negative finite numbers`);
  }
  return {
    characterErrorRate: errorRate(gold.text.join('\n'), run.recognizedText),
    wordErrorRate: wordErrorRate(gold.text.join(' '), run.recognizedText),
    readingOrderError: readingOrderError(gold.text, run.readingOrder.map(String)),
    structureF1: structureF1(gold.structure, run.structureLabels.map(String)),
    latencyMs: run.elapsedMs,
    peakMemoryMb: run.peakMemoryMb,
  };
}

const results = {};
for (const name of classNames) {
  const gold = manifest.documents.find((document) => document.documentClass === name);
  const rows = raw.runs?.filter((run) => run.documentClass === name) ?? [];
  const repeats = [...new Set(rows.map((run) => run.repeat))].sort((a, b) => a - b);
  if (repeats.length < 3) errors.push(`${name}: provide at least three paired repeats`);
  const pairedRuns = [];
  for (const repeat of repeats) {
    const current = rows.filter((run) => run.repeat === repeat);
    const browserRows = current.filter((run) => run.mode === 'browser');
    const companionRows = current.filter((run) => run.mode === 'companion');
    if (browserRows.length !== 1 || companionRows.length !== 1) {
      errors.push(`${name}: repeat ${repeat} must contain one browser and one Companion result`);
      continue;
    }
    try {
      pairedRuns.push({
        repeat,
        browser: {
          ...measureRun(gold, browserRows[0]),
          engineVersion: browserRows[0].engineVersion,
          ocrAccuracy: browserRows[0].ocrAccuracy,
          fallbackDetails: browserRows[0].fallbackDetails,
        },
        companion: {
          ...measureRun(gold, companionRows[0]),
          engineVersion: companionRows[0].engineVersion,
          ocrAccuracy: companionRows[0].ocrAccuracy,
          fallbackDetails: companionRows[0].fallbackDetails,
        },
      });
    } catch (error) {
      errors.push(`${name}: repeat ${repeat}: ${error.message}`);
    }
  }
  results[name] = {
    pairedRuns,
    browserRegressionPassed: raw.browserRegression?.passed === true,
    browserRegressionEvidence: raw.browserRegression?.evidence ?? '',
  };
}
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

for (const name of classNames) {
  const pairs = results[name].pairedRuns;
  results[name].median = {
    browserLatencyMs: median(pairs.map((pair) => pair.browser.latencyMs)),
    companionLatencyMs: median(pairs.map((pair) => pair.companion.latencyMs)),
    browserPeakMemoryMb: median(pairs.map((pair) => pair.browser.peakMemoryMb)),
    companionPeakMemoryMb: median(pairs.map((pair) => pair.companion.peakMemoryMb)),
    browserCharacterErrorRate: median(pairs.map((pair) => pair.browser.characterErrorRate)),
    companionCharacterErrorRate: median(pairs.map((pair) => pair.companion.characterErrorRate)),
    browserReadingOrderError: median(pairs.map((pair) => pair.browser.readingOrderError)),
    companionReadingOrderError: median(pairs.map((pair) => pair.companion.readingOrderError)),
    browserStructureF1: median(pairs.map((pair) => pair.browser.structureF1)),
    companionStructureF1: median(pairs.map((pair) => pair.companion.structureF1)),
  };
}

const report = {
  schemaVersion: 1,
  corpusManifestSha256: manifestHash,
  environment: raw.environment,
  browserRegressionEvidence: raw.browserRegression.evidence,
  classes: results,
};
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote paired benchmark results for ${classNames.length} document classes.`);
