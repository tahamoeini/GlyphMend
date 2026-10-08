import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCompanionBridge as createDesktopCompanionBridge } from "../../../../../web-app/src/features/companion/desktop-bridge.js";

test("Tauri Companion adapter splits browser upload chunks into ordered bounded IPC messages", async () => {
  const calls = [];
  globalThis.__TAURI__ = {
    core: {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return undefined;
      },
    },
  };
  const adapterPath = new URL("./tauri-adapter.js", import.meta.url);
  await import(adapterPath.href + "?test=" + Date.now());
  const bytes = Uint8Array.from({ length: 150_000 }, (_, index) => index % 251);
  await globalThis.GlyphMendCompanion.appendChunk("job", 2, bytes);
  assert.deepEqual(calls.map(({ payload }) => payload.sequence), [2, 2, 2]);
  assert.deepEqual(calls.map(({ payload }) => payload.partIndex), [0, 1, 2]);
  assert.deepEqual(calls.map(({ payload }) => payload.partCount), [3, 3, 3]);
  assert.deepEqual(calls.map(({ payload }) => payload.body.length), [65_536, 65_536, 18_928]);
  assert.equal(calls.flatMap(({ payload }) => payload.body).join(","), Array.from(bytes).join(","));
  await globalThis.GlyphMendCompanion.appendChunk("job", 0, Uint8Array.of(1));
  await globalThis.GlyphMendCompanion.appendChunk("job", 1, Uint8Array.of(2));
  assert.deepEqual(calls.slice(-2).map(({ payload }) => payload.sequence), [0, 1]);
  delete globalThis.__TAURI__;
});

test("Tauri Companion adapter refuses oversized chunks and missing IPC", async () => {
  globalThis.__TAURI__ = { core: { invoke: async () => undefined } };
  await import(new URL("./tauri-adapter.js", import.meta.url).href + "?invalid=" + Date.now());
  await assert.rejects(
    globalThis.GlyphMendCompanion.appendChunk("job", 0, new Uint8Array(1_048_577)),
    /exceeds 1 MiB/,
  );
  delete globalThis.__TAURI__;
  assert.throws(() => globalThis.GlyphMendCompanion.getCapabilities(), /IPC is unavailable/);
});

test("Tauri Companion adapter stops upload before the next IPC part when cancelled", async () => {
  const calls = [];
  globalThis.__TAURI__ = {
    core: {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return undefined;
      },
    },
  };
  try {
    await import(new URL("./tauri-adapter.js", import.meta.url).href + "?cancel=" + Date.now());
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      globalThis.GlyphMendCompanion.appendChunk("job", 0, new Uint8Array(70_000), { signal: controller.signal }),
      { name: "AbortError" },
    );
    assert.deepEqual(calls, []);
  } finally {
    delete globalThis.__TAURI__;
  }
});

test("Tauri Companion adapter routes job lifecycle and replay through bounded IPC commands", async () => {
  const calls = [];
  const capabilities = [{
    id: "glyphmend.document.extract.v2",
    version: "0.1.0",
    diagnosticOnly: false,
    irSchemaVersion: 2,
  }];
  globalThis.__TAURI__ = {
    core: {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        if (command === "companion_capabilities") return capabilities;
        if (command === "companion_create_job") return "job-1";
        if (command === "companion_job_events") {
          return {
            events: [{ sequence: 1, eventType: "job-progress", payload: {} }],
            nextSequence: 1,
            terminal: true,
          };
        }
        if (command === "companion_job_result") return { jobId: payload.jobId, terminal: true };
        return undefined;
      },
    },
  };
  try {
    await import(new URL("./tauri-adapter.js", import.meta.url).href + "?lifecycle=" + Date.now());
    const bridge = globalThis.GlyphMendCompanion;
    const connection = await bridge.connect("", "");
    assert.equal(connection.status, "connected");
    assert.deepEqual(connection.capabilities, capabilities);
    const { jobId } = await bridge.createJob({ capabilityId: capabilities[0].id });
    assert.equal(jobId, "job-1");
    await bridge.appendChunk(jobId, 0, new Uint8Array(70_000).fill(7));
    await bridge.completeInput(jobId, { sha256Hex: "a".repeat(64), totalBytes: 70_000 });
    const observed = [];
    const subscription = await bridge.subscribe(jobId, (event) => observed.push(event));
    await subscription.done;
    assert.equal(observed.length, 1);
    assert.equal((await bridge.getResult(jobId)).terminal, true);
    await bridge.acknowledgeResult(jobId);
    await bridge.cancel(jobId);
    await bridge.disconnect();
    assert.deepEqual(
      calls.map(({ command }) => command),
      [
        "companion_capabilities",
        "companion_create_job",
        "companion_append_chunk",
        "companion_append_chunk",
        "companion_complete_job",
        "companion_job_events",
        "companion_job_result",
        "companion_acknowledge_result",
        "companion_cancel_job",
      ],
    );
  } finally {
    delete globalThis.__TAURI__;
  }
});

test("Desktop bridge runs shared document extraction over the Tauri IPC adapter", async () => {
  const fixture = JSON.parse(readFileSync(
    new URL("../../../../../companion/fixtures/semantic-document-ir/v2/conformance.json", import.meta.url),
    "utf8",
  ));
  const calls = [];
  globalThis.__TAURI__ = {
    core: {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        if (command === "companion_capabilities") {
          return [{
            id: "glyphmend.document.extract.v2",
            version: "0.1.0",
            diagnosticOnly: false,
            irSchemaVersion: 2,
          }];
        }
        if (command === "companion_create_job") return "desktop-job";
        if (command === "companion_job_events") {
          return { events: [], nextSequence: 0, terminal: true };
        }
        if (command === "companion_job_result") {
          return { jobId: payload.jobId, status: "completed", terminal: true, result: fixture };
        }
        return undefined;
      },
    },
  };
  try {
    await import(new URL("./tauri-adapter.js", import.meta.url).href + "?shared-extraction=" + Date.now());
    const bridge = await createDesktopCompanionBridge();
    const connection = await bridge.connect("", "");
    assert.equal(connection.status, "connected");
    const document = await bridge.extractDocument({
      bytes: new Uint8Array([37, 80, 68, 70]),
      pageCount: 1,
      selectedPages: [1],
    });

    assert.equal(document.schemaVersion, 2);
    assert.equal(document.pages[0].nodes[0].content.markdown, "A shared conformance sentence.");
    assert.ok(calls.some(({ command }) => command === "companion_append_chunk"));
    assert.ok(calls.some(({ command }) => command === "companion_complete_job"));
    assert.ok(calls.some(({ command }) => command === "companion_job_events"));
    assert.ok(calls.some(({ command }) => command === "companion_job_result"));
  } finally {
    delete globalThis.__TAURI__;
  }
});
