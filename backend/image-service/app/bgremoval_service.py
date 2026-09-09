"""Background removal via rembg — used to cut an uploaded object photo out of
its background before compositing it into a room. Lazily loaded (see
get_bgremover() in gradio_app.py) since the ONNX weights are a ~176MB
one-time download, matching the SamService/InpaintService convention.
"""
import os

import numpy as np
from PIL import Image


class BgRemovalService:
    def __init__(self):
        print("[BgRemovalService] loading rembg isnet-general-use (first use downloads ~176MB) ...")
        from rembg import new_session, remove
        self._remove = remove
        self.session = new_session("isnet-general-use")
        # Alpha matting refines the cutout's edge (soft, feathered instead of a
        # hard jagged/haloed border) so composited furniture reads as "in the
        # room", not a sticker. Slower on CPU — set PAZL_ALPHA_MATTING=0 to skip.
        self._alpha = os.environ.get("PAZL_ALPHA_MATTING", "1") != "0"
        print(f"[BgRemovalService] ready (alpha_matting={self._alpha}).")

    def remove_background(self, rgb: np.ndarray) -> np.ndarray:
        """RGB HxWx3 -> RGBA HxWx4 with background alpha=0."""
        src = Image.fromarray(rgb)
        if self._alpha:
            try:
                out = self._remove(
                    src,
                    session=self.session,
                    alpha_matting=True,
                    alpha_matting_foreground_threshold=240,
                    alpha_matting_background_threshold=15,
                    alpha_matting_erode_size=11,
                )
                return np.array(out.convert("RGBA"))
            except Exception as e:  # noqa: BLE001 — e.g. pymatting missing → plain
                self._alpha = False
                print(f"[BgRemovalService] alpha matting off ({e}); using plain cut")
        out = self._remove(src, session=self.session)
        return np.array(out.convert("RGBA"))
