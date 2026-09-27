export function planExtractionBatches(pages, { engine = "browser", batchSize = 20 } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) return [];
  // Keep each Companion result below the protocol's bounded IR response size
  // and avoid retaining a whole long document in the native extraction path.
  const size = engine === "companion"
    ? 100
    : Number.isInteger(batchSize) ? Math.max(1, Math.min(100, batchSize)) : 20;
  const batches = [];
  for (let offset = 0; offset < pages.length; offset += size) {
    batches.push(pages.slice(offset, offset + size));
  }
  return batches;
}
