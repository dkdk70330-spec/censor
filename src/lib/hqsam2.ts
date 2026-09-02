export type HqSam2Status = { installed: boolean; downloading: boolean; bytes: number; path?: string };
export type HqSam2Progress = { received: number; total?: number };
export type HqSam2Box = { id: string; x: number; y: number; width: number; height: number };
export type HqSam2Segment = { id: string; width: number; height: number; runs: number[]; score: number; visible?: boolean; feather?: number; label?: string; classId?: number };
export type HqSam2RefineError = { id: string; message: string };
export type HqSam2RefineResult = { device: string; segments: HqSam2Segment[]; errors?: HqSam2RefineError[] };

export function mergeRefinedMasks<T extends { id: string; label?: string; classId?: number }>(rects: readonly T[], segments: readonly HqSam2Segment[], errors: readonly HqSam2RefineError[] = []) {
  const refinedIds = new Set(segments.map((segment) => segment.id));
  const errorById = new Map(errors.map((error) => [error.id, error.message]));
  return {
    rects: rects.filter((rect) => !refinedIds.has(rect.id)).map((rect) => ({ ...rect, needsReview: true, reviewReason: errorById.get(rect.id) || "윤곽을 생성하지 못해 탐지 사각형을 유지했습니다." })),
    segments: segments.map((segment) => {
      const source = rects.find((rect) => rect.id === segment.id);
      return { ...segment, label: source?.label, classId: source?.classId };
    }),
  };
}

export function maskContainsPoint(segment: HqSam2Segment, x: number, y: number) {
  if (segment.visible === false || x < 0 || y < 0 || x >= segment.width || y >= segment.height) return false;
  const target = Math.floor(y) * segment.width + Math.floor(x);
  let low = 0;
  let high = segment.runs.length / 2 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const start = segment.runs[middle * 2];
    const end = segment.runs[middle * 2 + 1];
    if (target < start) high = middle - 1;
    else if (target >= end) low = middle + 1;
    else return true;
  }
  return false;
}

export function segmentBounds(segment: HqSam2Segment) {
  let minX = segment.width, minY = segment.height, maxX = -1, maxY = -1;
  forEachMaskRunRectangle(segment.width, segment.runs, (x, y, length) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + length - 1); maxY = Math.max(maxY, y);
  });
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function encodeBitmap(bitmap: Uint8Array) {
  const runs: number[] = [];
  let start = -1;
  for (let index = 0; index <= bitmap.length; index++) {
    const filled = index < bitmap.length && bitmap[index] !== 0;
    if (filled && start < 0) start = index;
    if (!filled && start >= 0) { runs.push(start, index); start = -1; }
  }
  return runs;
}

export function morphSegment(segment: HqSam2Segment, amount: number): HqSam2Segment {
  const radius = Math.min(30, Math.abs(Math.trunc(amount)));
  if (!radius) return { ...segment, runs: [...segment.runs] };
  const { width, height } = segment;
  const source = new Uint8Array(width * height);
  for (let index = 0; index < segment.runs.length; index += 2) source.fill(1, segment.runs[index], segment.runs[index + 1]);
  const horizontal = new Uint8Array(source.length);
  const output = new Uint8Array(source.length);
  const prefix = new Uint32Array(Math.max(width, height) + 1);
  const erode = amount < 0;
  for (let y = 0; y < height; y++) {
    prefix[0] = 0;
    for (let x = 0; x < width; x++) prefix[x + 1] = prefix[x] + source[y * width + x];
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
      const sum = prefix[right] - prefix[left];
      horizontal[y * width + x] = erode ? Number(left === x - radius && right === x + radius + 1 && sum === right - left) : Number(sum > 0);
    }
  }
  for (let x = 0; x < width; x++) {
    prefix[0] = 0;
    for (let y = 0; y < height; y++) prefix[y + 1] = prefix[y] + horizontal[y * width + x];
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
      const sum = prefix[bottom] - prefix[top];
      output[y * width + x] = erode ? Number(top === y - radius && bottom === y + radius + 1 && sum === bottom - top) : Number(sum > 0);
    }
  }
  return { ...segment, runs: encodeBitmap(output) };
}

export function isTauriRuntime() { return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window; }

export async function getHqSam2Status(): Promise<HqSam2Status> {
  if (!isTauriRuntime()) return { installed: false, downloading: false, bytes: 0 };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HqSam2Status>("hq_sam2_status");
}

export async function downloadHqSam2(onProgress: (progress: HqSam2Progress) => void): Promise<HqSam2Status> {
  if (!isTauriRuntime()) throw new Error("HQ-SAM 2 모델 다운로드는 Veil 데스크톱 앱에서만 지원합니다.");
  const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
  const unlisten = await listen<HqSam2Progress>("hq-sam2-download-progress", (event) => onProgress(event.payload));
  try { return await invoke<HqSam2Status>("download_hq_sam2"); }
  finally { unlisten(); }
}

export function formatModelBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function forEachMaskRunRectangle(width: number, runs: readonly number[], draw: (x: number, y: number, length: number) => void) {
  for (let index = 0; index < runs.length; index += 2) {
    let start = runs[index];
    const end = runs[index + 1];
    while (start < end) {
      const y = Math.floor(start / width);
      const x = start - y * width;
      const length = Math.min(end - start, width - x);
      draw(x, y, length);
      start += length;
    }
  }
}

export async function refineWithHqSam2(imageBytes: Uint8Array, boxes: HqSam2Box[]): Promise<HqSam2RefineResult> {
  if (!isTauriRuntime()) throw new Error("HQ-SAM 2 윤곽 정밀화는 Veil 데스크톱 앱에서만 지원합니다.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HqSam2RefineResult>("refine_hq_sam2", { imageBytes: Array.from(imageBytes), boxes });
}
