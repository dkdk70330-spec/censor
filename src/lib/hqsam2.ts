export type HqSam2Status = { installed: boolean; downloading: boolean; bytes: number; path?: string };
export type HqSam2Progress = { received: number; total?: number };
export type HqSam2Box = { id: string; x: number; y: number; width: number; height: number };
export type HqSam2Segment = { id: string; width: number; height: number; runs: number[]; score: number };
export type HqSam2RefineResult = { device: string; segments: HqSam2Segment[] };

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
