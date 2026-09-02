import { describe, expect, it } from "vitest";
import { fitZoom } from "./viewport";

describe("editor viewport zoom", () => {
  it("fits a tall image by height instead of calling full-width display 100%", () => {
    expect(fitZoom(832, 1216, 990, 752)).toBe(51);
  });

  it("does not enlarge a small image beyond its native 100% size", () => {
    expect(fitZoom(320, 240, 1200, 800)).toBe(100);
  });

  it("keeps extremely large images operable", () => {
    expect(fitZoom(12000, 18000, 800, 600)).toBe(10);
  });
});
