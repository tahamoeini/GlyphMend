import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LoopbackCompanionBridge } from '../../web-app/src/features/companion/bridge.js';

const executable = process.env.GLYPHMEND_COMPANION
  ? path.resolve(process.env.GLYPHMEND_COMPANION)
  : process.platform === 'win32' ? 'target/debug/companion-cli.exe' : 'target/debug/companion-cli';
const webOrigin = 'http://127.0.0.1:5173';
const child = spawn(executable, ['--no-open', '--web-origin', webOrigin], {
  stdio: ['ignore', 'pipe', 'inherit'],
  shell: process.platform === 'win32',
});
let output = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => { output += chunk; });

try {
  const deadline = Date.now() + 20_000;
  while (!output.includes('Connection URL:') && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Companion exited early (${child.exitCode}).`);
    await delay(25);
  }
  assert.match(output, /Connection URL:/, 'Companion did not start');
  const connectionUrl = output.split('Connection URL:').at(-1).trim().split(/\r?\n/, 1)[0];
  const pairing = new URLSearchParams(new URL(connectionUrl).hash.slice(1));
  const endpoint = pairing.get('companionEndpoint');
  const pairingCode = pairing.get('companionCode');
  assert.ok(endpoint && pairingCode, 'Companion did not provide pairing data');

  const fetchWithOrigin = (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Origin', webOrigin);
    return fetch(url, { ...init, headers });
  };
  const bridge = new LoopbackCompanionBridge(fetchWithOrigin);
  const connection = await bridge.connect(endpoint, pairingCode);
  assert.equal(connection.status, 'connected');

  const bytes = new Uint8Array(await readFile(new URL('../benchmarks/corpus/text-heavy.pdf', import.meta.url)));
  const progress = [];
  const document = await bridge.extractDocument({
    bytes,
    pageCount: 1,
    selectedPages: [1],
    useOcr: false,
    onProgress: (event) => progress.push(event),
  });
  assert.equal(document.schema, 'glyphmend.semantic-document-ir');
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.metadata.engine.id, 'glyphmend.pdfium-tesseract');
  assert.equal(document.pages.length, 1);
  assert.ok(document.pages[0].nodes.some((node) => node.content?.text?.includes('GLYPHMEND')));
  assert.ok(document.pages[0].layout.pageObjectGeometry.length > 0);
  assert.equal(document.pages[0].layout.pageObjectGeometryTruncated, false);
  assert.equal(document.pages[0].layout.pageObjectGeometry[0].bbox.length, 4);
  assert.ok(progress.some((event) => event.eventType === 'job-progress' && event.payload?.progress?.completedPages === 1), 'native page progress was not delivered');

  const scannedBytes = new Uint8Array(await readFile(new URL('../benchmarks/corpus/scanned-english.pdf', import.meta.url)));
  for (const ocrAccuracy of ['fast', 'high-accuracy']) {
    const scanProgress = [];
    let scanned;
    try {
      scanned = await bridge.extractDocument({
        bytes: scannedBytes,
        pageCount: 1,
        selectedPages: [1],
        ocrAccuracy,
        useOcr: true,
        onProgress: (event) => scanProgress.push(event),
      });
    } catch (error) {
      throw new Error(`${ocrAccuracy} OCR extraction failed; events=${JSON.stringify(scanProgress)}`, { cause: error });
    }
    const page = scanned.pages[0];
    const recognizedText = page.nodes.map((node) => node.content?.text ?? '').join(' ');
    assert.ok(recognizedText.includes('TO BOTTOM'), `${ocrAccuracy} OCR did not recover the labeled phrase: ${recognizedText}`);
    assert.equal(page.source.fallback.ocrAccuracy, ocrAccuracy);
    assert.equal(page.source.fallback.ocrApplied, true);
  }

  await assert.rejects(bridge.extractDocument({
    bytes: new TextEncoder().encode('%PDF-invalid fixture'),
    pageCount: 1,
    selectedPages: [1],
    useOcr: false,
  }), /did not complete successfully|PDFium could not open/);

  await bridge.disconnect();
  console.log('Companion PDF extraction, both English OCR models, IR v2, progress, and invalid-PDF checks passed.');
} finally {
  child.kill();
}
