/**
 * WHAT KIND OF FILE IS IT — read from the file's own first bytes, not its
 * name, so a renamed or damaged file is caught before anything is done with
 * it, and the message says what is wrong and what to do.
 */

/** The largest file read. A floor plan is a few MB; a whole drawing set more. */
export const MAX_IMPORT_BYTES = 60 * 1024 * 1024;

export const IMPORT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.dxf,.dwg,.dwf,.dwfx";

/** What each format is called, for messages and the preview's header. */
export const FORMAT_LABELS = {
  png: "PNG image",
  jpeg: "JPG image",
  webp: "WEBP image",
  pdf: "PDF",
  dxf: "DXF drawing",
  dwg: "DWG drawing",
  dwfx: "DWFx drawing",
};

/**
 * DWG versions, by the code a DWG starts with, and the AutoCAD that saves
 * them. LibreDWG (the server's converter) reads all of these; AutoCAD 2018
 * and every release since save the 2018 format.
 */
const DWG_VERSIONS = {
  AC1009: "R11/R12",
  AC1012: "R13",
  AC1014: "R14",
  AC1015: "2000",
  AC1018: "2004",
  AC1021: "2007",
  AC1024: "2010",
  AC1027: "2013",
  AC1032: "2018",
};

export const userError = (message) => Object.assign(new Error(message), { userFacing: true });

const ascii = (bytes, from, to) =>
  String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));

/**
 * The format of a picked file: { format, label, version? }. Throws a
 * user-facing error for an empty, too large, unsupported or unreadable one.
 */
export const checkImportFile = async (file) => {
  if (!file || !file.size) throw userError("This file is empty. Choose the floor plan file again.");
  if (file.size > MAX_IMPORT_BYTES) {
    throw userError(
      `This file is too large (${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_IMPORT_BYTES / 1048576} MB). Save just the floor plan to a new file and import that.`
    );
  }
  const head = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
  const name = String(file.name || "").toLowerCase();
  const text = ascii(head, 0, head.length);

  if (head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return { format: "png", label: FORMAT_LABELS.png };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { format: "jpeg", label: FORMAT_LABELS.jpeg };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return { format: "webp", label: FORMAT_LABELS.webp };
  // A PDF's header may follow a few bytes of junk; readers allow 1 KB.
  if (text.slice(0, 1024).includes("%PDF-")) return { format: "pdf", label: FORMAT_LABELS.pdf };

  if (/^AC\d{4}/.test(text)) {
    const code = text.slice(0, 6);
    const release = DWG_VERSIONS[code];
    if (release) return { format: "dwg", label: `${FORMAT_LABELS.dwg} (AutoCAD ${release})`, version: code };
    if (code < "AC1009") {
      throw userError("This DWG is from an AutoCAD older than R11, which can't be read. Open it in AutoCAD and save it as a 2018 DWG or a DXF.");
    }
    throw userError("This DWG was saved by a newer AutoCAD than can be read yet. In AutoCAD, use Save As → AutoCAD 2018 DWG (or DXF) and import that.");
  }

  if (/^\(DWF V\d/.test(text)) {
    throw userError(
      "This is a classic DWF, which only stores the drawing for viewing and can't be read here. In AutoCAD, publish it as DWFx or PDF, or send the DWG or DXF instead."
    );
  }
  if (head[0] === 0x50 && head[1] === 0x4b) {
    // A zip: a DWFx is one (an XPS package). Anything else zipped is not a plan.
    if (/\.dwfx?$/.test(name)) return { format: "dwfx", label: FORMAT_LABELS.dwfx };
    throw userError("This file is a zip archive. Unzip it and import the floor plan file inside.");
  }

  if (/^AutoCAD Binary DXF/.test(text)) {
    throw userError("This DXF is saved in binary form. In AutoCAD, save it again as an ASCII DXF.");
  }
  // An ASCII DXF: group code / value pairs, starting with a section (often
  // after comment lines, code 999).
  if (/^\s*(999\s*\r?\n[^\n]*\r?\n\s*)*0\s*\r?\n\s*SECTION\b/.test(text)) {
    return { format: "dxf", label: FORMAT_LABELS.dxf };
  }

  // Not one of the formats: say what it looks like by its name.
  if (/\.(pdf|png|jpe?g|webp|dxf|dwg|dwfx?)$/.test(name)) {
    throw userError("This file looks damaged — its contents don't match its type. Save or export it again and import the new file.");
  }
  if (/\.(gif|bmp|tiff?|heic|heif|svg)$/.test(name)) {
    throw userError("This image type isn't supported. Save the plan as PNG, JPG or PDF and import that.");
  }
  throw userError("This file type isn't supported. Import a PDF, PNG, JPG, WEBP, DXF, DWG or DWFx floor plan.");
};
