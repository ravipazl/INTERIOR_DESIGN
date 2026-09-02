// SAM segmentation worker — runs the heavy encode/segment OFF the page's main
// thread so the UI never freezes. Served as a static classic worker from
// /sam.worker.js (not bundled by webpack), so it can dynamic-import
// Transformers.js from the CDN and keep onnxruntime entirely in the worker.
/* eslint-disable */
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0';
const MODEL_ID = 'Xenova/sam-vit-base'; // swap to 'Xenova/slimsam-77-uniform' for weak devices

// Phase-1 mask-refinement pipeline (pure functions, browser-only, zero API cost).
// It sits in public/ beside this worker; importScripts resolves it relative to the
// worker's own URL. Bump the ?v= whenever refine.js changes so browsers never
// serve a stale copy from cache. Exposes self.PazlRefine.
importScripts('refine.js?v=3');

let tfMod, model, processor, sessionInputs, sessionEmbeddings, currentDevice;

async function tf() {
  if (!tfMod) {
    tfMod = await import(TRANSFORMERS_CDN);
    tfMod.env.allowLocalModels = false;
    // Quieten onnxruntime. It defaults to logLevel 'warning' and emits several
    // [W:onnxruntime:...] lines per inference session while the SAM model loads:
    //   - "can't constant fold MatMul '/shared_image_embedding/MatMul'" — no CPU
    //     kernel for that fp16 op, so one load-time optimization is skipped;
    //   - "Some nodes were not assigned to the preferred execution providers" —
    //     ORT deliberately puts shape ops on CPU, and says so itself.
    // Both are advisory, neither affects the result, and they arrive with a WASM
    // stack trace that makes them look like crashes. 'error' keeps genuine
    // failures visible while dropping the noise.
    try {
      if (tfMod.env.backends && tfMod.env.backends.onnx) {
        tfMod.env.backends.onnx.logLevel = 'error';
      }
    } catch (e) {
      /* never let a logging preference break model loading */
    }
  }
  return tfMod;
}

async function pickDevice() {
  try {
    if (self.navigator && self.navigator.gpu) {
      const adapter = await self.navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    }
  } catch (e) {}
  return 'wasm';
}

async function load(forceDevice) {
  if (model) return;
  const { SamModel, AutoProcessor } = await tf();
  const device = forceDevice || (await pickDevice());
  // logSeverityLevel 3 = Error (0 Verbose, 1 Info, 2 Warning, 3 Error, 4 Fatal).
  //
  // This has to be set PER SESSION, not just on the global env: the noisy
  // [W:onnxruntime:...] lines ("can't constant fold MatMul", "Some nodes were
  // not assigned to the preferred execution providers") are emitted while ORT
  // BUILDS each inference session, and that path reads the session's own
  // severity. Setting env.backends.onnx.logLevel alone left them all in place —
  // verified by running the worker and reading the console.
  const SESSION_OPTIONS = { logSeverityLevel: 3 };
  const attempts = (
    device === 'webgpu'
      ? [{ device: 'webgpu', dtype: 'fp16' }, { device: 'webgpu', dtype: 'fp32' }, { device: 'wasm', dtype: 'q8' }]
      : [{ device: 'wasm', dtype: 'q8' }]
  ).map((opt) => ({ ...opt, session_options: SESSION_OPTIONS }));
  if (!processor) processor = await AutoProcessor.from_pretrained(MODEL_ID);
  let lastErr;
  for (const opt of attempts) {
    try {
      model = await SamModel.from_pretrained(MODEL_ID, opt);
      currentDevice = opt.device;
      self.postMessage({ type: 'info', device: opt.device, dtype: opt.dtype });
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function toRGBA(raw) {
  const { data, width, height, channels } = raw;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (channels === 1) {
      out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = data[i];
      out[4 * i + 3] = 255;
    } else if (channels === 3) {
      out[4 * i] = data[3 * i];
      out[4 * i + 1] = data[3 * i + 1];
      out[4 * i + 2] = data[3 * i + 2];
      out[4 * i + 3] = 255;
    } else {
      out[4 * i] = data[4 * i];
      out[4 * i + 1] = data[4 * i + 1];
      out[4 * i + 2] = data[4 * i + 2];
      out[4 * i + 3] = data[4 * i + 3];
    }
  }
  return out;
}

self.onmessage = async (e) => {
  const msg = e.data;
  const id = msg.id;
  try {
    if (msg.type === 'encode') {
      await load();
      const { RawImage } = await tf();
      const image = await RawImage.read(msg.src);
      try {
        sessionInputs = await processor(image);
        sessionEmbeddings = await model.get_image_embeddings(sessionInputs);
      } catch (encErr) {
        // A WebGPU/ORT-JSEP crash can strike mid-encode (not at model load), which
        // the load-time fallback never sees. Drop to WASM and retry once so a bad
        // GPU/driver path degrades to slower-but-working instead of erroring out.
        if (currentDevice === 'webgpu') {
          self.postMessage({ type: 'info', encodeFallback: 'wasm', error: String((encErr && encErr.message) || encErr) });
          model = null;
          await load('wasm');
          sessionInputs = await processor(image);
          sessionEmbeddings = await model.get_image_embeddings(sessionInputs);
        } else {
          throw encErr;
        }
      }
      const rgba = toRGBA(image);
      self.postMessage(
        { id, type: 'encoded', width: image.width, height: image.height, rgba: rgba.buffer },
        [rgba.buffer]
      );
    } else if (msg.type === 'point' || msg.type === 'box') {
      const { Tensor, RawImage } = await tf();
      const reshaped = sessionInputs.reshaped_input_sizes[0]; // [h, w]
      const rw = reshaped[1];
      const rh = reshaped[0];
      let extra;
      if (msg.type === 'point') {
        extra = {
          input_points: new Tensor('float32', [msg.x * rw, msg.y * rh], [1, 1, 1, 2]),
          input_labels: new Tensor('int64', [1n], [1, 1, 1]),
        };
      } else {
        // SAM's ONNX decoder has no input_boxes; a box is encoded as two corner
        // points — top-left (label 2) and bottom-right (label 3).
        const b = msg.box;
        const x1 = Math.min(b[0], b[2]) * rw;
        const y1 = Math.min(b[1], b[3]) * rh;
        const x2 = Math.max(b[0], b[2]) * rw;
        const y2 = Math.max(b[1], b[3]) * rh;
        extra = {
          input_points: new Tensor('float32', [x1, y1, x2, y2], [1, 1, 2, 2]),
          input_labels: new Tensor('int64', [2n, 3n], [1, 1, 2]),
        };
      }
      const outputs = await model({ ...sessionEmbeddings, ...extra });
      const masks = await processor.post_process_masks(
        outputs.pred_masks,
        sessionInputs.original_sizes,
        sessionInputs.reshaped_input_sizes
      );
      const mask = RawImage.fromTensor(masks[0][0]);
      const scores = Array.from(outputs.iou_scores.data);
      let best = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
      const arr = mask.data instanceof Uint8Array ? mask.data : new Uint8Array(mask.data);

      // --- Phase-1 refinement -------------------------------------------------
      // Clean the raw SAM mask through the refine() pipeline (largest-CC → morph →
      // validate gate → contour/simplify → feather → metrics). On ANY failure fall
      // back to shipping the raw mask, so selection is never worse than before.
      const w = mask.width;
      const h = mask.height;
      let posted = false;
      try {
        const R = self.PazlRefine;
        const single = R.extractBestMask(arr, w, h, scores.length, best);
        let seed;
        if (msg.type === 'point') {
          seed = [Math.round(msg.x * w), Math.round(msg.y * h)];
        } else {
          const b = msg.box;
          seed = [Math.round(((b[0] + b[2]) / 2) * w), Math.round(((b[1] + b[3]) / 2) * h)];
        }
        const refined = R.refine(single, w, h, seed);
        // Emit a SINGLE-channel mask with numMasks:1/bestIndex:0 so the existing
        // overlay (maskData[numMasks*i + bestIndex]) stays byte-compatible.
        const cleanArr = refined.ok
          ? (refined.mask instanceof Uint8Array ? refined.mask : new Uint8Array(refined.mask))
          : new Uint8Array(w * h); // no-selection → empty mask (overlay draws nothing)
        const transfers = [cleanArr.buffer];
        let alphaBuf = null;
        if (refined.ok && refined.alpha && refined.alpha.buffer) {
          alphaBuf = refined.alpha.buffer;
          transfers.push(alphaBuf);
        }
        self.postMessage(
          {
            id,
            type: 'result',
            width: w,
            height: h,
            numMasks: 1,
            bestIndex: 0,
            score: scores[best],
            data: cleanArr.buffer,
            // richer refine outputs — ignored by the current overlay, available to callers
            noSelection: !refined.ok,
            reasons: refined.ok ? null : refined.reasons,
            polygon: refined.ok ? refined.polygon : null,
            bbox: refined.bbox || null,
            metrics: refined.ok ? refined.metrics : null,
            timings: refined.timings || null,
            alpha: alphaBuf,
          },
          transfers
        );
        posted = true;
      } catch (refineErr) {
        // Surface the reason for debugging, then fall through to the raw path.
        self.postMessage({ type: 'info', refineError: String((refineErr && refineErr.message) || refineErr) });
      }
      if (!posted) {
        self.postMessage(
          {
            id,
            type: 'result',
            width: w,
            height: h,
            numMasks: scores.length,
            bestIndex: best,
            score: scores[best],
            data: arr.buffer,
          },
          [arr.buffer]
        );
      }
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String((err && err.message) || err) });
  }
};
