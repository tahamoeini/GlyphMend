import { extractDocumentWithBridge } from "./bridge.js";

export async function createCompanionBridge() {
  const transport = globalThis.GlyphMendCompanion;
  if (!transport) {
    throw new Error("Desktop Tauri IPC is unavailable.");
  }
  return Object.freeze({
    ...transport,
    extractDocument: (options) => extractDocumentWithBridge(transport, options),
  });
}

export function readCompanionFragment() {
  return null;
}
