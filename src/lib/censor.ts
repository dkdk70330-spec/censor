import type { NudeDetection } from "./nudenet";

export type CensorLevel = "genitals" | "major" | "all" | "custom";
export type CensorEffect = "white" | "blur" | "mosaic";

export const CENSOR_PRESETS: Record<Exclude<CensorLevel, "custom">, readonly number[]> = {
  genitals: [13, 15],
  major: [0, 11, 13, 15],
  all: [0, 5, 11, 13, 15],
};

export const CUSTOM_CLASS_OPTIONS = [
  { id: 15, label: "남성 성기" },
  { id: 13, label: "여성 성기" },
  { id: 0, label: "항문" },
  { id: 11, label: "여성 유방" },
  { id: 5, label: "엉덩이" },
  { id: 12, label: "가려진 여성 성기까지 감지" },
] as const;

export const DEFAULT_CUSTOM_CLASS_IDS = [0, 5, 11, 13, 15];

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
