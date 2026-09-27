import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LoopbackCompanionBridge, createCompanionProvider, readCompanionFragment } from "./bridge.js";
import { DOCUMENT_EXTRACTION_CAPABILITY, DOCUMENT_OPTIONS_SCHEMA, REGION_INPUT_SCHEMA, companionStatus, validateEndpoint, validateProviderResult, validateRegionMetadata } from "./protocol.js";

function response(body = {}, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

it("does not probe until a user supplies an endpoint", async () => {
  const fetch = vi.fn();
  const bridge = new LoopbackCompanionBridge(fetch);
  expect(await bridge.detect()).toEqual({ status: "unavailable" });
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects non-loopback endpoints before network access", async () => {
  const fetch = vi.fn();
  const bridge = new LoopbackCompanionBridge(fetch);
  expect(await bridge.connect("https://example.com", "code")).toEqual({ status: "failed" });
  expect(fetch).not.toHaveBeenCalled();
  expect(() => validateEndpoint("http://localhost:8765")).toThrow(/127/);
  expect(() => validateEndpoint("http://[::1]:8765")).toThrow(/127/);
});

it("negotiates a session and retrieves provider capabilities", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ protocolVersion: { major: 1, minor: 1 }, irSchemaVersion: 2, sessionId: "session", sessionToken: "token" }))
    .mockResolvedValueOnce(response([{
      id: "glyphmend.diagnostic.mock.v1",
      version: "1.0.0",
      providerKind: "deterministic",
      inputSchema: "glyphmend.job-input.v1",
      outputSchema: "glyphmend.provider-result.v1",
      executionLocations: ["companion"],
      deterministic: true,
      requiresModel: false,
      confidenceCalibrated: true,
      privacyClass: "local-only",
      diagnosticOnly: true,
      irSchemaVersion: 2,
    }]));
  const bridge = new LoopbackCompanionBridge(fetch);
  const result = await bridge.connect("http://127.0.0.1:49183", "code");
  expect(result.status).toBe("connected");
  expect(result.capabilities[0].providerKind).toBe("deterministic");
  expect(fetch.mock.calls[0][0]).toContain("/v1/session");
});

it("uses PUT chunks and ordered HTTP event polling instead of WebSocket", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ jobId: "job" }))
    .mockResolvedValueOnce(response({}, true, 204))
    .mockResolvedValueOnce(response({}, true, 202))
    .mockResolvedValueOnce(response({ events: [{ sequence: 1, eventType: "job-completed" }], nextSequence: 1, terminal: true }));
  const bridge = new LoopbackCompanionBridge(fetch);
  bridge.endpoint = "http://127.0.0.1:49183";
  bridge.session = { token: "token" };
  const job = await bridge.createJob({
    documentName: "region.json",
    capabilityId: "glyphmend.diagnostic.mock.v1",
    inputKind: "region",
    declaredBytes: 3,
    pageCount: 1,
    metadata: { schema: REGION_INPUT_SCHEMA, page: 1, bbox: [0, 0, 1, 1], sourceIds: ["source-1"], deterministicSummary: {} },
  });
  await bridge.appendChunk(job.jobId, 0, new Uint8Array([1, 2, 3]));
  await bridge.completeInput(job.jobId, { sha256Hex: "a".repeat(64), totalBytes: 3 });
  const events = [];
  const subscription = bridge.subscribe(job.jobId, (event) => events.push(event));
  await subscription.done;
  expect(fetch.mock.calls[1][0]).toContain("/chunks/0");
  expect(fetch.mock.calls[1][1].method).toBe("PUT");
  expect(fetch.mock.calls[3][0]).toContain("/events?after=0");
  expect(events[0].sequence).toBe(1);
});

it("acknowledges a durably saved result", async () => {
  const fetch = vi.fn().mockResolvedValue(response({}, true, 204));
  const bridge = new LoopbackCompanionBridge(fetch);
  bridge.endpoint = "http://127.0.0.1:49183";
  bridge.session = { token: "token" };

  await bridge.acknowledgeResult("completed-job");

  expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:49183/v1/jobs/completed-job/result/acknowledge");
  expect(fetch.mock.calls[0][1].method).toBe("POST");
});

it("submits a document job and returns the shared Semantic Document IR", async () => {
  const fixturePath = resolve(process.cwd(), "..", "companion", "fixtures", "semantic-document-ir", "v2", "conformance.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const fetch = vi.fn(async (url) => {
    if (url.endsWith("/v1/jobs")) return response({ jobId: "document-job" });
    if (url.includes("/chunks/0")) return response({});
    if (url.endsWith("/complete")) return response({}, true, 202);
    if (url.includes("/events?")) return response({
      events: [{ sequence: 1, eventType: "progress", payload: { progress: { phase: "ocr", completedPages: 1, totalPages: 1 } } }],
      nextSequence: 1,
      terminal: true,
    });
    if (url.endsWith("/result")) return response({ jobId: "document-job", status: "completed", terminal: true, result: fixture });
    throw new Error(`Unexpected Companion request: ${url}`);
  });
  const bridge = new LoopbackCompanionBridge(fetch);
  bridge.endpoint = "http://127.0.0.1:49183";
  bridge.session = { token: "token" };
  const onProgress = vi.fn();
  const onJobCreated = vi.fn();
  const document = await bridge.extractDocument({
    bytes: new Uint8Array([37, 80, 68, 70]),
    pageCount: 1,
    selectedPages: [1],
    ocrAccuracy: "fast",
    onProgress,
    onJobCreated,
  });
  const createRequest = JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith("/v1/jobs"))[1].body);
  expect(createRequest.documentName).toBe("document.pdf");
  expect(createRequest.capabilityId).toBe(DOCUMENT_EXTRACTION_CAPABILITY);
  expect(createRequest.metadata).toMatchObject({ schema: DOCUMENT_OPTIONS_SCHEMA, ocrAccuracy: "fast" });
  expect(document.schemaVersion).toBe(2);
  expect(document.pages[0].nodes[0].content.markdown).toBe("A shared conformance sentence.");
  expect(onJobCreated).toHaveBeenCalledWith("document-job");
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ eventType: "progress" }));
});

it("cancels an uploaded document job when its extraction signal is aborted", async () => {
  const fetch = vi.fn((url, { signal } = {}) => {
    if (url.endsWith("/v1/jobs")) return Promise.resolve(response({ jobId: "cancelled-document-job" }));
    if (url.includes("/events?")) return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
    if (url.includes("/chunks/0")) return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
    if (url.endsWith("/cancel")) return Promise.resolve(response({}));
    throw new Error(`Unexpected Companion request: ${url}`);
  });
  const bridge = new LoopbackCompanionBridge(fetch);
  bridge.endpoint = "http://127.0.0.1:49183";
  bridge.session = { token: "token" };
  const controller = new AbortController();
  const pending = bridge.extractDocument({ bytes: new Uint8Array([1]), pageCount: 1, selectedPages: [1], signal: controller.signal });
  await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes("/chunks/0"))).toBe(true));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(true);
});

it("keeps a denied or offline companion connection optional", async () => {
  const bridge = new LoopbackCompanionBridge(vi.fn().mockRejectedValue(new TypeError("local network permission denied")));
  expect(await bridge.connect("http://127.0.0.1:49183", "code")).toEqual({ status: "failed" });
});

it("adapts a connected Companion to the existing local provider shape", async () => {
  const bridge = {
    createJob: vi.fn(async () => ({ jobId: "job" })),
    appendChunk: vi.fn(async () => undefined),
    completeInput: vi.fn(async () => undefined),
    subscribe: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
    getResult: vi.fn(async () => ({ result: {
      schema: "glyphmend.provider-result.v1",
      capability: "glyphmend.visual.classify.v1",
      source: { page: 1, bbox: [0, 0, 1, 1], contentHash: "a".repeat(64) },
      observations: [],
      provider: { id: "hybrid", kind: "hybrid-local", version: "1" },
      warnings: [],
      diagnostics: {},
    } })),
  };
  const provider = createCompanionProvider({ bridge, capabilityId: "glyphmend.diagnostic.mock.v1" });
  const result = await provider.recognize({ page: 1, bbox: [0, 0, 20, 20], cropBytes: new Uint8Array([1, 2, 3]) }, { source: "test" });
  expect(result.provider.kind).toBe("hybrid-local");
  expect(bridge.createJob).toHaveBeenCalledWith(expect.objectContaining({ inputKind: "region" }), expect.any(Object));
});

it("reads one-time connection data from a URL fragment", () => {
  expect(readCompanionFragment("#companionEndpoint=http%3A%2F%2F127.0.0.1%3A49183&companionCode=abc")).toEqual({
    endpoint: "http://127.0.0.1:49183",
    pairingCode: "abc",
  });
});

it("maps bridge failure states and rejects unknown wire fields", () => {
  expect(companionStatus({ code: "PROTOCOL_INCOMPATIBLE" })).toBe("protocol-incompatible");
  expect(companionStatus({ name: "AbortError" })).toBe("timed-out");
  expect(() => validateRegionMetadata({ schema: REGION_INPUT_SCHEMA, page: 1, bbox: [0, 0, 1], sourceIds: [], deterministicSummary: {} })).toThrow(/region input/);
  expect(() => validateProviderResult({ schema: "wrong" })).toThrow(/provider result/);
  expect(() => validateProviderResult({
    schema: "glyphmend.provider-result.v1", capability: "c",
    source: { page: 1, bbox: [0, 1, 2, 3, 4], contentHash: "a".repeat(64) },
    observations: [], provider: { id: "p", kind: "deterministic", version: "1" }, warnings: [], diagnostics: {},
  })).toThrow(/provider source/);
});

it("cancels an in-flight Companion provider job when its signal is aborted", async () => {
  const controller = new AbortController();
  const bridge = {
    createJob: vi.fn(async () => ({ jobId: "job" })),
    appendChunk: vi.fn(async () => undefined),
    completeInput: vi.fn(async () => undefined),
    subscribe: vi.fn((_jobId, _onEvent, { signal }) => ({
      done: new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })),
      stop: vi.fn(),
    })),
    cancel: vi.fn(async () => undefined),
    getResult: vi.fn(),
  };
  const provider = createCompanionProvider({ bridge });
  const pending = provider.recognize({ page: 1, bbox: [0, 0, 2, 2], cropBytes: new Uint8Array([1]) }, { signal: controller.signal });
  await vi.waitFor(() => expect(bridge.subscribe).toHaveBeenCalled());
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(bridge.cancel).toHaveBeenCalledWith("job");
  expect(bridge.getResult).not.toHaveBeenCalled();
});

it("splits region crops into chunks of at most one MiB", async () => {
  const bridge = {
    createJob: vi.fn(async () => ({ jobId: "job" })),
    appendChunk: vi.fn(async () => undefined),
    completeInput: vi.fn(async () => undefined),
    subscribe: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
    getResult: vi.fn(async () => ({ result: {
      schema: "glyphmend.provider-result.v1", capability: "glyphmend.diagnostic.mock.v1",
      source: { page: 1, bbox: [0, 0, 1, 1], contentHash: "a".repeat(64) }, observations: [],
      provider: { id: "diagnostic", kind: "deterministic", version: "1" }, warnings: [], diagnostics: {},
    } })),
  };
  const provider = createCompanionProvider({ bridge, capabilityId: "glyphmend.diagnostic.mock.v1" });
  await provider.recognize({ page: 1, bbox: [0, 0, 20, 20], cropBytes: new Uint8Array(1024 * 1024 + 1) });
  expect(bridge.appendChunk).toHaveBeenCalledTimes(2);
  expect(bridge.appendChunk.mock.calls.map((call) => call[2].byteLength)).toEqual([1024 * 1024, 1]);
});

it("recovers from a stale event cursor and resumes from the earliest retained event", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ code: "event-history-gap", earliestSequence: 4 }, false, 409))
    .mockResolvedValueOnce(response({ events: [{ sequence: 4, eventType: "job-completed" }], nextSequence: 4, earliestSequence: 2, historyTruncated: true, terminal: true }));
  const bridge = new LoopbackCompanionBridge(fetch);
  bridge.endpoint = "http://127.0.0.1:49183";
  bridge.session = { token: "token" };
  const events = [];
  await bridge.subscribe("job", (event) => events.push(event)).done;
  expect(events[0]).toMatchObject({ eventType: "event-history-gap", earliestSequence: 4 });
  expect(fetch.mock.calls[1][0]).toContain("/events?after=3");
});

it("propagates abort to an active event long poll", async () => {
  const fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  }));
  const bridge = new LoopbackCompanionBridge(fetch);
  bridge.endpoint = "http://127.0.0.1:49183";
  bridge.session = { token: "token" };
  const controller = new AbortController();
  const subscription = bridge.subscribe("job", () => {}, { signal: controller.signal });
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledOnce();
  controller.abort();
  await expect(subscription.done).resolves.toBe(0);
});
