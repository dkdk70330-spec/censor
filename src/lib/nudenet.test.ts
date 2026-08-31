import { describe, expect, it } from "vitest";
import { LABELS, normalizeDetections } from "./nudenet";

describe("NudeNet class mapping and normalization", () => {
  it("maps class ID 15 to exposed male genitalia", () => {
    expect(LABELS[15]).toBe("노출된 남성 성기");
  });

  it("keeps every valid model result before user filtering", () => {
    const boxes = [[
      [10, 20, 50, 70],
      [5, 8, 30, 40],
      [1, 2, 20, 25],
    ]];
    const detections = normalizeDetections(boxes, [0.9, 0.6, 0.4], [15, 12, 1], [0, 1, 2], 100, 100, 100, 100);
    expect(detections.map((item) => item.id)).toEqual([15, 12, 1]);
    expect(detections[0]).toMatchObject({ id: 15, label: "노출된 남성 성기", score: 0.9, x: 10, y: 20, width: 40, height: 50 });
  });

  it("does not swap axes for an asymmetric box and unequal scales", () => {
    const detections = normalizeDetections(
      [[[11, 23, 47, 89]]], [0.95], [15], [0],
      960, 640, 320, 160,
    );
    expect(detections[0]).toMatchObject({
      x: 33,
      y: 92,
      width: 108,
      height: 264,
      rawBox: [11, 23, 47, 89],
    });
  });
});
