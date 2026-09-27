import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const input = process.argv[2];
if (!input || !fs.existsSync(input)) {
  console.error('Stable promotion is blocked: no checked-in repeated benchmark results are available.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(input, 'utf8'));
const corpusPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus/manifest.json');
const currentCorpusHash = createHash('sha256').update(fs.readFileSync(corpusPath)).digest('hex');
const required = new Set([
  'text-heavy',
  'scanned-english',
  'multi-column',
  'table',
  'equation',
  'image-heavy',
]);
const classes = report.classes ?? {};
const errors = [];
const metricNames = ['characterErrorRate', 'wordErrorRate', 'readingOrderError', 'structureF1', 'latencyMs', 'peakMemoryMb'];
if (report.schemaVersion !== 1) errors.push('schemaVersion: expected version 1');
if (report.corpusManifestSha256 !== currentCorpusHash) errors.push('corpusManifestSha256: results must match the checked-in labeled corpus');
for (const name of required) {
  const result = classes[name];
  if (!result || !Array.isArray(result.pairedRuns) || result.pairedRuns.length < 3) {
    errors.push(`${name}: requires at least three paired browser/companion runs`);
    continue;
  }
  if (result.browserRegressionPassed !== true || !result.browserRegressionEvidence) errors.push(`${name}: passing browser-regression evidence is required`);
  const repeatIds = new Set();
  const wins = { characterErrorRate: 0, wordErrorRate: 0, readingOrderError: 0, structureF1: 0 };
  for (const pair of result.pairedRuns) {
    if (repeatIds.has(pair.repeat)) errors.push(`${name}: duplicate paired repeat ${pair.repeat}`);
    repeatIds.add(pair.repeat);
    if (!pair.browser || !pair.companion) {
      errors.push(`${name}: repeat ${pair.repeat} is missing a paired engine result`);
      continue;
    }
    let validMetrics = true;
    for (const metric of metricNames) {
      if (!Number.isFinite(pair.browser?.[metric]) || !Number.isFinite(pair.companion?.[metric])) {
        errors.push(`${name}: repeat ${pair.repeat} is missing finite browser and Companion ${metric} measurements`);
        validMetrics = false;
      }
    }
    if (!validMetrics) continue;
    for (const metric of ['characterErrorRate', 'wordErrorRate', 'readingOrderError']) if (pair.companion[metric] < pair.browser[metric]) wins[metric]++;
    if (pair.companion.structureF1 > pair.browser.structureF1) wins.structureF1++;
  }
  const neededWins = Math.ceil(result.pairedRuns.length * 2 / 3);
  if (!Object.values(wins).some((count) => count >= neededWins)) errors.push(`${name}: no quality measure improved in at least two thirds of paired runs`);
}
if (!report.environment?.platform || !report.environment?.browserVersion || !report.environment?.companionVersion) {
  errors.push('environment: record platform, browser version, and Companion version');
}
if (errors.length) {
  console.error('Stable promotion is blocked:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Stable-promotion evidence covers all six classes, repeated paired measurements, repeatable quality improvement, and browser regression checks.');
