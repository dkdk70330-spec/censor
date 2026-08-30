import { describe, expect, it } from "vitest";
import { CENSOR_PRESETS, DEFAULT_CUSTOM_CLASS_IDS, filterDetections, selectedClassIds } from "./censor";
import type { NudeDetection } from "./nudenet";

const detection = (id: number): NudeDetection => ({ id, label: `id-${id}`, score: 0.8, x: 0, y: 0, width: 20, height: 20 });
const all = [0, 5, 11, 12, 13, 15, 1].map(detection);

describe("censorship levels", () => {
  it("defines the requested preset IDs without covered genitalia ID 12", () => {
    expect(CENSOR_PRESETS.genitals).toEqual([13, 15]);
    expect(CENSOR_PRESETS.major).toEqual([0, 11, 13, 15]);
    expect(CENSOR_PRESETS.all).toEqual([0, 5, 11, 13, 15]);
    expect(Object.values(CENSOR_PRESETS).flat()).not.toContain(12);
  });

  it.each([
    ["genitals", [13, 15]],
    ["major", [0, 11, 13, 15]],
    ["all", [0, 5, 11, 13, 15]],
  ] as const)("filters %s correctly", (level, expected) => {
    expect(filterDetections(all, level, []).map((item) => item.id)).toEqual(expected);
  });

  it("supports ID 12 independently in custom mode", () => {
    expect([...selectedClassIds("custom", [12, 15])]).toEqual([12, 15]);
    expect(filterDetections(all, "custom", [12, 15]).map((item) => item.id)).toEqual([12, 15]);
    expect(DEFAULT_CUSTOM_CLASS_IDS).not.toContain(12);
  });

  it("creates an ID 15 censor candidate instead of dropping it", () => {
    expect(filterDetections([detection(15)], "genitals", [])).toHaveLength(1);
  });
});

