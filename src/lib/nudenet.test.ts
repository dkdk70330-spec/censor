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
    expect(detections[0]).toMatchObject({ id: 15, label: "노출된 남성 성기", score: 0.9, x: 20, y: 10, width: 50, height: 40 });
  });
});

