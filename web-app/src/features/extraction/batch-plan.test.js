import { describe, expect, it } from "vitest";
import { planExtractionBatches } from "./batch-plan.js";

describe("extraction batch plan", () => {
  it("bounds Companion jobs while preserving each selected page exactly once", () => {
    const pages = Array.from({ length: 745 }, (_, index) => index + 1);
    const batches = planExtractionBatches(pages, { engine: "companion", batchSize: 20 });

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 100, 100, 100, 100, 100, 45]);
    expect(batches.flat()).toEqual(pages);
  });

  it("keeps browser worker batches within the configured limit", () => {
    const pages = Array.from({ length: 245 }, (_, index) => index + 1);
    const batches = planExtractionBatches(pages, { batchSize: 80 });

    expect(batches.map((batch) => batch.length)).toEqual([80, 80, 80, 5]);
    expect(batches.flat()).toEqual(pages);
  });
});
