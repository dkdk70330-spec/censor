import * as tf from "@tensorflow/tfjs";

export type NudeDetection = { id: number; label: string; score: number; x: number; y: number; width: number; height: number };

export const LABELS = [
  "노출된 항문", "노출된 겨드랑이", "복부", "노출된 복부", "엉덩이", "노출된 엉덩이",
  "여성 얼굴", "남성 얼굴", "발", "노출된 발", "여성 유방", "노출된 여성 유방",
  "가려진 여성 성기", "노출된 여성 성기", "남성 가슴", "노출된 남성 성기",
] as const;
const OUTPUT_NODES = ["output1", "output2", "output3"];
let modelPromise: Promise<tf.GraphModel> | null = null;

export async function loadNudeNet(onProgress?: (fraction: number) => void) {
  if (!modelPromise) modelPromise = (async () => {
    if (tf.engine().registryFactory.webgl) await tf.setBackend("webgl");
    await tf.ready();
    return tf.loadGraphModel(`${import.meta.env.BASE_URL}models/nudenet/model.json`, { onProgress });
  })();
  return modelPromise;
}

export function normalizeDetections(
  boxes: number[][][], scores: ArrayLike<number>, classes: ArrayLike<number>, selected: readonly number[],
  sourceWidth: number, sourceHeight: number, inputWidth: number, inputHeight: number,
): NudeDetection[] {
  const sx = sourceWidth / inputWidth;
  const sy = sourceHeight / inputHeight;
  return selected.map((index) => {
    const classId = Number(classes[index]);
    const [y1, x1, y2, x2] = boxes[0][index];
    return {
      id: classId,
      label: LABELS[classId] ?? `클래스 ${classId}`,
      score: Number(scores[index]),
      x: Math.max(0, x1 * sx),
      y: Math.max(0, y1 * sy),
      width: Math.min(sourceWidth - x1 * sx, (x2 - x1) * sx),
      height: Math.min(sourceHeight - y1 * sy, (y2 - y1) * sy),
    };
  }).filter((item) => Number.isFinite(item.score) && item.width > 2 && item.height > 2);
}

export async function detectNudity(image: HTMLImageElement, minScore = 0.25, onProgress?: (fraction: number) => void): Promise<NudeDetection[]> {
  const model = await loadNudeNet(onProgress);
  const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
  const inputWidth = Math.max(32, Math.round((image.naturalWidth * scale) / 32) * 32);
  const inputHeight = Math.max(32, Math.round((image.naturalHeight * scale) / 32) * 32);
  const input = tf.tidy(() => tf.image.resizeBilinear(tf.browser.fromPixels(image), [inputHeight, inputWidth]).toFloat().expandDims(0));

  try {
    const outputs = await model.executeAsync(input, OUTPUT_NODES) as tf.Tensor[];
    const [boxesTensor, scoresTensor, classesTensor] = outputs;
    const [boxes, scores, classes] = await Promise.all([
      boxesTensor.array() as Promise<number[][][]>, scoresTensor.data(), classesTensor.data(),
    ]);
    const nms = await tf.image.nonMaxSuppressionAsync(boxes[0], scores, 50, 0.5, minScore);
    const selected = Array.from(await nms.data());
    nms.dispose();
    outputs.forEach((tensor) => tensor.dispose());
    const detections = normalizeDetections(boxes, scores, classes, selected, image.naturalWidth, image.naturalHeight, inputWidth, inputHeight);
    console.groupCollapsed(`[NudeNet] 필터링 전 탐지 결과 ${detections.length}개`);
    console.table(detections.map(({ id, label, score, x, y, width, height }) => ({
      classId: id, label, score: Number(score.toFixed(4)), box: [x, y, width, height].map(Math.round),
    })));
    console.groupEnd();
    return detections;
  } finally { input.dispose(); }
}
