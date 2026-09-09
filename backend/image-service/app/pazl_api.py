"""pazl image-edit service — a clean REST API over the SAM2 / LaMa / rembg
services, tuned for pazl:

  * ENCODE-ONCE segmentation  (repeat clicks on a photo skip the slow encode)
  * image-size cap            (downscale big uploads → fast + bounded memory)
  * shared-secret auth        (only pazl may call it)
  * serialized inference       (single model at a time → never OOMs a shared box)

All endpoints are sync `def` so FastAPI runs them in its threadpool; a single
threading.Lock around inference serializes them without blocking the event loop.

Run (dev):  uvicorn app.pazl_api:app --host 127.0.0.1 --port 8199
Env:
  PAZL_IMAGEEDIT_SECRET   shared secret sent as the `X-Pazl-Key` header
                          (if unset, auth is OPEN — dev only)
  PAZL_MAX_DIM            max image dimension, default 1536

Flow:
  1. POST /api/session   (file)                      -> { image_id, width, height }
  2. POST /api/segment   {image_id, points, labels}  -> { score, bbox, mask_png, cutout_png }
  3. POST /api/inpaint   {image_id}                   -> { image_png }   (REMOVE the selection)
  4. POST /api/bgremove  (file)                       -> { object_png }  (ADD step 1)
  5. POST /api/composite (image_id, obj, x,y,scale)   -> { image_png }   (ADD step 2)
"""

import io
import os
import threading
from contextlib import asynccontextmanager

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

from .image_store import ImageStore
from .imaging import (
    make_cutout_png,
    make_mask_overlay_png,
    rgb_to_data_url,
    rgba_to_data_url,
    to_data_url,
)
from .sam_service import SamService

MAX_DIM = int(os.environ.get("PAZL_MAX_DIM", "1536"))
SECRET = os.environ.get("PAZL_IMAGEEDIT_SECRET", "")

sam: SamService | None = None
store = ImageStore()
_inpaint = None
_bg = None
# One model runs at a time: a single worker + this lock keeps memory bounded and
# stops SAM2/LaMa from fighting for CPU on a shared server.
_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global sam
    sam = SamService()  # warm SAM2 at startup so the first click is instant
    yield
    sam = None


app = FastAPI(title="pazl image-edit", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


def require_key(x_pazl_key: str = Header(default="")):
    """Shared-secret gate. If PAZL_IMAGEEDIT_SECRET is unset (dev), it's open."""
    if SECRET and x_pazl_key != SECRET:
        raise HTTPException(401, "unauthorized")


def _load_rgb(raw: bytes) -> np.ndarray:
    """Decode + downscale to MAX_DIM. Bounds inference time and memory, and the
    mask/coords all live in this working resolution (the client works in it too)."""
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size
    m = max(w, h)
    if m > MAX_DIM:
        s = MAX_DIM / m
        img = img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    return np.array(img)


def _lazy_inpaint():
    global _inpaint
    if _inpaint is None:
        from .inpaint_service import InpaintService

        _inpaint = InpaintService()
    return _inpaint


def _lazy_bg():
    global _bg
    if _bg is None:
        from .bgremoval_service import BgRemovalService

        _bg = BgRemovalService()
    return _bg


_textseg = None


def _lazy_textseg():
    global _textseg
    if _textseg is None:
        from .textseg_service import TextSegService

        _textseg = TextSegService()
    return _textseg


# ---- health -----------------------------------------------------------------
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "device": sam.device if sam else "loading",
        "max_dim": MAX_DIM,
        "auth": bool(SECRET),
        "inpaint_loaded": _inpaint is not None,
        "bg_loaded": _bg is not None,
        "textseg_loaded": _textseg is not None,
    }


# ---- 1) session: upload + encode ONCE --------------------------------------
@app.post("/api/session", dependencies=[Depends(require_key)])
def session(file: UploadFile = File(...)):
    raw = file.file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    arr = _load_rgb(raw)
    image_id, w, h = store.add_array(arr)
    with _lock:
        sam.ensure_image(image_id, arr)  # warm encode now → first click instant
    return {"image_id": image_id, "width": w, "height": h}


# ---- 2) segment: click -> mask (reuses the cached encode) ------------------
class SegReq(BaseModel):
    image_id: str
    points: list[list[float]]  # [[x, y], ...] in working-image pixel coords
    labels: list[int]          # [1, 0, ...] 1=include, 0=exclude


@app.post("/api/segment", dependencies=[Depends(require_key)])
def segment(req: SegReq):
    if sam is None:
        raise HTTPException(503, "model still loading")
    image = store.get(req.image_id)
    if image is None:
        raise HTTPException(404, "image_id not found — call /api/session first")
    if not req.points or len(req.points) != len(req.labels):
        raise HTTPException(400, "points and labels must be non-empty and equal length")
    with _lock:
        sam.ensure_image(req.image_id, image)  # cheap no-op on repeat clicks
        mask, score = sam.predict(req.points, req.labels)
    store.set_mask(req.image_id, mask)
    ys, xs = np.where(mask)
    bbox = (
        [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        if len(xs)
        else None
    )
    return {
        "score": score,
        "bbox": bbox,
        "mask_png": to_data_url(make_mask_overlay_png(mask)),
        "cutout_png": to_data_url(make_cutout_png(image, mask)),
    }


# ---- 2b) text-select: type what to select (CLIPSeg) ------------------------
class TextSegReq(BaseModel):
    image_id: str
    prompt: str
    threshold: float = 0.4


@app.post("/api/textseg", dependencies=[Depends(require_key)])
def textseg(req: TextSegReq):
    image = store.get(req.image_id)
    if image is None:
        raise HTTPException(404, "image_id not found — call /api/session first")
    if not req.prompt.strip():
        raise HTTPException(400, "empty prompt")
    with _lock:
        mask = _lazy_textseg().segment(image, req.prompt, req.threshold)
    ys, xs = np.where(mask)
    bbox = (
        [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        if len(xs)
        else None
    )
    return {
        "bbox": bbox,
        "area_frac": float(mask.mean()),
        "mask_png": to_data_url(make_mask_overlay_png(mask)),
    }


# ---- 3) inpaint: REMOVE the selected object --------------------------------
class InpaintReq(BaseModel):
    image_id: str


@app.post("/api/inpaint", dependencies=[Depends(require_key)])
def inpaint(req: InpaintReq):
    import cv2

    image = store.get(req.image_id)
    mask = store.get_mask(req.image_id)
    if image is None:
        raise HTTPException(404, "image_id not found")
    if mask is None:
        raise HTTPException(400, "no selection — call /api/segment first")

    # DILATE the mask before inpainting. A tight SAM2 silhouette leaves the
    # object's soft edge pixels OUTSIDE the mask, and LaMa reconstructs the
    # object from them (it doesn't get removed). Growing the mask a few pixels
    # covers the object + a margin so the fill is clean. Env-tunable.
    grow = int(os.environ.get("PAZL_MASK_DILATE", "12"))
    if grow > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1))
        fill_mask = cv2.dilate(mask.astype(np.uint8), k, iterations=1).astype(bool)
    else:
        fill_mask = mask

    try:
        with _lock:
            filled = _lazy_inpaint().inpaint(image, fill_mask)
    except Exception as e:  # noqa: BLE001 — LaMa failed → OpenCV TELEA fallback
        filled = cv2.inpaint(image, (fill_mask * 255).astype(np.uint8), 3, cv2.INPAINT_TELEA)
        print(f"[pazl] LaMa failed ({e}); used TELEA fallback")
    store.replace(req.image_id, filled)  # the edit becomes the new base
    sam.invalidate(req.image_id)         # re-encode next click (pixels changed)
    return {"image_png": rgb_to_data_url(filled)}


# ---- 3b) REMOVE with a client-supplied mask (for the in-browser Studio) -----
# The existing Pazl Studio selects client-side (browser SAM), so the server never
# saw the image/mask. This session-less endpoint takes the image + mask directly,
# dilates + inpaints, and returns the filled image — the ONE server call the
# otherwise-free client-side editor makes.
@app.post("/api/inpaint_mask", dependencies=[Depends(require_key)])
def inpaint_mask(image: UploadFile = File(...), mask: UploadFile = File(...)):
    import cv2

    img_raw = image.file.read()
    mask_raw = mask.file.read()
    if not img_raw or not mask_raw:
        raise HTTPException(400, "image and mask are both required")
    rgb = _load_rgb(img_raw)
    m = np.array(Image.open(io.BytesIO(mask_raw)).convert("L"))
    # The browser may send the mask at a different resolution than the (capped)
    # image — resize it to match so they align pixel-for-pixel.
    if m.shape[:2] != rgb.shape[:2]:
        m = np.array(
            Image.fromarray(m).resize((rgb.shape[1], rgb.shape[0]), Image.NEAREST)
        )
    mask_bool = m > 127

    grow = int(os.environ.get("PAZL_MASK_DILATE", "12"))
    if grow > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1))
        mask_bool = cv2.dilate(mask_bool.astype(np.uint8), k, iterations=1).astype(bool)

    if not mask_bool.any():
        raise HTTPException(400, "empty mask")

    try:
        with _lock:
            filled = _lazy_inpaint().inpaint(rgb, mask_bool)
    except Exception as e:  # noqa: BLE001 — LaMa failed → OpenCV TELEA fallback
        filled = cv2.inpaint(rgb, (mask_bool * 255).astype(np.uint8), 3, cv2.INPAINT_TELEA)
        print(f"[pazl] LaMa failed ({e}); used TELEA fallback")

    return {"image_png": rgb_to_data_url(filled)}


# ---- 4) add object: background removal --------------------------------------
@app.post("/api/bgremove", dependencies=[Depends(require_key)])
def bgremove(file: UploadFile = File(...)):
    raw = file.file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    rgb = _load_rgb(raw)
    with _lock:
        rgba = _lazy_bg().remove_background(rgb)
    return {"object_png": rgba_to_data_url(rgba)}


# ---- 5) add object: composite onto the room --------------------------------
@app.post("/api/composite", dependencies=[Depends(require_key)])
def composite_endpoint(
    image_id: str = Form(...),
    obj: UploadFile = File(...),  # the RGBA object PNG (from /bgremove)
    x_pct: float = Form(50.0),
    y_pct: float = Form(50.0),
    scale_pct: float = Form(100.0),
):
    from . import compositing

    room = store.get(image_id)
    if room is None:
        raise HTTPException(404, "image_id not found")
    raw = obj.file.read()
    if not raw:
        raise HTTPException(400, "empty object file")
    obj_rgba = np.array(Image.open(io.BytesIO(raw)).convert("RGBA"))
    if scale_pct != 100.0:
        obj_rgba = compositing.resize_rgba(obj_rgba, scale_pct)
    result = compositing.composite(room, obj_rgba, x_pct, y_pct)
    store.replace(image_id, result)
    sam.invalidate(image_id)
    return {"image_png": rgb_to_data_url(result)}
