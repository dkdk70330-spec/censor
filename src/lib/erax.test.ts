import { describe, expect, it } from "vitest";
import { decodeEraXOutput, ERAX_LABELS, letterboxFor, nonMaxSuppression, type NudeDetection } from "./erax";

describe("EraX output processing", () => {
  it("maps the five EraX classes", () => {
    expect(ERAX_LABELS).toEqual(["노출된 항문", "성행위 장면", "노출된 유두", "노출된 남성 성기", "노출된 여성 성기"]);
  });

  it("restores asymmetric letterboxed coordinates without swapping axes", () => {
    const transform = letterboxFor(800, 1200, 640);
    expect(transform).toMatchObject({ scale: 640 / 1200, padX: 106.5, padY: 0 });
    const values = new Float32Array(9);
    values[0] = 320; values[1] = 240; values[2] = 160; values[3] = 96;
    values[7] = 0.75;
    const [result] = decodeEraXOutput(values, [1, 9, 1], transform, 0.25);
    expect(result).toMatchObject({ id: 3, x: 250.3125, y: 360, width: 300, height: 180 });
  });

  it("suppresses only overlapping detections of the same class", () => {
    const item = (id: number, score: number, x: number): NudeDetection => ({ id, label: ERAX_LABELS[id], score, x, y: 0, width: 100, height: 100 });
    expect(nonMaxSuppression([item(3, 0.9, 0), item(3, 0.8, 5), item(4, 0.7, 5)])).toHaveLength(2);
  });
});
