"""Thin wrapper around Meta's SAM2 image predictor (the built-in default path).

Stateless: given an RGB array + click points it returns a mask. It re-runs
`set_image` on every call (re-encodes per click — a few hundred ms on GPU,
slower on CPU). Image storage lives in image_store.py, not here.
"""

import numpy as np
import torch
from sam2.sam2_image_predictor import SAM2ImagePredictor

# hiera-small is a good CPU default (this machine is CPU-only — AMD GPU on Windows
# has no torch acceleration). Bump to "facebook/sam2-hiera-large" for best quality
# on an NVIDIA GPU, or drop to "facebook/sam2-hiera-tiny" for the fastest clicks.
DEFAULT_MODEL_ID = "facebook/sam2-hiera-small"


def _pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class SamService:
    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        self.device = _pick_device()
        print(f"[SamService] loading {model_id} on {self.device} ...")
        self.predictor = SAM2ImagePredictor.from_pretrained(model_id, device=self.device)
        # ENCODE-ONCE cache: the image encoder is the slow part; the decoder
        # (per click) is fast. We remember which image is currently encoded so
        # repeated clicks on the SAME photo skip the encode entirely.
        self._current_image_id: str | None = None
        print("[SamService] ready.")

    # --- Encode-once API (used by the pazl service) -----------------------
    def ensure_image(self, image_id: str, image: np.ndarray) -> None:
        """Encode `image` only if it isn't already the encoded one. Cheap no-op
        on repeat clicks of the same photo — the whole efficiency win."""
        if self._current_image_id == image_id:
            return
        with torch.inference_mode():
            if self.device == "cuda":
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    self.predictor.set_image(image)
            else:
                self.predictor.set_image(image)
        self._current_image_id = image_id

    def predict(self, points, labels) -> tuple[np.ndarray, float]:
        """Decode a mask from click points on the ALREADY-encoded image.
        Call ensure_image() first. Returns (boolean_mask, score)."""
        point_coords = np.array(points, dtype=np.float32)
        point_labels = np.array(labels, dtype=np.int32)
        with torch.inference_mode():
            if self.device == "cuda":
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    masks, scores, _ = self.predictor.predict(
                        point_coords=point_coords,
                        point_labels=point_labels,
                        multimask_output=True,
                    )
            else:
                masks, scores, _ = self.predictor.predict(
                    point_coords=point_coords,
                    point_labels=point_labels,
                    multimask_output=True,
                )
        best = int(np.argmax(scores))
        return masks[best].astype(bool), float(scores[best])

    def invalidate(self, image_id: str) -> None:
        """Force a re-encode of `image_id` next time — e.g. after its pixels
        changed (an inpaint), so clicks segment the edited image, not the old one."""
        if self._current_image_id == image_id:
            self._current_image_id = None

    def segment(
        self,
        image: np.ndarray,
        points: list[list[float]],
        labels: list[int],
    ) -> tuple[np.ndarray, float]:
        """Run SAM2 on an RGB array with the given click points.

        image: HxWx3 uint8 RGB.
        points: [[x, y], ...] in image pixel coords.
        labels: [1, 0, ...]  1 = include, 0 = exclude.
        Returns (boolean_mask, score).
        """
        point_coords = np.array(points, dtype=np.float32)
        point_labels = np.array(labels, dtype=np.int32)

        with torch.inference_mode():
            if self.device == "cuda":
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    self.predictor.set_image(image)
                    masks, scores, _ = self.predictor.predict(
                        point_coords=point_coords,
                        point_labels=point_labels,
                        multimask_output=True,
                    )
            else:
                self.predictor.set_image(image)
                masks, scores, _ = self.predictor.predict(
                    point_coords=point_coords,
                    point_labels=point_labels,
                    multimask_output=True,
                )

        # multimask_output=True returns 3 candidate masks; take the highest-scoring.
        best = int(np.argmax(scores))
        return masks[best].astype(bool), float(scores[best])
