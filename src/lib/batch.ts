export type BatchStatus = "pending" | "processing" | "done" | "error";
export type BatchFormat = "png" | "jpeg";

export function batchOutputName(sourceName: string, suffix: string, format: BatchFormat) {
  const base = sourceName.replace(/\.[^.]+$/, "").trim() || "censored";
  const safeBase = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "censored";
  const safeSuffix = suffix.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return `${safeBase}${safeSuffix}.${format === "jpeg" ? "jpg" : "png"}`;
}

export async function chooseBatchOutputDirectory() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title: "검열 결과를 저장할 폴더 선택" });
  return typeof selected === "string" ? selected : null;
}

export async function saveBatchOutput(outputDir: string, fileName: string, bytes: Uint8Array) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("save_batch_output", { outputDir, fileName, imageBytes: Array.from(bytes) });
}
