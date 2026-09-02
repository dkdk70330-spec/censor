import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
import sys
from PIL import Image

if getattr(sys, "frozen", False):
    # PyInstaller has no source files for TorchScript's inspect step. The
    # preprocessing sequence runs eagerly with the same operators instead.
    torch.jit.script = lambda module: module

from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

MIN_MASK_SCORE = 0.90


def encode_runs(mask: np.ndarray) -> list[int]:
    flat = mask.astype(np.uint8).reshape(-1)
    padded = np.concatenate(([0], flat, [0]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return edges.astype(int).tolist()


def prompt_points(box: np.ndarray, attempt: int):
    x1, y1, x2, y2 = box
    center = np.asarray([[(x1 + x2) / 2, (y1 + y2) / 2]], dtype=np.float32)
    if attempt == 0:
        return None, None
    if attempt == 1:
        return center, np.ones(1, dtype=np.int32)
    if x2 - x1 >= y2 - y1:
        points = [[x1 + (x2 - x1) * ratio, center[0, 1]] for ratio in (0.35, 0.5, 0.65)]
    else:
        points = [[center[0, 0], y1 + (y2 - y1) * ratio] for ratio in (0.35, 0.5, 0.65)]
    return np.asarray(points, dtype=np.float32), np.ones(3, dtype=np.int32)


def valid_candidate(mask: np.ndarray, box: np.ndarray):
    x1, y1, x2, y2 = box
    x1i, y1i = max(0, int(np.floor(x1))), max(0, int(np.floor(y1)))
    x2i, y2i = min(mask.shape[1], int(np.ceil(x2))), min(mask.shape[0], int(np.ceil(y2)))
    area = int(mask.sum())
    box_area = max(1, (x2i - x1i) * (y2i - y1i))
    inside = int(mask[y1i:y2i, x1i:x2i].sum())
    center_x, center_y = min(mask.shape[1] - 1, max(0, int((x1 + x2) / 2))), min(mask.shape[0] - 1, max(0, int((y1 + y2) / 2)))
    return area > box_area * 0.02 and area < box_area * 3 and inside / max(1, area) >= 0.65 and bool(mask[center_y, center_x])


def predict_best_mask(predictor: SAM2ImagePredictor, box: np.ndarray):
    best = None
    attempts = 0
    for attempt in range(3):
        points, labels = prompt_points(box, attempt)
        with torch.inference_mode():
            masks, scores, _ = predictor.predict(point_coords=points, point_labels=labels, box=box, multimask_output=True)
        attempts += 1
        for mask, score in zip(masks > 0, scores):
            if valid_candidate(mask, box) and (best is None or float(score) > best[1]):
                best = (mask, float(score))
        if best is not None and best[1] >= MIN_MASK_SCORE:
            return best[0], best[1], attempts
    if best is None:
        raise ValueError("prompt box와 일치하는 윤곽 후보가 없습니다")
    raise ValueError(f"윤곽 점수 {best[1]:.0%}가 최소 기준 {MIN_MASK_SCORE:.0%} 미만입니다")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    image = np.asarray(Image.open(args.image).convert("RGB")).copy()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = build_sam2("configs/sam2.1/sam2.1_hq_hiera_l.yaml", args.checkpoint, device=device)
    predictor = SAM2ImagePredictor(model)
    predictor.set_image(image)

    segments = []
    errors = []
    for item in request["boxes"]:
        try:
            box = np.asarray([item["x"], item["y"], item["x"] + item["width"], item["y"] + item["height"]], dtype=np.float32)
            mask, score, attempts = predict_best_mask(predictor, box)
            segments.append({"id": item["id"], "width": int(mask.shape[1]), "height": int(mask.shape[0]), "runs": encode_runs(mask), "score": score, "attempts": attempts})
        except Exception as error:
            errors.append({"id": item["id"], "message": str(error)})

    Path(args.output).write_text(json.dumps({"device": device, "segments": segments, "errors": errors}), encoding="utf-8")


if __name__ == "__main__":
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    main()
