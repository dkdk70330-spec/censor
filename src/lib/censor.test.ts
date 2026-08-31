import { describe, expect, it } from "vitest";
import { CENSOR_PRESETS, DEFAULT_CUSTOM_CLASS_IDS, filterDetections, selectedClassIds, summarizeDetections } from "./censor";
import type { NudeDetection } from "./erax";

const detection = (id: number): NudeDetection => ({ id, label: `id-${id}`, score: 0.8, x: 0, y: 0, width: 20, height: 20 });
const all = [0, 1, 2, 3, 4].map(detection);

describe("censorship levels", () => {
  it("defines EraX presets without the full-image make_love class", () => {
    expect(CENSOR_PRESETS.genitals).toEqual([3, 4]);
    expect(CENSOR_PRESETS.major).toEqual([0, 3, 4]);
    expect(CENSOR_PRESETS.all).toEqual([0, 2, 3, 4]);
    expect(Object.values(CENSOR_PRESETS).flat()).not.toContain(1);
  });

  it.each([
    ["genitals", [3, 4]],
    ["major", [0, 3, 4]],
    ["all", [0, 2, 3, 4]],
  ] as const)("filters %s correctly", (level, expected) => {
    expect(filterDetections(all, level, []).map((item) => item.id)).toEqual(expected);
  });

  it("supports independent custom selection", () => {
    expect([...selectedClassIds("custom", [2, 3])]).toEqual([2, 3]);
    expect(filterDetections(all, "custom", [2, 3]).map((item) => item.id)).toEqual([2, 3]);
    expect(DEFAULT_CUSTOM_CLASS_IDS).toEqual([0, 2, 3, 4]);
  });

  it("creates an EraX penis censor candidate instead of dropping it", () => {
    expect(filterDetections([detection(3)], "genitals", [])).toHaveLength(1);
  });

  it("summarizes unselected detections so filtering is visible to users", () => {
    const detections = [detection(6), detection(6), detection(3)];
    detections[0].label = detections[1].label = "여성 얼굴";
    detections[2].label = "노출된 복부";
    expect(summarizeDetections(detections)).toBe("여성 얼굴 2, 노출된 복부 1");
  });
});
