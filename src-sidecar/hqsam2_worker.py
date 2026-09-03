import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
import sys
import cv2
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
        positives = [[x1 + (x2 - x1) * ratio, center[0, 1]] for ratio in (0.35, 0.5, 0.65)]
    else:
        positives = [[center[0, 0], y1 + (y2 - y1) * ratio] for ratio in (0.35, 0.5, 0.65)]
    margin = max(2.0, min(x2 - x1, y2 - y1) * 0.12)
    negatives = [[x1 - margin, center[0, 1]], [x2 + margin, center[0, 1]], [center[0, 0], y1 - margin], [center[0, 0], y2 + margin]]
    return np.asarray(positives + negatives, dtype=np.float32), np.asarray([1, 1, 1, 0, 0, 0, 0], dtype=np.int32)


def center_component(mask: np.ndarray, box: np.ndarray):
    x1, y1, x2, y2 = box
    center_x = min(mask.shape[1] - 1, max(0, int((x1 + x2) / 2)))
    center_y = min(mask.shape[0] - 1, max(0, int((y1 + y2) / 2)))
    count, labels = cv2.connectedComponents(mask.astype(np.uint8), connectivity=8)
    label = int(labels[center_y, center_x])
    if count <= 1 or label == 0:
        return np.zeros_like(mask, dtype=bool)
    return labels == label


def valid_candidate(mask: np.ndarray, box: np.ndarray):
    x1, y1, x2, y2 = box
    x1i, y1i = max(0, int(np.floor(x1))), max(0, int(np.floor(y1)))
    x2i, y2i = min(mask.shape[1], int(np.ceil(x2))), min(mask.shape[0], int(np.ceil(y2)))
    area = int(mask.sum())
    box_area = max(1, (x2i - x1i) * (y2i - y1i))
    inside = int(mask[y1i:y2i, x1i:x2i].sum())
    center_x, center_y = min(mask.shape[1] - 1, max(0, int((x1 + x2) / 2))), min(mask.shape[0] - 1, max(0, int((y1 + y2) / 2)))
    ys, xs = np.where(mask)
    if not len(xs):
        return False
    width_ratio = (int(xs.max()) - int(xs.min()) + 1) / max(1, x2 - x1)
    height_ratio = (int(ys.max()) - int(ys.min()) + 1) / max(1, y2 - y1)
    return (
        area > box_area * 0.02
        and area < box_area * 1.8
        and inside / max(1, area) >= 0.82
        and width_ratio <= 1.65
        and height_ratio <= 1.65
        and bool(mask[center_y, center_x])
    )


def limit_mask_spill(mask: np.ndarray, box: np.ndarray, expansion=0.18):
    """Hard-limit accepted output so connected skin cannot spread across the body."""
    x1, y1, x2, y2 = box
    margin_x, margin_y = (x2 - x1) * expansion, (y2 - y1) * expansion
    left = max(0, int(np.floor(x1 - margin_x)))
    top = max(0, int(np.floor(y1 - margin_y)))
    right = min(mask.shape[1], int(np.ceil(x2 + margin_x)))
    bottom = min(mask.shape[0], int(np.ceil(y2 + margin_y)))
    limited = np.zeros_like(mask, dtype=bool)
    limited[top:bottom, left:right] = mask[top:bottom, left:right]
    return limited


def smooth_mask_edge(mask: np.ndarray):
    """Remove one-pixel stair steps without materially changing the contour."""
    source = mask.astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    closed = cv2.morphologyEx(source, cv2.MORPH_CLOSE, kernel, iterations=1)
    softened = cv2.GaussianBlur(closed, (0, 0), sigmaX=0.8, sigmaY=0.8)
    return softened >= 127


def predict_best_mask(predictor: SAM2ImagePredictor, box: np.ndarray, attempt_ids=(0, 1, 2)):
    best = None
    attempts = 0
    for attempt in attempt_ids:
        points, labels = prompt_points(box, attempt)
        with torch.inference_mode():
            masks, scores, _ = predictor.predict(point_coords=points, point_labels=labels, box=box, multimask_output=True)
        attempts += 1
        for raw_mask, score in zip(masks > 0, scores):
            mask = center_component(raw_mask, box)
            if valid_candidate(mask, box) and (best is None or float(score) > best[1]):
                best = (limit_mask_spill(mask, box), float(score))
        if best is not None and best[1] >= MIN_MASK_SCORE:
            return best[0], best[1], attempts
    if best is None:
        raise ValueError("prompt box와 일치하는 윤곽 후보가 없습니다")
    raise ValueError(f"윤곽 점수 {best[1]:.0%}가 최소 기준 {MIN_MASK_SCORE:.0%} 미만입니다")


def refine_box(model, image: np.ndarray, full_predictor: SAM2ImagePredictor, box: np.ndarray):
    try:
        return predict_best_mask(full_predictor, box, (0,))
    except ValueError:
        pass
    height, width = image.shape[:2]
    x1, y1, x2, y2 = box
    padding = max(12, int(min(x2 - x1, y2 - y1) * 0.25))
    roi_x1, roi_y1 = max(0, int(np.floor(x1)) - padding), max(0, int(np.floor(y1)) - padding)
    roi_x2, roi_y2 = min(width, int(np.ceil(x2)) + padding), min(height, int(np.ceil(y2)) + padding)
    crop = image[roi_y1:roi_y2, roi_x1:roi_x2]
    local_box = np.asarray([x1 - roi_x1, y1 - roi_y1, x2 - roi_x1, y2 - roi_y1], dtype=np.float32)
    roi_predictor = SAM2ImagePredictor(model)
    roi_predictor.set_image(crop)
    local_mask, score, attempts = predict_best_mask(roi_predictor, local_box, (1, 2))
    full_mask = np.zeros((height, width), dtype=np.uint8)
    full_mask[roi_y1:roi_y2, roi_x1:roi_x2] = local_mask.astype(np.uint8)
    full_mask = cv2.dilate(full_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)), iterations=1)
    return full_mask > 0, score, attempts + 1


def process_request(model, predictor: SAM2ImagePredictor, image_path: str, request_path: str, output_path: str, device: str) -> None:
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    image = np.asarray(Image.open(image_path).convert("RGB")).copy()
    predictor.set_image(image)

    segments = []
    errors = []
    for item in request["boxes"]:
        try:
            box = np.asarray([item["x"], item["y"], item["x"] + item["width"], item["y"] + item["height"]], dtype=np.float32)
            mask, score, attempts = refine_box(model, image, predictor, box)
            mask = smooth_mask_edge(mask)
            segments.append({"id": item["id"], "width": int(mask.shape[1]), "height": int(mask.shape[0]), "runs": encode_runs(mask), "score": score, "attempts": attempts})
        except Exception as error:
            errors.append({"id": item["id"], "message": str(error)})

    Path(output_path).write_text(json.dumps({"device": device, "segments": segments, "errors": errors}), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--request")
    parser.add_argument("--output")
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = build_sam2("configs/sam2.1/sam2.1_hq_hiera_l.yaml", args.checkpoint, device=device)
    predictor = SAM2ImagePredictor(model)
    if args.serve:
        for line in sys.stdin:
            try:
                job = json.loads(line)
                process_request(model, predictor, job["image"], job["request"], job["output"], device)
                print(json.dumps({"ok": True}), flush=True)
            except Exception as error:
                print(json.dumps({"ok": False, "error": str(error)}), flush=True)
        return
    if not args.image or not args.request or not args.output:
        parser.error("--image, --request and --output are required unless --serve is used")
    process_request(model, predictor, args.image, args.request, args.output, device)


if __name__ == "__main__":
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    main()
