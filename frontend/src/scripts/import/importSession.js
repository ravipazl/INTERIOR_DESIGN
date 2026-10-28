import JSZip from "jszip";
import axios from "../../react-app/services/apiService";
import { AuthService } from "../../react-app/services/authService";
import { checkImportFile, userError } from "./fileCheck";
import { PT_CM, openPdf, pageLines, pageSize, pageThumbnail, renderPage } from "./pdfSource";

/** One PDF point on paper, in millimetres. */
const PT_MM = PT_CM * 10;

/**
 * ONE FILE BEING IMPORTED: reading it into something the preview can show,
 * whatever its format, and answering the preview's questions about it.
 *
 *   PNG / JPG / WEBP  decoded in the browser (its photo orientation applied)
 *   PDF               pdf.js: pages, layers, sharp renders, CAD lines
 *   DXF               read in the import worker
 *   DWG               turned into DXF by the server (LibreDWG), then as DXF
 *   DWFx              unzipped here, each sheet read in the import worker
 *
 * Everything heavy runs off the page's thread (pdf.js's worker, the import
 * worker), and a session can be closed at any moment: the worker is stopped,
 * the PDF released, an upload to the server called off.
 */

/** How long the server may take to convert a DWG (a big drawing set: a minute). */
const DWG_TIMEOUT_MS = 180000;

export class ImportSession {
  constructor(file) {
    this.file = file;
    this.format = null;
    this.label = "";
    this.worker = null;
    this.pdf = null;
    this.zip = null;
    this.sheets = [];
    this.closed = false;
    this.__seq = 0;
    this.__pending = new Map();
    this.__abort = new AbortController();
  }

  // ── the import worker ──

  __worker() {
    if (!this.worker) {
      this.worker = new Worker(new URL("./cadWorker.js", import.meta.url));
      this.worker.onmessage = (e) => {
        const msg = e.data || {};
        const wait = this.__pending.get(msg.id);
        if (!wait) return;
        this.__pending.delete(msg.id);
        if (msg.error) {
          wait.reject(
            msg.userFacing
              ? userError(msg.error)
              : Object.assign(new Error(msg.error), { fromWorker: true })
          );
        } else wait.resolve(msg);
      };
      this.worker.onerror = (e) => {
        console.error("Import worker failed", e);
        this.__pending.forEach((w) =>
          w.reject(userError("This drawing couldn't be read. It may be damaged; save it again and retry."))
        );
        this.__pending.clear();
      };
    }
    return this.worker;
  }

  __call(type, payload = {}, transfer = []) {
    if (this.closed) return Promise.reject(userError("The import was closed."));
    const id = ++this.__seq;
    return new Promise((resolve, reject) => {
      this.__pending.set(id, { resolve, reject });
      this.__worker().postMessage({ id, type, ...payload }, transfer);
    });
  }

  // ── opening ──

  /**
   * Read the file. Returns what the preview starts from:
   *   { kind: "image", bitmap, w, h }
   *   { kind: "pdf", pages, layers }
   *   { kind: "cad", summary }
   *   { kind: "dwfx", sheets: [{ name }] }
   *
   * @param {(step: string) => void} [onStep]  told each step, to show it
   */
  async open(onStep = (step) => {}) { // eslint-disable-line no-unused-vars
    const check = await checkImportFile(this.file);
    this.format = check.format;
    this.label = check.label;
    switch (check.format) {
      case "png":
      case "jpeg":
      case "webp": {
        onStep("Opening image…");
        let bitmap;
        try {
          bitmap = await createImageBitmap(this.file, { imageOrientation: "from-image" });
        } catch (e) {
          throw userError("This image couldn't be opened. It may be damaged; save it again and retry.");
        }
        return { kind: "image", bitmap, w: bitmap.width, h: bitmap.height };
      }
      case "pdf": {
        onStep("Opening PDF…");
        const { pdf, pages, layers } = await openPdf(await this.file.arrayBuffer());
        this.pdf = pdf;
        return { kind: "pdf", pages, layers };
      }
      case "dxf": {
        onStep("Reading drawing…");
        const { summary } = await this.__call("dxf", { file: this.file });
        return { kind: "cad", summary };
      }
      case "dwg": {
        onStep("Converting DWG on the server…");
        const buffer = await this.__dwgToDxf(onStep);
        onStep("Reading drawing…");
        const { summary } = await this.__call("dxf", { buffer }, [buffer]);
        return { kind: "cad", summary };
      }
      case "dwfx": {
        onStep("Opening DWFx…");
        try {
          this.zip = await JSZip.loadAsync(this.file);
        } catch (e) {
          throw userError("This DWFx is damaged or couldn't be opened. Publish it again from AutoCAD.");
        }
        const pages = Object.keys(this.zip.files)
          .filter((p) => /\.fpage$/i.test(p) && !this.zip.files[p].dir)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (!pages.length) {
          throw userError(
            "This DWFx has no 2D sheets that can be read. Publish the floor plan as DWFx or PDF from AutoCAD, or send the DWG or DXF."
          );
        }
        this.sheets = pages.map((path, i) => ({ path, name: `Sheet ${i + 1}` }));
        return { kind: "dwfx", sheets: this.sheets.map((s) => ({ name: s.name })) };
      }
      default:
        throw userError("This file type isn't supported.");
    }
  }

  async __dwgToDxf(onStep) {
    const fd = new FormData();
    fd.append("drawing", this.file, this.file.name);
    const fallback = "This DWG couldn't be read. In AutoCAD, save it as DXF (or a 2018 DWG) and import that.";
    const message = (data) => {
      try {
        if (data instanceof ArrayBuffer) data = JSON.parse(new TextDecoder().decode(data));
        return data && data.message;
      } catch (e) {
        return null;
      }
    };
    let res;
    try {
      res = await axios.post("/dwg-to-dxf", fd, {
        headers: {
          Authorization: `Bearer ${AuthService.getAccessToken()}`,
          "Content-Type": "multipart/form-data",
        },
        responseType: "arraybuffer",
        timeout: DWG_TIMEOUT_MS,
        signal: this.__abort.signal,
        onUploadProgress: (e) => {
          if (e.total) onStep(`Uploading DWG… ${Math.round((e.loaded / e.total) * 100)}%`);
          if (e.total && e.loaded >= e.total) onStep("Converting DWG on the server…");
        },
      });
    } catch (err) {
      if (this.closed) throw userError("The import was closed.");
      if (err && err.code === "ECONNABORTED") {
        throw userError("Converting this DWG took too long. Save just the floor plan to a new DWG or DXF and import that.");
      }
      throw userError(
        message(err && err.response && err.response.data) ||
          (err && err.response ? fallback : "Couldn't reach the server. Check your connection and try again.")
      );
    }
    if (res.status < 200 || res.status >= 300 || !res.data || !res.data.byteLength) {
      throw userError(message(res.data) || fallback);
    }
    return res.data;
  }

  // ── PDF ──

  pdfThumbnail(n, px) {
    return pageThumbnail(this.pdf, n, px);
  }

  pdfPageSize(n, turn) {
    return pageSize(this.pdf, n, turn);
  }

  pdfRender(n, opts) {
    return renderPage(this.pdf, n, opts);
  }

  /** A PDF page's lines, read into the worker. Returns { summary, isDrawing }. */
  async pdfLines(n, { hidden, turn }) {
    const r = await pageLines(this.pdf, n, { hidden, turn });
    if (!r.isDrawing) return { summary: null, isDrawing: false };
    const { summary } = await this.__call("lines", {
      segs: r.segs,
      texts: r.texts,
      truncated: r.truncated,
      mmPerUnit: PT_MM,
    });
    summary.page = { w: r.w, h: r.h };
    return { summary, isDrawing: true };
  }

  // ── DWFx ──

  async dwfxSheet(i) {
    const sheet = this.sheets[i];
    if (!sheet) throw userError("That sheet isn't in the file.");
    const xml = await this.zip.file(sheet.path).async("string");
    const { summary } = await this.__call("xps", { xml });
    return { summary };
  }

  // ── walls ──

  /**
   * The plan's overall size in the drawing's own units — { w, h, minX, minY,
   * maxX, maxY } — within `region` (a crop) when given.
   */
  async planExtent(roles, region) {
    const { extent } = await this.__call("extent", { roles, region: region || null });
    return extent;
  }

  /**
   * Which layer holds the walls, in a drawing with none named for them, at the
   * scale `unit` (centimetres per unit): { layer, walls, share } or null.
   */
  async pickWalls(unit, region) {
    const { picked } = await this.__call("pickWalls", { unit, region: region || null });
    return picked;
  }

  /** Walls, doors, windows and room names from the open drawing. */
  async analyze({ roles, unit, region }) {
    const { analysis } = await this.__call("analyze", { roles, unit, region });
    return analysis;
  }

  close() {
    this.closed = true;
    this.__abort.abort();
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.__pending.forEach((w) => w.reject(userError("The import was closed.")));
    this.__pending.clear();
    if (this.pdf) this.pdf.destroy().catch(() => {});
    this.pdf = null;
    this.zip = null;
  }
}
