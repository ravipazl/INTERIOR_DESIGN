"""Helpers to turn a boolean mask into PNGs the frontend can display."""

import base64
import io
import numpy as np
from PIL import Image


def make_cutout_png(rgb: np.ndarray, mask: np.ndarray) -> bytes:
    """Extract the object: original pixels where mask is True, transparent elsewhere.
    Also crops to the mask's bounding box so the cutout isn't full-frame."""
    h, w = mask.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = rgb
    rgba[..., 3] = np.where(mask, 255, 0).astype(np.uint8)

    ys, xs = np.where(mask)
    if len(xs) and len(ys):
        x0, x1 = xs.min(), xs.max() + 1
        y0, y1 = ys.min(), ys.max() + 1
        rgba = rgba[y0:y1, x0:x1]

    return _to_png_bytes(Image.fromarray(rgba, mode="RGBA"))


def make_mask_overlay_png(mask: np.ndarray) -> bytes:
    """A translucent colored overlay of the full-frame mask, for drawing on top
    of the original image in the UI."""
    h, w = mask.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[mask, 0] = 56    # r
    rgba[mask, 1] = 189   # g
    rgba[mask, 2] = 248   # b (sky-blue highlight)
    rgba[mask, 3] = 128   # ~50% alpha
    return _to_png_bytes(Image.fromarray(rgba, mode="RGBA"))


def _to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def to_data_url(png_bytes: bytes) -> str:
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def rgb_to_data_url(rgb: np.ndarray) -> str:
    """An RGB HxWx3 array -> a data: URL PNG (for an edited/inpainted room)."""
    return to_data_url(_to_png_bytes(Image.fromarray(rgb.astype(np.uint8), mode="RGB")))


def rgba_to_data_url(rgba: np.ndarray) -> str:
    """An RGBA HxWx4 array -> a data: URL PNG (for a background-removed object)."""
    return to_data_url(_to_png_bytes(Image.fromarray(rgba.astype(np.uint8), mode="RGBA")))
