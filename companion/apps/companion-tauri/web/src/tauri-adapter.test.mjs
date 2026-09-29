import assert from "node:assert/strict";
import { test } from "node:test";

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
