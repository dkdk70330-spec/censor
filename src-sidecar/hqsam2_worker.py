import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
import sys
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

if getattr(sys, "frozen", False):
    # PyInstaller has no source files for TorchScript's inspect step. The
    # preprocessing sequence runs eagerly with the same operators instead.
    torch.jit.script = lambda module: module


def encode_runs(mask: np.ndarray) -> list[int]:
    flat = mask.astype(np.uint8).reshape(-1)
    padded = np.concatenate(([0], flat, [0]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return edges.astype(int).tolist()


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
    for item in request["boxes"]:
        box = np.asarray([item["x"], item["y"], item["x"] + item["width"], item["y"] + item["height"]], dtype=np.float32)
        with torch.inference_mode():
            masks, scores, _ = predictor.predict(box=box, multimask_output=True)
        best = int(np.argmax(scores))
        mask = masks[best] > 0
        segments.append({"id": item["id"], "width": int(mask.shape[1]), "height": int(mask.shape[0]), "runs": encode_runs(mask), "score": float(scores[best])})

    Path(args.output).write_text(json.dumps({"device": device, "segments": segments}), encoding="utf-8")


if __name__ == "__main__":
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    main()
