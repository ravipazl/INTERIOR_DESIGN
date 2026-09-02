"""In-memory store of uploaded images, keyed by id.

Decoupled from any model so the default SAM2 path and the adapter models can all
fetch the same image (upload once via /api/images, click many times). Holds
decoded RGB arrays; a production build would cap/evict this (LRU or TTL).
"""
import io
import uuid
import numpy as np
from PIL import Image


class ImageStore:
    def __init__(self):
        self._images: dict[str, np.ndarray] = {}
        # Last mask segmented for an image — so /inpaint can reuse the current
        # selection without the client re-sending the whole mask.
        self._masks: dict[str, np.ndarray] = {}

    def add(self, raw_bytes: bytes) -> tuple[str, int, int]:
        """Decode + store an uploaded image. Returns (image_id, width, height)."""
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        image_id = uuid.uuid4().hex
        self._images[image_id] = np.array(img)
        w, h = img.size
        return image_id, w, h

    def add_array(self, arr: np.ndarray) -> tuple[str, int, int]:
        """Store an already-decoded RGB array (e.g. after downscaling)."""
        image_id = uuid.uuid4().hex
        self._images[image_id] = arr
        h, w = arr.shape[:2]
        return image_id, w, h

    def replace(self, image_id: str, arr: np.ndarray) -> None:
        """Swap an image's pixels in place (an edit becomes the new base)."""
        self._images[image_id] = arr
        self._masks.pop(image_id, None)  # the old selection no longer applies

    def get(self, image_id: str):
        return self._images.get(image_id)

    def has(self, image_id: str) -> bool:
        return image_id in self._images

    def set_mask(self, image_id: str, mask: np.ndarray) -> None:
        self._masks[image_id] = mask

    def get_mask(self, image_id: str):
        return self._masks.get(image_id)
