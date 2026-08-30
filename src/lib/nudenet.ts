import * as tf from "@tensorflow/tfjs";

export type NudeDetection = { id: number; label: string; score: number; x: number; y: number; width: number; height: number };

const LABELS = ["노출된 항문", "겨드랑이", "복부", "노출된 복부", "엉덩이", "노출된 엉덩이", "여성 얼굴", "남성 얼굴", "발", "노출된 발", "가슴", "노출된 가슴", "성기", "노출된 성기", "남성 가슴", "노출된 남성 가슴"];
const CENSOR_CLASS_IDS = new Set([0, 5, 11, 12, 13]);
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

export async function detectNudity(image: HTMLImageElement, minScore = 0.38, onProgress?: (fraction: number) => void): Promise<NudeDetection[]> {
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
    const sx = image.naturalWidth / inputWidth;
    const sy = image.naturalHeight / inputHeight;
    return selected.map((index) => {
      const classId = Number(classes[index]);
      const [y1, x1, y2, x2] = boxes[0][index];
      return { id: classId, label: LABELS[classId] ?? `클래스 ${classId}`, score: Number(scores[index]), x: Math.max(0, x1 * sx), y: Math.max(0, y1 * sy), width: Math.min(image.naturalWidth - x1 * sx, (x2 - x1) * sx), height: Math.min(image.naturalHeight - y1 * sy, (y2 - y1) * sy) };
    }).filter((item) => CENSOR_CLASS_IDS.has(item.id) && item.width > 2 && item.height > 2);
  } finally { input.dispose(); }
}
