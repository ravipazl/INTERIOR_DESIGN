"""Deep-learning inpainting via LaMa (simple-lama-inpainting).

Lazily loaded (see get_inpainter() in gradio_app.py) since the torchscript
weights are a ~200MB one-time download and import is slow on first use,
matching the SamService convention.
"""
import numpy as np
from PIL import Image


class InpaintService:
    def __init__(self):
        print("[InpaintService] loading LaMa (first delete may be slow, ~200MB download) ...")
        from simple_lama_inpainting import SimpleLama
        self.model = SimpleLama()
        print("[InpaintService] ready.")

    def inpaint(self, rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """rgb: HxWx3 uint8. mask: HxW bool, True = region to fill."""
        h, w = rgb.shape[:2]
        mask_img = Image.fromarray((mask * 255).astype(np.uint8))
        result = self.model(Image.fromarray(rgb), mask_img).convert("RGB")
        # LaMa pads internally to a multiple of 8 (on the bottom/right) and
        # doesn't crop back — crop rather than resize, so pixels outside the
        # mask stay byte-identical instead of getting resampled/blurred.
        if result.size != (w, h):
            result = result.crop((0, 0, w, h))
        return np.array(result)
