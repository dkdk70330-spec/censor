import * as ort from "onnxruntime-web/wasm";

export type NudeDetection = {
  id: number;
  label: string;
  score: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rawBox?: readonly number[];
};

export const ERAX_LABELS = ["노출된 항문", "성행위 장면", "노출된 유두", "노출된 남성 성기", "노출된 여성 성기"] as const;
export const ERAX_INPUT_SIZE = 640;

export type Letterbox = { scale: number; padX: number; padY: number; inputSize: number; sourceWidth: number; sourceHeight: number };
let sessionPromise: Promise<ort.InferenceSession> | null = null;

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const runtimeOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
const runtimeBase = new URL(`${import.meta.env.BASE_URL}ort/`, runtimeOrigin).href;
ort.env.wasm.wasmPaths = {
  wasm: `${runtimeBase}ort-wasm-simd-threaded.wasm`,
  mjs: `${runtimeBase}ort-wasm-simd-threaded.mjs`,
};

export function letterboxFor(sourceWidth: number, sourceHeight: number, inputSize = ERAX_INPUT_SIZE): Letterbox {
  const scale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
  const resizedWidth = Math.round(sourceWidth * scale);
  const resizedHeight = Math.round(sourceHeight * scale);
  return { scale, padX: (inputSize - resizedWidth) / 2, padY: (inputSize - resizedHeight) / 2, inputSize, sourceWidth, sourceHeight };
}

function iou(left: NudeDetection, right: NudeDetection) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return intersection / (left.width * left.height + right.width * right.height - intersection || 1);
}

export function nonMaxSuppression(detections: readonly NudeDetection[], threshold = 0.45, limit = 50) {
  const pending = [...detections].sort((a, b) => b.score - a.score);
  const kept: NudeDetection[] = [];
  while (pending.length && kept.length < limit) {
    const best = pending.shift()!;
    kept.push(best);
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index].id === best.id && iou(best, pending[index]) > threshold) pending.splice(index, 1);
    }
  }
  return kept;
}

export function decodeEraXOutput(
  data: Float32Array,
  dimensions: readonly number[],
  transform: Letterbox,
  minScore = 0.25,
) {
  const attributes = dimensions[1];
  const candidates = dimensions[2];
  if (attributes !== 4 + ERAX_LABELS.length || data.length !== attributes * candidates) {
    throw new Error(`Unexpected EraX output shape: ${dimensions.join("x")}`);
  }
  const detections: NudeDetection[] = [];
  for (let index = 0; index < candidates; index += 1) {
    let classId = 0;
    let score = data[4 * candidates + index];
    for (let candidateClass = 1; candidateClass < ERAX_LABELS.length; candidateClass += 1) {
      const candidateScore = data[(4 + candidateClass) * candidates + index];
      if (candidateScore > score) { score = candidateScore; classId = candidateClass; }
    }
    if (score < minScore) continue;
    const cx = data[index];
    const cy = data[candidates + index];
    const width = data[2 * candidates + index];
    const height = data[3 * candidates + index];
    const x1 = Math.max(0, Math.min(transform.sourceWidth, (cx - width / 2 - transform.padX) / transform.scale));
    const y1 = Math.max(0, Math.min(transform.sourceHeight, (cy - height / 2 - transform.padY) / transform.scale));
    const x2 = Math.max(0, Math.min(transform.sourceWidth, (cx + width / 2 - transform.padX) / transform.scale));
    const y2 = Math.max(0, Math.min(transform.sourceHeight, (cy + height / 2 - transform.padY) / transform.scale));
    if (x2 - x1 <= 2 || y2 - y1 <= 2) continue;
    detections.push({ id: classId, label: ERAX_LABELS[classId], score, x: x1, y: y1, width: x2 - x1, height: y2 - y1, rawBox: [cx, cy, width, height] });
  }
  return nonMaxSuppression(detections);
}

async function loadBytes(url: string, onProgress?: (fraction: number) => void) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`EraX model request failed: ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(1);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received / total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
  return bytes;
}

export async function loadEraX(onProgress?: (fraction: number) => void) {
  if (!sessionPromise) {
    sessionPromise = loadBytes(`${import.meta.env.BASE_URL}models/erax/erax-yolo11s.onnx`, onProgress)
      .then((bytes) => ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }));
  }
  const session = await sessionPromise;
  onProgress?.(1);
  return session;
}

function makeInput(image: HTMLImageElement) {
  const transform = letterboxFor(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = transform.inputSize;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "rgb(114,114,114)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const width = Math.round(image.naturalWidth * transform.scale);
  const height = Math.round(image.naturalHeight * transform.scale);
  context.drawImage(image, transform.padX, transform.padY, width, height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const area = canvas.width * canvas.height;
  const input = new Float32Array(area * 3);
  for (let pixel = 0; pixel < area; pixel += 1) {
    input[pixel] = pixels[pixel * 4] / 255;
    input[area + pixel] = pixels[pixel * 4 + 1] / 255;
    input[area * 2 + pixel] = pixels[pixel * 4 + 2] / 255;
  }
  return { tensor: new ort.Tensor("float32", input, [1, 3, canvas.height, canvas.width]), transform };
}

export async function detectNudity(image: HTMLImageElement, minScore = 0.25, onProgress?: (fraction: number) => void) {
  const session = await loadEraX(onProgress);
  const { tensor, transform } = makeInput(image);
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  const output = outputs[session.outputNames[0]];
  const detections = decodeEraXOutput(output.data as Float32Array, output.dims, transform, minScore);
  console.groupCollapsed(`[EraX] 필터링 전 탐지 결과 ${detections.length}개`);
  console.info("좌표 변환", { modelInput: [transform.inputSize, transform.inputSize], sourceImage: [transform.sourceWidth, transform.sourceHeight], scale: transform.scale, padX: transform.padX, padY: transform.padY });
  console.table(detections.map(({ id, label, score, x, y, width, height, rawBox }) => ({ classId: id, label, score: Number(score.toFixed(4)), rawBox, transformedBox: [x, y, width, height].map((value) => Number(value.toFixed(2))) })));
  console.groupEnd();
  return detections;
}
