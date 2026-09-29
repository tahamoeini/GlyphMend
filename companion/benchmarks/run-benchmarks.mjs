import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { LoopbackCompanionBridge } from "../../web-app/src/features/companion/bridge.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const benchmarkDir = path.join(repoRoot, "companion/benchmarks");
const corpusDir = path.join(benchmarkDir, "corpus");
const webRoot = path.join(repoRoot, "web-app");
const manifestBytes = fs.readFileSync(path.join(corpusDir, "manifest.json"));
const manifest = JSON.parse(manifestBytes);
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const MAX_BROWSER_RUN_MS = 10 * 60 * 1000;
const MEMORY_SAMPLE_MS = 125;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredOption(name, fallback) {
  const value = option(name, fallback);
  if (!value) throw new Error("Missing value for " + name);
  return value;
}

function executable(name) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const found = spawnSync(command, [name], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim().split(/\r?\n/)[0] : null;
}

function resolveBrowser() {
  const supplied = option("--browser-executable", process.env.CHROME_BIN);
  if (supplied) return path.resolve(supplied);
  for (const candidate of ["google-chrome", "chromium", "chromium-browser", "chrome"]) {
    const found = executable(candidate);
    if (found) return found;
  }
  throw new Error("Chromium was not found. Pass --browser-executable or set CHROME_BIN.");
}

function resolveCompanion() {
  const supplied = option("--companion-executable", process.env.GLYPHMEND_COMPANION);
  if (supplied) return path.resolve(supplied);
  const file = process.platform === "win32" ? "companion-cli.exe" : "companion-cli";
  return path.join(repoRoot, "companion/target/debug", file);
}

function runCommand(program, args, cwd, extraEnv = {}) {
  const result = spawnSync(program, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(program + " " + args.join(" ") + " failed with exit " + result.status);
}

function runBrowserChecks() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const script of ["license:check", "lint", "typecheck", "test", "build"]) {
    console.log("\n> npm run " + script);
    runCommand(npm, ["run", script], webRoot);
  }
}

function terminate(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill();
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(label + " did not become ready" + (lastError ? ": " + lastError.message : ""));
}

async function freePort() {
  const server = await import("node:net").then(({ createServer }) => createServer());
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startWebServer() {
  const port = await freePort();
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: webRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => { logs = (logs + chunk).slice(-8192); });
  }
  const origin = "http://127.0.0.1:" + port;
  try {
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error("Vite exited: " + logs);
      const response = await fetch(origin + "/");
      return response.ok;
    }, 60_000, "Vite development server");
  } catch (error) {
    terminate(child);
    throw error;
  }
  return { child, origin, logs: () => logs };
}

async function startBrowser(browserExecutable) {
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), "glyphmend-benchmark-chrome-"));
  const child = spawn(browserExecutable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ], {
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  try {
    const activePort = path.join(profile, "DevToolsActivePort");
    const contents = await waitFor(async () => {
      if (child.exitCode !== null) throw new Error("Chromium exited during startup.");
      return fs.existsSync(activePort) ? fs.readFileSync(activePort, "utf8") : null;
    }, 30_000, "Chromium DevTools endpoint");
    const port = Number(contents.split(/\r?\n/)[0]);
    const response = await fetch("http://127.0.0.1:" + port + "/json/version");
    const version = await response.json();
    const targetResponse = await fetch("http://127.0.0.1:" + port + "/json/new?about%3Ablank", { method: "PUT" });
    const target = await targetResponse.json();
    const page = await CdpPage.connect(target.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    return { child, profile, pid: child.pid, version: version.Browser || "unknown", page };
  } catch (error) {
    terminate(child);
    await fsp.rm(profile, { recursive: true, force: true });
    throw error;
  }
}

class CdpPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (!message.id) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || "Chrome DevTools command failed."));
      else entry.resolve(message.result);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium DevTools.")), { once: true });
    });
    return new CdpPage(socket);
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Timed out waiting for Chrome DevTools method " + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = MAX_BROWSER_RUN_MS) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Browser evaluation failed.");
    }
    return response.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function navigateToApp(page, origin) {
  await page.send("Page.navigate", { url: origin + "/" });
  await waitFor(async () => await page.evaluate("document.readyState === 'complete'"), 30_000, "browser application page");
}

function browserWorkerExtract(base64) {
  return new Promise((resolve, reject) => {
    const ids = [
      "removeHeaders", "removeFooters", "joinParagraphs", "detectHeadings",
      "detectTables", "extractEquations", "preserveVisuals", "useOcr",
      "forceOcr", "taskLists", "flows", "placeholders", "preserveMarkers", "strict",
    ];
    const options = Object.fromEntries(ids.map((id) => {
      const control = document.getElementById(id);
      if (!control) throw new Error("Browser extraction option is missing: " + id);
      return [id, control.checked];
    }));
    options.ocrLanguage = "eng";
    options.ocrDpi = Number(document.getElementById("ocrDpi")?.value) || 300;
    options.useOcr = true;
    options.forceOcr = false;
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
    const startedAt = performance.now();
    const worker = new Worker(new URL("/src/features/extraction/extract-worker.js", location.href), { type: "module" });
    let pageData = null;
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Browser extraction exceeded the benchmark timeout."));
    }, 9 * 60 * 1000);
    const fail = (error) => {
      clearTimeout(timer);
      worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    worker.onerror = (event) => fail(event.message || "Browser extraction worker failed.");
    worker.onmessage = ({ data }) => {
      if (data.type === "page-error" || data.type === "error") {
        fail(data.message || "Browser extraction failed.");
        return;
      }
      if (data.type === "page") {
        const ir = data.semanticDocument;
        pageData = {
          semanticDocument: ir ? {
            schema: ir.schema,
            schemaVersion: ir.schemaVersion,
            documentId: ir.documentId,
            metadata: ir.metadata,
            pages: ir.pages.map((page) => ({
              pageNumber: page.pageNumber,
              bbox: page.bbox,
              source: page.source,
              layout: {
                pageObjectGeometry: page.layout?.pageObjectGeometry || [],
                pageObjectGeometryTruncated: page.layout?.pageObjectGeometryTruncated || false,
              },
              nodes: page.nodes.map((node) => ({
                type: node.type,
                sourceKind: node.sourceKind,
                source: node.source,
                bbox: node.bbox,
                content: {
                  text: node.content?.text,
                  markdown: node.content?.markdown,
                  table: node.content?.table,
                },
              })),
            })),
          } : null,
          text: data.text || "",
          quality: data.quality || {},
        };
        return;
      }
      if (data.type === "done") {
        clearTimeout(timer);
        worker.terminate();
        if (!pageData) return reject(new Error("Browser worker completed without a page result."));
        resolve({ elapsedMs: performance.now() - startedAt, ...pageData });
      }
    };
    worker.postMessage({
      type: "extract",
      buffer: bytes.buffer,
      pages: [1],
      options,
      password: "",
      ocrPaths: {
        workerPath: new URL("./tesseract/worker.min.js", location.href).toString(),
        corePath: new URL("./tesseract-core", location.href).toString(),
        langPath: new URL("./tessdata", location.href).toString(),
      },
    }, [bytes.buffer]);
  });
}

async function runBrowserExtraction(page, pdfBytes) {
  const base64 = Buffer.from(pdfBytes).toString("base64");
  const expression = "(" + browserWorkerExtract.toString() + ")(" + JSON.stringify(base64) + ")";
  return page.evaluate(expression);
}

async function readProcessRows() {
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; rss=$_.WorkingSetSize } } | ConvertTo-Json -Compress";
    const text = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    const values = JSON.parse(text || "[]");
    return (Array.isArray(values) ? values : [values]).map((row) => ({
      pid: Number(row.pid), ppid: Number(row.ppid), rss: Math.round(Number(row.rss) / 1024),
    }));
  }
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" });
  return output.trim().split(/\r?\n/).map((line) => {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    return { pid, ppid, rss };
  }).filter((row) => Number.isFinite(row.pid));
}

async function processTreeRssMb(rootPid) {
  const rows = await readProcessRows();
  const children = new Map();
  for (const row of rows) {
    const list = children.get(row.ppid) || [];
    list.push(row);
    children.set(row.ppid, list);
  }
  const ids = new Set([Number(rootPid)]);
  const queue = [Number(rootPid)];
  while (queue.length) {
    for (const child of children.get(queue.pop()) || []) {
      if (ids.has(child.pid)) continue;
      ids.add(child.pid);
      queue.push(child.pid);
    }
  }
  const totalKb = rows.reduce((sum, row) => sum + (ids.has(row.pid) ? row.rss : 0), 0);
  return totalKb / 1024;
}

async function withPeakMemory(rootPid, operation) {
  let peakMemoryMb = await processTreeRssMb(rootPid);
  let active = true;
  const sampler = (async () => {
    while (active) {
      peakMemoryMb = Math.max(peakMemoryMb, await processTreeRssMb(rootPid));
      await delay(MEMORY_SAMPLE_MS);
    }
  })();
  const startedAt = performance.now();
  try {
    const value = await operation();
    return { value, peakMemoryMb, elapsedMs: performance.now() - startedAt };
  } finally {
    active = false;
    await sampler;
  }
}

function extractTexts(document) {
  const lines = [];
  const appendLine = (value) => {
    const line = String(value).replace(/\[SOURCE_VISUAL\b[^\]\r\n]*(?:\]|$)/gi, " ").trim();
    if (!line || /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) return;
    if (line.startsWith("|")) {
      for (const cell of line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|")) {
        if (cell.trim()) lines.push(cell.trim());
      }
      return;
    }
    lines.push(line);
  };
  for (const page of document.pages || []) {
    for (const node of page.nodes || []) {
      const value = node.content?.text ?? node.content?.markdown ?? "";
      for (const line of String(value).split(/\r?\n/)) appendLine(line);
    }
  }
  return lines;
}

function geometryObjects(document) {
  return (document.pages || []).flatMap((page) => page.layout?.pageObjectGeometry || []);
}

function bboxCenter(node) {
  const box = node.bbox;
  if (!box) return null;
  if (Array.isArray(box) && box.length >= 4) return (Number(box[0]) + Number(box[2])) / 2;
  if (Number.isFinite(box.x0) && Number.isFinite(box.x1)) return (box.x0 + box.x1) / 2;
  return null;
}

function structureLabels(document, documentClass, lines) {
  const pages = document.pages || [];
  const nodes = pages.flatMap((page) => page.nodes || []);
  const types = nodes.map((node) => node.type);
  const geometry = geometryObjects(document);
  const labels = [];
  const add = (label) => labels.push(label);
  if (documentClass === "text-heavy") {
    for (const type of types) if (type === "heading" || type === "paragraph") add(type);
  } else if (documentClass === "scanned-english") {
    if (geometry.some((object) => String(object.kind || object.type || "").toLowerCase().includes("image"))
      || types.includes("figure") || types.includes("unresolved-visual")) add("image-page");
    if (lines.length >= 3 && lines.length <= 5) add("four-lines");
  } else if (documentClass === "multi-column") {
    const centers = nodes.map(bboxCenter).filter(Number.isFinite).sort((left, right) => left - right);
    let bestGap = 0;
    let split = 0;
    for (let index = 1; index < centers.length; index += 1) {
      const gap = centers[index] - centers[index - 1];
      if (gap > bestGap) {
        bestGap = gap;
        split = index;
      }
    }
    const pageWidth = Math.max(1, ...pages.map((page) => {
      const box = page.bbox;
      return Array.isArray(box) ? Number(box[2]) - Number(box[0]) : Number(box?.x1) - Number(box?.x0);
    }).filter(Number.isFinite));
    if (split && bestGap >= pageWidth * 0.12) {
      add("two-columns");
      if (split >= 3 && centers.length - split >= 3) add("four-lines-each");
    }
  } else if (documentClass === "table") {
    const tables = nodes.filter((node) => node.type === "table");
    if (tables.length) add("table");
    const rows = tables.map((node) => node.content?.table?.rows).find(Array.isArray);
    if (rows?.length >= 3) add("three-rows");
    const columns = rows?.[0]?.cells?.length ?? rows?.[0]?.length ?? 0;
    if (columns >= 3) add("three-columns");
  } else if (documentClass === "equation") {
    for (const type of types) {
      if (type === "heading") add("heading");
      if (type === "equation") add("display-equation");
      if (type === "caption") add("caption");
    }
  } else if (documentClass === "image-heavy") {
    const figures = types.filter((type) => type === "figure").length
      || geometry.filter((object) => String(object.kind || object.type || "").toLowerCase().includes("image")).length;
    const captions = types.filter((type) => type === "caption").length;
    if (figures >= 3) add("three-raster-figures");
    if (captions >= 3) add("three-captions");
  }
  return labels;
}

function normalizeDocument(document, documentClass) {
  if (!document || !Array.isArray(document.pages) || !document.pages.length) {
    throw new Error("Extractor returned no Semantic Document IR v2 pages.");
  }
  const lines = extractTexts(document);
  const fallbacks = document.pages.map((page) => ({
    pageNumber: page.pageNumber,
    details: page.source?.fallback || page.fallback || [],
  }));
  return {
    recognizedText: lines.join("\n"),
    readingOrder: lines,
    structureLabels: structureLabels(document, documentClass, lines),
    fallbackDetails: fallbacks,
    pageCount: document.pages.length,
    engine: document.metadata?.engine || {},
  };
}

function startCompanion(executablePath, origin, modelRoot) {
  if (!fs.existsSync(executablePath)) throw new Error("Companion executable is missing: " + executablePath);
  const child = spawn(executablePath, ["--no-open", "--web-origin", origin], {
    cwd: path.join(repoRoot, "companion"),
    env: { ...process.env, GLYPHMEND_TESSDATA_DIR: modelRoot },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-16_384); });
  child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-16_384); });
  return { child, get output() { return output; }, get errors() { return errors; } };
}

async function companionConnection(runtime) {
  const connectionUrl = await waitFor(() => {
    if (runtime.child.exitCode !== null) throw new Error("Companion exited: " + runtime.errors);
    const match = runtime.output.match(/Connection URL:\s*(\S+)/);
    return match?.[1] || null;
  }, 30_000, "Companion loopback endpoint");
  const parameters = new URLSearchParams(new URL(connectionUrl).hash.slice(1));
  const endpoint = parameters.get("companionEndpoint");
  const pairingCode = parameters.get("companionCode");
  if (!endpoint || !pairingCode) throw new Error("Companion startup output did not contain pairing details.");
  const bridge = new LoopbackCompanionBridge();
  const connection = await bridge.connect(endpoint, pairingCode);
  if (connection.status !== "connected") throw new Error("Companion connection failed: " + connection.status);
  const capability = connection.capabilities.find((item) => item.id === "glyphmend.document.extract.v2" && !item.diagnosticOnly);
  if (!capability) throw new Error("Companion does not advertise document extraction.");
  return { bridge, connection };
}

async function runCompanionExtraction(bridge, pdfBytes, fixture, accuracy) {
  return bridge.extractDocument({
    bytes: new Uint8Array(pdfBytes),
    pageCount: fixture.pages,
    selectedPages: [1],
    ocrAccuracy: accuracy,
    useOcr: true,
    forceOcr: false,
  });
}

function commitHash() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function workingTreeEvidence() {
  const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 1024 * 1024,
  });
  const diff = spawnSync("git", ["diff", "--binary", "HEAD"], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (status.status !== 0 || diff.status !== 0) throw new Error("Could not record the benchmark worktree state.");
  return {
    workingTreeDirty: status.stdout.length > 0,
    workingTreeStatusSha256: createHash("sha256").update(status.stdout).digest("hex"),
    trackedDiffSha256: createHash("sha256").update(diff.stdout).digest("hex"),
  };
}

function companionVersion(executablePath) {
  const result = spawnSync(executablePath, ["--version"], { encoding: "utf8" });
  if (result.status === 0) return result.stdout.trim().split(/\r?\n/)[0];
  return "version-" + JSON.parse(fs.readFileSync(path.join(repoRoot, "companion/Cargo.toml"), "utf8").match(/version\s*=\s*"([^"]+)"/)[1]);
}

async function main() {
  const browserOnly = process.argv.includes("--browser-only");
  const repeats = Number(requiredOption("--repeats", "3"));
  const accuracy = requiredOption("--ocr-accuracy", "fast");
  const outputPath = path.resolve(requiredOption("--output", path.join(os.tmpdir(), "glyphmend-benchmark-raw.json")));
  if (!Number.isInteger(repeats) || repeats < 3 || repeats > 20) throw new Error("--repeats must be an integer from 3 to 20.");
  if (!["fast", "high-accuracy"].includes(accuracy)) throw new Error("--ocr-accuracy must be fast or high-accuracy.");
  if (process.platform === "win32" && !executable("powershell.exe")) throw new Error("PowerShell is required for Windows memory sampling.");
  const browserExecutable = resolveBrowser();
  let companionExecutable;
  let companionDirectory;
  let modelRoot;
  let modelPath;
  let pdfiumPath;
  let selectedModel;
  if (!browserOnly) {
    companionExecutable = resolveCompanion();
    if (!fs.existsSync(companionExecutable)) throw new Error("Companion executable is missing: " + companionExecutable);
    companionDirectory = path.dirname(companionExecutable);
    modelRoot = path.resolve(process.env.GLYPHMEND_TESSDATA_DIR || path.join(companionDirectory, "tessdata"));
    selectedModel = accuracy === "fast" ? "fast" : "best";
    modelPath = path.join(modelRoot, selectedModel, "eng.traineddata");
    if (!fs.existsSync(modelPath)) throw new Error("Companion OCR model is missing: " + modelPath);
    const pdfiumName = process.platform === "win32" ? "pdfium.dll" : process.platform === "darwin" ? "libpdfium.dylib" : "libpdfium.so";
    pdfiumPath = path.join(companionDirectory, pdfiumName);
    if (!fs.existsSync(pdfiumPath)) throw new Error("PDFium runtime is missing beside the Companion executable: " + pdfiumPath);
  }
  const readHash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const browserVersion = await startVersionProbe(browserExecutable);
  const appVersion = browserOnly ? null : companionVersion(companionExecutable);
  const revision = commitHash();

  console.log("Running browser license, quality, test, and production-build checks.");
  runBrowserChecks();
  const worktreeEvidence = workingTreeEvidence();

  let server;
  let browser;
  let companion;
  let bridge;
  const raw = {
    schemaVersion: 1,
    kind: browserOnly ? "browser-smoke" : "paired-benchmark",
    corpusManifestSha256: manifestSha256,
    environment: {
      platform: process.platform + "-" + process.arch,
      browserVersion,
      companionVersion: appVersion,
      gitCommit: revision,
      ...worktreeEvidence,
      browserOcrModel: "bundled eng best_int",
      companionOcrAccuracy: accuracy,
      repetitions: repeats,
      startedAt: new Date().toISOString(),
    },
    browserRegression: { passed: false, evidence: "" },
    runs: [],
  };
  const persist = () => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(raw, null, 2) + "\n");
  };
  try {
    raw.environment.browserOcrModelSha256 = readHash(path.join(webRoot, "dist/tessdata/eng.traineddata"));
    if (!browserOnly) {
      raw.environment.companionOcrModelSha256 = readHash(modelPath);
      raw.environment.companionOcrModelCommit = fs.existsSync(path.join(modelRoot, selectedModel, "UPSTREAM_COMMIT"))
        ? fs.readFileSync(path.join(modelRoot, selectedModel, "UPSTREAM_COMMIT"), "utf8").trim()
        : "unknown";
      raw.environment.pdfiumSha256 = readHash(pdfiumPath);
    }
    server = await startWebServer();
    browser = await startBrowser(browserExecutable);
    await navigateToApp(browser.page, server.origin);
    if (!browserOnly) {
      companion = startCompanion(companionExecutable, server.origin, modelRoot);
      const connected = await companionConnection(companion);
      bridge = connected.bridge;
    }
    const regressionClasses = [];
    for (const fixture of manifest.documents) {
      const pdfBytes = fs.readFileSync(path.join(corpusDir, fixture.file));
      const hash = createHash("sha256").update(pdfBytes).digest("hex");
      if (hash !== fixture.sha256) throw new Error(fixture.id + ": PDF hash changed after corpus validation.");
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        const modes = browserOnly ? ["browser"] : repeat % 2 ? ["browser", "companion"] : ["companion", "browser"];
        for (const mode of modes) {
          const startedAt = new Date().toISOString();
          const measured = await withPeakMemory(
            mode === "browser" ? browser.pid : companion.child.pid,
            () => mode === "browser"
              ? runBrowserExtraction(browser.page, pdfBytes)
              : runCompanionExtraction(bridge, pdfBytes, fixture, accuracy),
          );
          const normalized = normalizeDocument(measured.value.semanticDocument || measured.value, fixture.documentClass);
          const engineVersion = mode === "browser"
            ? "MuPDF " + (JSON.parse(fs.readFileSync(path.join(webRoot, "package-lock.json"), "utf8")).packages["node_modules/mupdf"].version)
              + "; Tesseract.js " + JSON.parse(fs.readFileSync(path.join(webRoot, "package-lock.json"), "utf8")).packages["node_modules/tesseract.js"].version
            : String(normalized.engine.version || appVersion);
          raw.runs.push({
            documentId: fixture.id,
            documentClass: fixture.documentClass,
            documentSha256: hash,
            repeat,
            mode,
            engineVersion,
            ocrAccuracy: mode === "browser" ? raw.environment.browserOcrModel : accuracy,
            startedAt,
            pageCount: normalized.pageCount,
            recognizedText: normalized.recognizedText,
            readingOrder: normalized.readingOrder,
            structureLabels: normalized.structureLabels,
            elapsedMs: Math.round(measured.value.elapsedMs ?? measured.elapsedMs),
            peakMemoryMb: Math.round(measured.peakMemoryMb * 100) / 100,
            fallbackDetails: normalized.fallbackDetails,
          });
          persist();
          console.log(fixture.id + " repeat " + repeat + " " + mode + ": "
            + raw.runs.at(-1).elapsedMs + " ms, " + raw.runs.at(-1).peakMemoryMb + " MiB");
        }
      }
      regressionClasses.push(fixture.documentClass);
    }
    raw.browserRegression = {
      passed: true,
      evidence: browserOnly
        ? "Browser-only smoke run: the six labeled fixtures completed through the browser extraction worker; npm license:check, lint, typecheck, test, and build passed. This is not a paired Companion benchmark."
        : "The six labeled fixtures completed through the browser extraction worker; npm license:check, lint, typecheck, test, and build passed in this run.",
      checkedClasses: regressionClasses,
      checkedAt: new Date().toISOString(),
    };
    raw.environment.finishedAt = new Date().toISOString();
    persist();
    console.log((browserOnly ? "Browser-only smoke evidence" : "Raw paired runs") + " written to " + outputPath);
  } finally {
    await bridge?.disconnect().catch(() => {});
    terminate(companion?.child);
    browser?.page.close();
    terminate(browser?.child);
    if (browser?.profile) await fsp.rm(browser.profile, { recursive: true, force: true });
    terminate(server?.child);
  }
}

async function startVersionProbe(browserExecutable) {
  const child = spawnSync(browserExecutable, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error("Could not read the Chromium version.");
  return child.stdout.trim() || "unknown";
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
