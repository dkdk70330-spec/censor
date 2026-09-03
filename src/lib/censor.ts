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

function overlap(left: NudeDetection, right: NudeDetection) {
  const x1 = Math.max(left.x, right.x), y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return intersection / Math.min(left.width * left.height, right.width * right.height || 1);
}

export function deduplicateDetections(detections: readonly NudeDetection[], threshold = 0.82) {
  const kept: NudeDetection[] = [];
  for (const candidate of [...detections].sort((left, right) => right.score - left.score)) {
    if (!kept.some((existing) => overlap(existing, candidate) >= threshold)) kept.push(candidate);
  }
  return kept;
}

export function detectionQualityIssue(detection: NudeDetection, imageWidth: number, imageHeight: number) {
  const imageArea = Math.max(1, imageWidth * imageHeight);
  const areaRatio = detection.width * detection.height / imageArea;
  const maxAreaRatio = detection.id === 2 ? 0.12 : detection.id === 1 ? 0.65 : 0.20;
  if (areaRatio > maxAreaRatio) return `탐지 사각형이 이미지의 ${Math.round(areaRatio * 100)}%를 차지해 과도하게 큽니다.`;
  if (detection.width / imageWidth > 0.78 || detection.height / imageHeight > 0.78) return "탐지 사각형이 이미지 한 축의 대부분을 차지합니다.";
  const aspect = Math.max(detection.width / Math.max(1, detection.height), detection.height / Math.max(1, detection.width));
  if (aspect > 8) return `탐지 사각형의 종횡비가 ${aspect.toFixed(1)}:1로 비정상적입니다.`;
  return undefined;
}

export function summarizeDetections(detections: readonly NudeDetection[]) {
  const counts = new Map<string, number>();
  detections.forEach(({ label }) => counts.set(label, (counts.get(label) ?? 0) + 1));
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count]) => `${label} ${count}`)
    .join(", ");
}
