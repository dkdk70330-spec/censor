import { describe, expect, it } from "vitest";
import { forEachMaskRunRectangle, formatModelBytes, isTauriRuntime } from "./hqsam2";

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
});
