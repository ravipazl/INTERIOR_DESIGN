"""Alpha-compositing helpers for placing a cut-out object image into a room photo."""
import cv2
import numpy as np


def resize_rgba(obj_rgba: np.ndarray, scale_pct: float) -> np.ndarray:
    """Resize an RGBA object image by a scale percentage (100 = original size)."""
    h, w = obj_rgba.shape[:2]
    nh, nw = max(1, int(h * scale_pct / 100)), max(1, int(w * scale_pct / 100))
    interp = cv2.INTER_AREA if scale_pct < 100 else cv2.INTER_LINEAR
    return cv2.resize(obj_rgba, (nw, nh), interpolation=interp)


def feather_alpha(alpha: np.ndarray, radius: int = 9) -> np.ndarray:
    """Soften a hard-edged alpha channel with a Gaussian blur (odd kernel)."""
    k = radius if radius % 2 == 1 else radius + 1
    return cv2.GaussianBlur(alpha.astype(np.float32), (k, k), 0)


def composite(room_rgb: np.ndarray, obj_rgba: np.ndarray, x_pct: float, y_pct: float) -> np.ndarray:
    """Alpha-blend obj_rgba onto room_rgb, centered at (x_pct, y_pct) of room
    dimensions. Clamped so placement partially or fully off-frame never
    indexes out of bounds."""
    out = room_rgb.copy().astype(np.float32)
    oh, ow = obj_rgba.shape[:2]
    rh, rw = room_rgb.shape[:2]

    cx, cy = int(rw * x_pct / 100), int(rh * y_pct / 100)
    x0, y0 = cx - ow // 2, cy - oh // 2
    x1, y1 = x0 + ow, y0 + oh

    dx0, dy0 = max(0, x0), max(0, y0)
    dx1, dy1 = min(rw, x1), min(rh, y1)
    if dx1 <= dx0 or dy1 <= dy0:
        return room_rgb  # fully off-frame

    sx0, sy0 = dx0 - x0, dy0 - y0
    sx1, sy1 = sx0 + (dx1 - dx0), sy0 + (dy1 - dy0)

    src_rgb = obj_rgba[sy0:sy1, sx0:sx1, :3].astype(np.float32)
    alpha = (obj_rgba[sy0:sy1, sx0:sx1, 3].astype(np.float32) / 255.0)[..., None]

    region = out[dy0:dy1, dx0:dx1]
    out[dy0:dy1, dx0:dx1] = region * (1 - alpha) + src_rgb * alpha

    return out.clip(0, 255).astype(np.uint8)
