const MAX_IPC_CHUNK_BYTES = 64 * 1024;
const MAX_PARTS_PER_INPUT_CHUNK = 16;

function invoke(command, payload) {
  const call = globalThis.__TAURI__?.core?.invoke;
  if (typeof call !== "function") throw new Error("Tauri IPC is unavailable.");
  return call(command, payload);
}

async function subscribe(jobId, onEvent, { waitMs = 15_000, signal } = {}) {
  let stopped = false;
  let sequence = 0;
  const done = (async () => {
    while (!stopped && !signal?.aborted) {
      const page = await invoke("companion_job_events", {
        jobId,
        after: sequence,
        waitMs: Math.min(15_000, Math.max(0, Number(waitMs) || 0)),
      });
      for (const event of page.events || []) {
        sequence = Math.max(sequence, Number(event.sequence) || sequence);
        onEvent(event);
      }
      sequence = Math.max(sequence, Number(page.nextSequence) || sequence);
      if (page.terminal) break;
    }
    return sequence;
  })();
  return { done, stop: () => { stopped = true; } };
}

globalThis.GlyphMendCompanion = Object.freeze({
  detect: async () => ({ status: "connected" }),
  connect: async () => ({
    status: "connected",
    sessionId: "tauri-direct",
    capabilities: await invoke("companion_capabilities"),
  }),
  getCapabilities: () => invoke("companion_capabilities"),
  createJob: async (request) => ({ jobId: await invoke("companion_create_job", { request }) }),
  appendChunk: async (jobId, sequence, body) => {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new TypeError("Invalid Companion chunk sequence.");
    }
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    if (bytes.byteLength > MAX_IPC_CHUNK_BYTES * MAX_PARTS_PER_INPUT_CHUNK) {
      throw new RangeError("Companion input chunk exceeds 1 MiB.");
    }
    const partCount = Math.ceil(bytes.byteLength / MAX_IPC_CHUNK_BYTES);
    for (let offset = 0, part = 0; offset < bytes.length; offset += MAX_IPC_CHUNK_BYTES, part += 1) {
      const end = Math.min(offset + MAX_IPC_CHUNK_BYTES, bytes.length);
      await invoke("companion_append_chunk", {
        jobId,
        sequence,
        partIndex: part,
        partCount,
        body: Array.from(bytes.subarray(offset, end)),
      });
    }
  },
  completeInput: (jobId, request) => invoke("companion_complete_job", { jobId, request }),
  getResult: (jobId) => invoke("companion_job_result", { jobId }),
  acknowledgeResult: (jobId) => invoke("companion_acknowledge_result", { jobId }),
  subscribe,
  cancel: (jobId) => invoke("companion_cancel_job", { jobId }),
  disconnect: async () => {},
});
