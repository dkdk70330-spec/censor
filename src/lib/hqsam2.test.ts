import { describe, expect, it } from "vitest";
import { forEachMaskRunRectangle, formatModelBytes, isTauriRuntime, maskContainsPoint, mergeRefinedMasks, morphSegment, segmentBounds } from "./hqsam2";

describe("HQ-SAM 2 desktop model helpers", () => {
  it("keeps browser builds outside the Tauri-only download path", () => expect(isTauriRuntime()).toBe(false));
  it("formats checkpoint sizes", () => {
    expect(formatModelBytes(0)).toBe("0 MB");
    expect(formatModelBytes(1024 * 1024 * 900)).toBe("900 MB");
  });
  it("splits a mask run when it crosses image rows", () => {
    const rectangles: number[][] = [];
    forEachMaskRunRectangle(4, [2, 7], (x, y, length) => rectangles.push([x, y, length]));
    expect(rectangles).toEqual([[2, 0, 2], [0, 1, 3]]);
  });
  it("replaces only successfully refined rectangles and preserves failures", () => {
    const rects = [{ id: "ok", label: "penis" }, { id: "failed", label: "penis" }];
    const segment = { id: "ok", width: 4, height: 4, runs: [1, 3], score: 0.9 };
    expect(mergeRefinedMasks(rects, [segment])).toEqual({ rects: [rects[1]], segments: [segment] });
  });
  it("hit-tests and measures an asymmetric RLE contour", () => {
    const segment = { id: "mask", width: 6, height: 4, runs: [8, 10, 15, 17], score: 1 };
    expect(maskContainsPoint(segment, 3, 1)).toBe(true);
    expect(maskContainsPoint(segment, 1, 1)).toBe(false);
    expect(segmentBounds(segment)).toEqual({ x: 2, y: 1, width: 3, height: 2 });
  });
  it("dilates and erodes the stored mask without changing its identity", () => {
    const dot = { id: "dot", width: 5, height: 5, runs: [12, 13], score: 1 };
    const grown = morphSegment(dot, 1);
    expect(grown.id).toBe("dot");
    expect(grown.runs).toEqual([6, 9, 11, 14, 16, 19]);
    expect(morphSegment(grown, -1).runs).toEqual(dot.runs);
  });
});
