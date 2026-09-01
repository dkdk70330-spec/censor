import { describe, expect, it } from "vitest";
import { batchOutputName } from "./batch";

describe("desktop batch output naming", () => {
  it("keeps the source stem and selected format", () => {
    expect(batchOutputName("photo.original.webp", "-censored", "png")).toBe("photo.original-censored.png");
    expect(batchOutputName("photo.jpg", "_veil", "jpeg")).toBe("photo_veil.jpg");
  });
  it("removes path separators and Windows-invalid filename characters", () => {
    expect(batchOutputName("bad:name?.png", "/done", "png")).toBe("bad_name__done.png");
  });
});
