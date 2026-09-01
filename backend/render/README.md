# Pazl photorealistic render (Phase 1 — manual proof)

Turn a room exported from the app (`.glb`) into a photorealistic PNG using
**Blender + Cycles**, running headless on the Ubuntu server. **No GPU and no
ongoing cost** — it uses CPU on a server you already run.

This phase is a **manual proof of quality**. Once the image looks good, Phase 2
wires it to a "Render" button + backend queue.

---

## 1. Install Blender on the Ubuntu server (one time)

Recommended: the official self-contained build (no GUI/apt dependencies).

```bash
cd /opt
sudo wget https://download.blender.org/release/Blender4.2/blender-4.2.1-linux-x64.tar.xz
sudo tar -xf blender-4.2.1-linux-x64.tar.xz
sudo ln -s /opt/blender-4.2.1-linux-x64/blender /usr/local/bin/blender
blender --version
```

> Use whatever current **LTS** is on https://www.blender.org/download/lts/ —
> just match the folder name in the commands. `apt install blender` also works
> but is often older and pulls GUI packages you don't need on a server.

## 2. Get an HDRI for realistic lighting (optional but recommended)

Download one free indoor/studio HDRI from https://polyhaven.com/hdris
(1k or 2k is plenty), e.g. `studio_small_09_2k.hdr`, and copy it next to this
script. Without it the script still renders using a default sky + sun.

## 3. Render

Copy the `.glb` you exported from the app to the server, then:

```bash
# with HDRI (best quality)
blender -b -P render.py -- room.glb out.png studio_small_09_2k.hdr

# without HDRI (default sky+sun)
blender -b -P render.py -- room.glb out.png
```

`out.png` is your photorealistic render. Open it to judge quality.

## 4. Tuning (top of render.py)

| Setting | Meaning |
|---|---|
| `SAMPLES` | image cleanliness vs. time (128 fast-ish, 512 cleaner) |
| `RES_X` / `RES_Y` | output resolution |
| `CAMERA_DIR` | angle the room is viewed from |
| `FRAME_MARGIN` | padding around the room |

## Notes / known Phase-1 limitations

- **Camera is auto-framed** from an elevated 3/4 angle (the room is open-top, so
  it looks down into it). Phase 2 will use the app's actual camera so the render
  matches the on-screen view.
- **Scale:** the app exports in centimetres; the script frames the camera from
  the scene's bounding box, so absolute scale doesn't matter for the render.
- CPU render time depends on the server — expect a few minutes per image.
