import type { NudeDetection } from "./erax";

export type CensorLevel = "genitals" | "major" | "all" | "custom";
export type CensorEffect = "white" | "blur" | "mosaic";

export const CENSOR_PRESETS: Record<Exclude<CensorLevel, "custom">, readonly number[]> = {
  genitals: [3, 4],
  major: [0, 3, 4],
  all: [0, 2, 3, 4],
};

export const CUSTOM_CLASS_OPTIONS = [
  { id: 3, label: "남성 성기" },
  { id: 4, label: "여성 성기" },
  { id: 0, label: "항문" },
  { id: 2, label: "유두" },
] as const;

export const DEFAULT_CUSTOM_CLASS_IDS = [0, 2, 3, 4];

export function selectedClassIds(level: CensorLevel, customIds: readonly number[]) {
  return new Set(level === "custom" ? customIds : CENSOR_PRESETS[level]);
}

export function filterDetections(
  detections: readonly NudeDetection[],
  level: CensorLevel,
  customIds: readonly number[],
) {
  const selected = selectedClassIds(level, customIds);
  return detections.filter((detection) => selected.has(detection.id));
}

export function summarizeDetections(detections: readonly NudeDetection[]) {
  const counts = new Map<string, number>();
  detections.forEach(({ label }) => counts.set(label, (counts.get(label) ?? 0) + 1));
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count]) => `${label} ${count}`)
    .join(", ");
}
