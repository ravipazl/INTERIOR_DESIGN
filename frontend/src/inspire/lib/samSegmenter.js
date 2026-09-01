// Thin client for the SAM Web Worker (public/sam.worker.js). All heavy work
// (model load, image encode, segmentation) runs in the worker so the page's main
// thread never freezes. Everything stays in the browser — no server, no cost.
//
// The worker holds the encoded image session; segmentPoint/segmentBox operate on
// the most recently encoded image.

let _worker = null;
let _seq = 0;
const _pending = new Map();
let _onInfo = null; // optional device/dtype callback

function worker() {
  if (!_worker) {
    const base = process.env.PUBLIC_URL || '';
    // ?v= busts the browser cache when the worker (or its refine.js sibling)
    // changes; bump it on any worker/refine.js edit.
    _worker = new Worker(`${base}/sam.worker.js?v=refine4`);
    _worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'info') {
        if (_onInfo) _onInfo(d);
        return;
      }
      const p = _pending.get(d.id);
      if (!p) return;
      _pending.delete(d.id);
      if (d.type === 'error') p.reject(new Error(d.error));
      else p.resolve(d);
    };
    _worker.onerror = (e) => {
      console.error('[sam worker] error:', e.message || e);
    };
  }
  return _worker;
}

function call(msg, transfer) {
  const id = ++_seq;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    worker().postMessage({ ...msg, id }, transfer || []);
  });
}

// Warm up the worker (creates it; model downloads on first encode).
export function preloadModel() {
  worker();
}

export function onDeviceInfo(cb) {
  _onInfo = cb;
}

// Encode an image once. Resolves { width, height, rgba: ArrayBuffer } — the RGBA
// pixels for drawing the base image on the canvas.
export function encodeImage(src) {
  return call({ type: 'encode', src });
}

// Segment under a normalized point [0..1]. Resolves the mask result.
export function segmentPoint(x, y) {
  return call({ type: 'point', x, y });
}

// Segment inside a normalized box [x1,y1,x2,y2]. Resolves the mask result.
// Result: { width, height, numMasks, bestIndex, score, data: ArrayBuffer }.
export function segmentBox(box) {
  return call({ type: 'box', box });
}
