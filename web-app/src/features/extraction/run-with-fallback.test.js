import { describe, expect, it, vi } from "vitest";
import { runWithBrowserFallback } from "./run-with-fallback.js";

describe("Companion browser fallback", () => {
  it("keeps a successful Companion result without starting browser work", async () => {
    const browser = vi.fn();

    await expect(runWithBrowserFallback({
      companion: async () => ({ pages: [1] }),
      browser,
    })).resolves.toEqual({ pages: [1] });
    expect(browser).not.toHaveBeenCalled();
  });

  it("runs browser extraction for a failed Companion batch and reports the cause", async () => {
    const failure = new Error("Companion went offline");
    const onFallback = vi.fn();
    const browser = vi.fn(async () => ({ pages: [1, 2] }));

    await expect(runWithBrowserFallback({
      companion: async () => { throw failure; },
      browser,
      onFallback,
    })).resolves.toEqual({ pages: [1, 2] });
    expect(onFallback).toHaveBeenCalledWith(failure);
    expect(browser).toHaveBeenCalledWith(failure);
  });

  it("does not turn user cancellation into browser fallback work", async () => {
    const cancellation = Object.assign(new Error("cancelled"), { aborted: true });
    const browser = vi.fn();
    const onFallback = vi.fn();

    await expect(runWithBrowserFallback({
      companion: async () => { throw cancellation; },
      browser,
      onFallback,
    })).rejects.toBe(cancellation);
    expect(onFallback).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
  });
});
