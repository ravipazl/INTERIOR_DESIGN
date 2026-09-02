"""Text-prompted segmentation via CLIPSeg (CIDAS/clipseg-rd64-refined).

Lazily loaded (see get_textseg() in gradio_app.py), matching the
SamService/InpaintService convention — weights (~600MB) download on first use.
Lets a user type what to select ("the lamp") instead of clicking it; the
resulting mask feeds into the same delete/recolor/comment pipeline as a
click-based SAM2 mask.
"""
import numpy as np
from PIL import Image


class TextSegService:
    def __init__(self):
        print("[TextSegService] loading CLIPSeg (first prompt may be slow, ~600MB download) ...")
        import torch
        from transformers import CLIPSegProcessor, CLIPSegForImageSegmentation
        self.torch = torch
        self.processor = CLIPSegProcessor.from_pretrained("CIDAS/clipseg-rd64-refined")
        self.model = CLIPSegForImageSegmentation.from_pretrained("CIDAS/clipseg-rd64-refined")
        self.model.eval()
        print("[TextSegService] ready.")

    def segment(self, rgb: np.ndarray, prompt: str, threshold: float = 0.4) -> np.ndarray:
        """rgb: HxWx3 uint8. Returns an HxW bool mask matching rgb's dimensions."""
        h, w = rgb.shape[:2]
        image = Image.fromarray(rgb)
        inputs = self.processor(text=[prompt], images=[image], return_tensors="pt")
        with self.torch.no_grad():
            logits = self.model(**inputs).logits

        # CLIPSeg returns one heatmap per (image, prompt) pair; squeeze whatever
        # batch/channel dims come along with the single-prompt case.
        probs = logits.sigmoid()
        while probs.dim() > 2:
            probs = probs[0]

        heatmap = (probs.numpy() * 255).astype(np.uint8)
        resized = np.array(Image.fromarray(heatmap).resize((w, h), Image.BILINEAR))
        return resized > int(threshold * 255)
