/**
 * Drawing2DExport — lays out the 4-view drawing from Drawing2DEngine onto a
 * sheet and renders it to SVG (preview), DXF (AutoCAD) and PDF.
 *
 * Design: one layout pass — `composeSheet` — turns the engine result into a
 * flat list of primitives (lines / text / rects) in paper millimetres,
 * Y-DOWN. The three renderers are then thin: SVG and PDF consume the
 * primitives directly; DXF flips Y (CAD space is Y-up) and maps styles to
 * layers. Dimension lines, view labels and the title block are therefore
 * written once, not three times.
 *
 * Scale: SVG/PDF use a "nice" ratio (1:1, 1:10, 1:25, ...) chosen so the
 * sheet fits a target area — the ratio is printed in the title block. DXF
 * is emitted at 1:1 real-world millimetres so AutoCAD measurements are
 * true; the user picks a plot scale there.
 */

import { jsPDF } from "jspdf";

// "Nice" drawing scales, largest first (paper-mm per real-mm).
const NICE_SCALES = [
  1, 0.5, 0.2, 0.1, 0.05, 0.04, 0.02, 0.01, 0.005, 0.002, 0.001,
];

// Target content area for SVG/PDF (≈ A3 landscape minus margin), in mm.
const TARGET_W = 380;
const TARGET_H = 260;

// ---------------------------------------------------------------------------
// Layout

function pickScale(sheetW1, sheetH1) {
  const maxS = Math.min(TARGET_W / sheetW1, TARGET_H / sheetH1);
  for (const s of NICE_SCALES) {
    if (s <= maxS) return s;
  }
  return NICE_SCALES[NICE_SCALES.length - 1];
}

function scaleLabel(s) {
  if (s >= 1) return `${s}:1`;
  return `1:${Math.round(1 / s)}`;
}

function addHDim(prims, x1, x2, y, value, h) {
  const tick = h * 0.55;
  prims.push({ t: "line", x1, y1: y, x2, y2: y, style: "dim" });
  prims.push({
    t: "line",
    x1: x1 - tick, y1: y + tick, x2: x1 + tick, y2: y - tick, style: "dim",
  });
  prims.push({
    t: "line",
    x1: x2 - tick, y1: y + tick, x2: x2 + tick, y2: y - tick, style: "dim",
  });
  prims.push({
    t: "text",
    x: (x1 + x2) / 2, y: y - h * 0.7, text: value, h, align: "center",
  });
}

function addVDim(prims, x, y1, y2, value, h) {
  const tick = h * 0.55;
  prims.push({ t: "line", x1: x, y1, x2: x, y2: y2, style: "dim" });
  prims.push({
    t: "line",
    x1: x - tick, y1: y1 - tick, x2: x + tick, y2: y1 + tick, style: "dim",
  });
  prims.push({
    t: "line",
    x1: x - tick, y1: y2 - tick, x2: x + tick, y2: y2 + tick, style: "dim",
  });
  prims.push({
    t: "text",
    x: x - h * 0.7, y: (y1 + y2) / 2, text: value, h, align: "right",
  });
}

/**
 * Build the laid-out sheet at a given scale.
 * @returns {{width,height,primitives,scale}}
 */
function composeSheet(result, scale) {
  const s = scale;
  const D = result.dimensions;
  // `base` is a real-mm typographic unit derived from the item size.
  const base = Math.max(D.width, D.height, D.depth, 100) * 0.04;

  const pad = base * 2.2 * s; // sheet margin
  const gap = base * 3.2 * s; // gap between view cells
  const labelH = base * 0.95 * s;
  const dimH = base * 0.8 * s;
  const titleH = base * 0.92 * s;
  const belowView = base * 2.0 * s; // space under a view for its label
  const dimGap = base * 2.0 * s; // dimension-line offset from geometry
  const tagR = base * 0.62 * s; // item-tag bubble radius
  const tagTextH = base * 0.52 * s; // item-tag number height

  const views = {};
  result.views.forEach((v) => (views[v.id] = v));
  const vw = (id) => views[id].width * s;
  const vh = (id) => views[id].height * s;

  const col0 = Math.max(vw("front"), vw("left"));
  const col1 = Math.max(vw("top"), vw("right"));
  const row0 = Math.max(vh("front"), vh("top"));
  const row1 = Math.max(vh("left"), vh("right"));

  const leftReserve = dimGap + dimH * 3.5; // height/depth dimension + text
  const bottomReserve = belowView + labelH;

  const gridX = pad + leftReserve;
  const gridY = pad + dimH * 2;

  const col0Cx = gridX + col0 / 2;
  const col1Cx = gridX + col0 + gap + col1 / 2;
  const row0Cy = gridY + row0 / 2;
  const row1Cy = gridY + row0 + gap + bottomReserve + row1 / 2;

  const cellCenter = {
    front: [col0Cx, row0Cy],
    top: [col1Cx, row0Cy],
    left: [col0Cx, row1Cy],
    right: [col1Cx, row1Cy],
  };

  const prims = [];

  // view geometry + labels
  // Hidden (dashed) lines add clutter on detailed / organic models. The caller
  // drops them by passing result.showHidden === false; anything else keeps the
  // existing behaviour (room drawings, unset callers, are unaffected).
  const keepHidden = result.showHidden !== false;
  for (const v of result.views) {
    const [cx, cy] = cellCenter[v.id];
    for (const seg of v.segments) {
      if (seg.hidden && !keepHidden) continue;
      prims.push({
        t: "line",
        x1: cx + seg.x1 * s,
        y1: cy - seg.y1 * s, // engine Y is up; sheet Y is down
        x2: cx + seg.x2 * s,
        y2: cy - seg.y2 * s,
        style: seg.hidden ? "hidden" : "visible",
      });
    }
    // numbered item tags (room drawings only)
    if (v.tags) {
      for (const tag of v.tags) {
        const tcx = cx + tag.x * s;
        const tcy = cy - tag.y * s;
        prims.push({ t: "circle", x: tcx, y: tcy, r: tagR, style: "tag" });
        prims.push({
          t: "text",
          x: tcx,
          y: tcy,
          text: String(tag.no),
          h: tagTextH,
          align: "center",
        });
      }
    }
    prims.push({
      t: "text",
      x: cx,
      y: cy + (v.height * s) / 2 + belowView,
      text: v.label.toUpperCase(),
      h: labelH,
      align: "center",
    });

    // Schematic parts: put ONLY a small numbered tag (P1, P2 …) at each box's
    // top-left corner. Dimensions go in the PARTS LIST table below — cramming
    // "W x H" into overlapping boxes made the drawing unreadable. The tag ties
    // the same part across all four views to its table row.
    if (Array.isArray(v.parts) && v.parts.length) {
      const partLabelH = base * 0.55 * s;
      for (const pt of v.parts) {
        prims.push({
          t: "text",
          x: cx + pt.x1 * s + partLabelH * 0.5,
          y: cy - pt.y2 * s + partLabelH * 1.05, // y2 is the box top (Y up)
          text: "P" + (pt.idx + 1),
          h: partLabelH,
          align: "left",
        });
      }
    }
  }

  // principal dimensions: W & H on Front, D on Top
  {
    const f = views.front;
    const [cx, cy] = cellCenter.front;
    const hw = (f.width * s) / 2;
    const hh = (f.height * s) / 2;
    addHDim(prims, cx - hw, cx + hw, cy + hh + dimGap, `${Math.round(f.width)}`, dimH);
    addVDim(prims, cx - hw - dimGap, cy - hh, cy + hh, `${Math.round(f.height)}`, dimH);
  }
  {
    const tp = views.top;
    const [cx, cy] = cellCenter.top;
    const hh = (tp.height * s) / 2;
    addVDim(
      prims,
      cx - (tp.width * s) / 2 - dimGap,
      cy - hh,
      cy + hh,
      `${Math.round(tp.height)}`,
      dimH
    );
  }

  const contentRight = col1Cx + col1 / 2;
  const contentBottom = row1Cy + row1 / 2 + bottomReserve;

  // title block
  const tbX = pad;
  const tbY = contentBottom + gap * 0.6;
  const tbRow = titleH * 1.9;
  const tbH = tbRow * 4;
  const tbW = Math.max(contentRight - pad, base * 70 * s);

  // furniture schedule table (room drawings only; object drawings omit it)
  const sched = Array.isArray(result.items) ? result.items : [];
  const schedRowH = titleH * 1.85;
  const schedY = tbY + tbH + gap * 0.7;
  const schedH = sched.length ? schedRowH * (sched.length + 1) : 0;

  // parts list table (schematic item drawings) — one row per component, keyed
  // to the P1/P2 tags on the boxes. This is where every part's real size lives.
  const partsList =
    result.style === "schematic" && Array.isArray(result.parts)
      ? result.parts
      : [];
  const partsRowH = titleH * 1.85;
  const partsY = tbY + tbH + gap * 0.7;
  const partsHeaderPad = titleH * 1.1;
  const partsH = partsList.length
    ? partsHeaderPad + partsRowH * (partsList.length + 1)
    : 0;

  const sheetW = Math.max(contentRight, tbX + tbW) + pad;
  const sheetH =
    (sched.length
      ? schedY + schedH
      : partsList.length
      ? partsY + partsH
      : tbY + tbH) + pad;

  // sheet border
  prims.unshift({
    t: "rect",
    x: pad * 0.45,
    y: pad * 0.45,
    w: sheetW - pad * 0.9,
    h: sheetH - pad * 0.9,
    style: "border",
  });

  // title block frame + rows
  prims.push({ t: "rect", x: tbX, y: tbY, w: tbW, h: tbH, style: "border" });
  const tx = tbX + titleH * 0.9;
  const rowY = (i) => tbY + tbRow * (i + 0.5);
  const date = (result.generatedAt || "").slice(0, 10);
  const rows = [
    `PAZL  -  FURNITURE SHOP DRAWING`,
    `Item:  ${result.itemName}`,
    `Overall:  W ${D.width}  x  H ${D.height}  x  D ${D.depth} mm`,
    `Scale ${scaleLabel(s)}     Units: mm     Date: ${date}`,
  ];
  rows.forEach((text, i) => {
    prims.push({
      t: "text",
      x: tx,
      y: rowY(i),
      text,
      h: i === 0 ? titleH * 1.05 : titleH * 0.85,
      align: "left",
    });
    if (i < rows.length - 1) {
      prims.push({
        t: "line",
        x1: tbX,
        y1: tbY + tbRow * (i + 1),
        x2: tbX + tbW,
        y2: tbY + tbRow * (i + 1),
        style: "dim",
      });
    }
  });

  // furniture schedule table — one row per item, keyed to the numbered tags
  if (sched.length) {
    const schedW = tbW;
    const fr = [0.08, 0.44, 0.13, 0.13, 0.13, 0.09]; // column width fractions
    const edge = [0];
    for (let i = 0; i < fr.length; i++) {
      edge.push(edge[i] + fr[i] * schedW);
    }
    const cellH = titleH * 0.82;
    const headers = ["No.", "Item", "W", "H", "D", "Qty"];

    prims.push({
      t: "text",
      x: tbX,
      y: schedY - cellH * 0.8,
      text: "FURNITURE SCHEDULE  (mm)",
      h: cellH,
      align: "left",
    });
    prims.push({
      t: "rect",
      x: tbX,
      y: schedY,
      w: schedW,
      h: schedH,
      style: "border",
    });
    for (let r = 1; r <= sched.length; r++) {
      const ly = schedY + schedRowH * r;
      prims.push({
        t: "line",
        x1: tbX,
        y1: ly,
        x2: tbX + schedW,
        y2: ly,
        style: "dim",
      });
    }
    for (let c = 1; c < fr.length; c++) {
      const lx = tbX + edge[c];
      prims.push({
        t: "line",
        x1: lx,
        y1: schedY,
        x2: lx,
        y2: schedY + schedH,
        style: "dim",
      });
    }
    const cell = (c, cyy, text, align) => {
      const x =
        align === "left"
          ? tbX + edge[c] + cellH * 0.6
          : tbX + (edge[c] + edge[c + 1]) / 2;
      prims.push({
        t: "text",
        x,
        y: cyy,
        text: String(text),
        h: cellH,
        align,
      });
    };
    const midY = (r) => schedY + schedRowH * (r + 0.5);
    headers.forEach((h, c) =>
      cell(c, midY(0), h, c === 1 ? "left" : "center")
    );
    sched.forEach((it, r) => {
      const y = midY(r + 1);
      const nm = String(it.name || "");
      const shown = nm.length > 32 ? nm.slice(0, 31) + "..." : nm;
      cell(0, y, it.no, "center");
      cell(1, y, shown, "left");
      cell(2, y, it.width, "center");
      cell(3, y, it.height, "center");
      cell(4, y, it.depth, "center");
      cell(5, y, it.qty, "center");
    });
  }

  // PARTS LIST — the per-component dimension table for schematic drawings.
  if (partsList.length) {
    const ptW = tbW;
    const fr = [0.1, 0.46, 0.15, 0.15, 0.14]; // Tag | Part | W | H | D
    const edge = [0];
    for (let i = 0; i < fr.length; i++) edge.push(edge[i] + fr[i] * ptW);
    const cellH = titleH * 0.82;
    const headers = ["Tag", "Part", "W", "H", "D"];
    const tableY = partsY + partsHeaderPad;
    const tableH = partsRowH * (partsList.length + 1);

    prims.push({
      t: "text",
      x: tbX,
      y: partsY + cellH * 0.4,
      text: "PARTS LIST  (mm)",
      h: cellH,
      align: "left",
    });
    prims.push({
      t: "rect",
      x: tbX,
      y: tableY,
      w: ptW,
      h: tableH,
      style: "border",
    });
    for (let r = 1; r <= partsList.length; r++) {
      const ly = tableY + partsRowH * r;
      prims.push({ t: "line", x1: tbX, y1: ly, x2: tbX + ptW, y2: ly, style: "dim" });
    }
    for (let c = 1; c < fr.length; c++) {
      const lx = tbX + edge[c];
      prims.push({ t: "line", x1: lx, y1: tableY, x2: lx, y2: tableY + tableH, style: "dim" });
    }
    const cell = (c, cyy, text, align) => {
      const x =
        align === "left"
          ? tbX + edge[c] + cellH * 0.6
          : tbX + (edge[c] + edge[c + 1]) / 2;
      prims.push({ t: "text", x, y: cyy, text: String(text), h: cellH, align });
    };
    const midY = (r) => tableY + partsRowH * (r + 0.5);
    headers.forEach((h, c) => cell(c, midY(0), h, c === 1 ? "left" : "center"));
    partsList.forEach((pt, r) => {
      const y = midY(r + 1);
      const nm = String(pt.label || "");
      const shown = nm.length > 34 ? nm.slice(0, 33) + "..." : nm;
      cell(0, y, pt.tag, "center");
      cell(1, y, shown, "left");
      cell(2, y, pt.w, "center");
      cell(3, y, pt.h, "center");
      cell(4, y, pt.d, "center");
    });
  }

  return { width: sheetW, height: sheetH, primitives: prims, scale: s };
}

// Compose at the auto-picked fit scale (for SVG / PDF).
function composeFitted(result) {
  const probe = composeSheet(result, 1);
  const s = pickScale(probe.width, probe.height);
  return composeSheet(result, s);
}

// ---------------------------------------------------------------------------
// Stroke widths (mm) per style, relative to sheet size

function strokeWidths(sheet) {
  const u = Math.min(sheet.width, sheet.height);
  return {
    visible: Math.max(u * 0.0024, 0.18),
    hidden: Math.max(u * 0.0017, 0.13),
    dim: Math.max(u * 0.0011, 0.08),
    border: Math.max(u * 0.0032, 0.25),
  };
}

// ---------------------------------------------------------------------------
// SVG renderer

export function buildSVG(result) {
  const sheet = composeFitted(result);
  const sw = strokeWidths(sheet);
  const dash = {
    hidden: `${sw.hidden * 8} ${sw.hidden * 5}`,
  };
  const esc = (t) =>
    String(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const parts = [];
  for (const p of sheet.primitives) {
    if (p.t === "line") {
      const da =
        p.style === "hidden" ? ` stroke-dasharray="${dash.hidden}"` : "";
      parts.push(
        `<line x1="${p.x1.toFixed(2)}" y1="${p.y1.toFixed(2)}" ` +
          `x2="${p.x2.toFixed(2)}" y2="${p.y2.toFixed(2)}" ` +
          `stroke="${p.style === "dim" ? "#444" : "#000"}" ` +
          `stroke-width="${sw[p.style].toFixed(3)}"${da}/>`
      );
    } else if (p.t === "rect") {
      parts.push(
        `<rect x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" ` +
          `width="${p.w.toFixed(2)}" height="${p.h.toFixed(2)}" ` +
          `fill="none" stroke="#000" stroke-width="${sw.border.toFixed(3)}"/>`
      );
    } else if (p.t === "circle") {
      parts.push(
        `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" ` +
          `r="${p.r.toFixed(2)}" fill="#ffffff" stroke="#000" ` +
          `stroke-width="${sw.visible.toFixed(3)}"/>`
      );
    } else if (p.t === "text") {
      const anchor =
        p.align === "center" ? "middle" : p.align === "right" ? "end" : "start";
      parts.push(
        `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" ` +
          `font-family="Helvetica, Arial, sans-serif" ` +
          `font-size="${p.h.toFixed(2)}" text-anchor="${anchor}" ` +
          `dominant-baseline="middle" fill="#000">${esc(p.text)}</text>`
      );
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${sheet.width.toFixed(2)} ${sheet.height.toFixed(2)}" ` +
    `width="${sheet.width.toFixed(2)}mm" height="${sheet.height.toFixed(2)}mm">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    parts.join("") +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// DXF renderer (AutoCAD R12 ASCII, 1:1 real millimetres, Y-up)

function dxfPair(code, value) {
  return `${code}\n${value}\n`;
}

function dxfText(str) {
  return String(str).replace(/[^\x20-\x7E]/g, "").toUpperCase();
}

export function buildDXF(result) {
  // scale 1 → primitives already in real mm
  const sheet = composeSheet(result, 1);
  const H = sheet.height;
  const fy = (y) => H - y; // flip to Y-up

  let out = "";
  // header
  out += dxfPair(0, "SECTION") + dxfPair(2, "HEADER") + dxfPair(0, "ENDSEC");

  // tables: linetypes + layers
  out += dxfPair(0, "SECTION") + dxfPair(2, "TABLES");
  out += dxfPair(0, "TABLE") + dxfPair(2, "LTYPE") + dxfPair(70, 2);
  out +=
    dxfPair(0, "LTYPE") +
    dxfPair(2, "CONTINUOUS") +
    dxfPair(70, 0) +
    dxfPair(3, "Solid line") +
    dxfPair(72, 65) +
    dxfPair(73, 0) +
    dxfPair(40, 0);
  out +=
    dxfPair(0, "LTYPE") +
    dxfPair(2, "DASHED") +
    dxfPair(70, 0) +
    dxfPair(3, "Hidden __ __ __") +
    dxfPair(72, 65) +
    dxfPair(73, 2) +
    dxfPair(40, 15) +
    dxfPair(49, 10) +
    dxfPair(49, -5);
  out += dxfPair(0, "ENDTAB");

  out += dxfPair(0, "TABLE") + dxfPair(2, "LAYER") + dxfPair(70, 4);
  const layer = (name, color, ltype) =>
    dxfPair(0, "LAYER") +
    dxfPair(2, name) +
    dxfPair(70, 0) +
    dxfPair(62, color) +
    dxfPair(6, ltype);
  out += layer("VISIBLE", 7, "CONTINUOUS");
  out += layer("HIDDEN", 8, "DASHED");
  out += layer("DIMENSIONS", 1, "CONTINUOUS");
  out += layer("TEXT", 3, "CONTINUOUS");
  out += dxfPair(0, "ENDTAB") + dxfPair(0, "ENDSEC");

  // entities
  out += dxfPair(0, "SECTION") + dxfPair(2, "ENTITIES");

  const styleLayer = {
    visible: "VISIBLE",
    hidden: "HIDDEN",
    dim: "DIMENSIONS",
    border: "DIMENSIONS",
  };
  const emitLine = (lyr, x1, y1, x2, y2) =>
    dxfPair(0, "LINE") +
    dxfPair(8, lyr) +
    dxfPair(10, x1.toFixed(3)) +
    dxfPair(20, fy(y1).toFixed(3)) +
    dxfPair(30, 0) +
    dxfPair(11, x2.toFixed(3)) +
    dxfPair(21, fy(y2).toFixed(3)) +
    dxfPair(31, 0);

  for (const p of sheet.primitives) {
    if (p.t === "line") {
      out += emitLine(styleLayer[p.style] || "VISIBLE", p.x1, p.y1, p.x2, p.y2);
    } else if (p.t === "rect") {
      out += emitLine("DIMENSIONS", p.x, p.y, p.x + p.w, p.y);
      out += emitLine("DIMENSIONS", p.x + p.w, p.y, p.x + p.w, p.y + p.h);
      out += emitLine("DIMENSIONS", p.x + p.w, p.y + p.h, p.x, p.y + p.h);
      out += emitLine("DIMENSIONS", p.x, p.y + p.h, p.x, p.y);
    } else if (p.t === "circle") {
      out +=
        dxfPair(0, "CIRCLE") +
        dxfPair(8, "VISIBLE") +
        dxfPair(10, p.x.toFixed(3)) +
        dxfPair(20, fy(p.y).toFixed(3)) +
        dxfPair(30, 0) +
        dxfPair(40, p.r.toFixed(3));
    } else if (p.t === "text") {
      const halign = p.align === "center" ? 1 : p.align === "right" ? 2 : 0;
      out +=
        dxfPair(0, "TEXT") +
        dxfPair(8, "TEXT") +
        dxfPair(10, p.x.toFixed(3)) +
        dxfPair(20, fy(p.y).toFixed(3)) +
        dxfPair(30, 0) +
        dxfPair(40, p.h.toFixed(3)) +
        dxfPair(1, dxfText(p.text)) +
        dxfPair(72, halign) +
        dxfPair(73, 2) +
        dxfPair(11, p.x.toFixed(3)) +
        dxfPair(21, fy(p.y).toFixed(3)) +
        dxfPair(31, 0);
    }
  }

  out += dxfPair(0, "ENDSEC") + dxfPair(0, "EOF");
  return out;
}

// ---------------------------------------------------------------------------
// PDF renderer (vector, via jsPDF)

const MM_PER_PT = 0.352777;

export function buildPDF(result) {
  const sheet = composeFitted(result);
  const sw = strokeWidths(sheet);
  const doc = new jsPDF({
    orientation: sheet.width >= sheet.height ? "landscape" : "portrait",
    unit: "mm",
    format: [sheet.width, sheet.height],
  });
  doc.setFont("helvetica", "normal");

  for (const p of sheet.primitives) {
    if (p.t === "line") {
      doc.setLineWidth(sw[p.style]);
      doc.setDrawColor(p.style === "dim" ? 70 : 0);
      if (p.style === "hidden") {
        doc.setLineDashPattern([sw.hidden * 8, sw.hidden * 5], 0);
      }
      doc.line(p.x1, p.y1, p.x2, p.y2);
      if (p.style === "hidden") doc.setLineDashPattern([], 0);
    } else if (p.t === "rect") {
      doc.setLineWidth(sw.border);
      doc.setDrawColor(0);
      doc.rect(p.x, p.y, p.w, p.h);
    } else if (p.t === "circle") {
      doc.setLineWidth(sw.visible);
      doc.setDrawColor(0);
      doc.setFillColor(255, 255, 255);
      doc.circle(p.x, p.y, p.r, "FD");
    } else if (p.t === "text") {
      doc.setFontSize(p.h / MM_PER_PT);
      doc.setTextColor(0);
      doc.text(String(p.text), p.x, p.y, {
        align: p.align || "left",
        baseline: "middle",
      });
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Download helpers

function safeName(result) {
  return (
    String(result.itemName || "drawing")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "drawing"
  );
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSVG(result) {
  const name = safeName(result);
  downloadBlob(
    `${name}_2d_drawing.svg`,
    new Blob([buildSVG(result)], { type: "image/svg+xml" })
  );
}

export function exportDXF(result) {
  const name = safeName(result);
  downloadBlob(
    `${name}_2d_drawing.dxf`,
    new Blob([buildDXF(result)], { type: "application/dxf" })
  );
}

export function exportPDF(result) {
  const name = safeName(result);
  buildPDF(result).save(`${name}_2d_drawing.pdf`);
}

// ============================================================================
// WORKING DRAWING (Phase 1) — single-wall architectural elevation
// ============================================================================
//
// Driven by the same `result` Full Room View produces. We pick one of the
// elevations (front / left / right), render it large with per-item dimension
// callouts and balloon codes (A1, A2, …), surround it with an Accessories
// legend, a KEY PLAN mini-floorplan with the chosen wall highlighted in red,
// and an extended title block — site, date, revision, drawn-by, checked-by.
// Output is a self-contained SVG string sized A3 landscape.

const WD_SHEET = { width: 420, height: 297 }; // mm — A3 landscape

function wdEscSvg(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wdLine(out, x1, y1, x2, y2, opts = {}) {
  const stroke = opts.stroke || "#000";
  const w = opts.width != null ? opts.width : 0.2;
  const dash = opts.dash ? ` stroke-dasharray="${opts.dash}"` : "";
  out.push(
    `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="${w.toFixed(3)}"${dash}/>`
  );
}

function wdRect(out, x, y, w, h, opts = {}) {
  const stroke = opts.stroke || "#000";
  const sw = opts.width != null ? opts.width : 0.25;
  const fill = opts.fill || "none";
  out.push(
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(3)}"/>`
  );
}

function wdText(out, x, y, text, opts = {}) {
  const align = opts.align || "left";
  const anchor =
    align === "center" ? "middle" : align === "right" ? "end" : "start";
  const h = opts.h || 2.5;
  const weight = opts.bold ? "bold" : "normal";
  const baseline = opts.baseline || "middle";
  const fill = opts.fill || "#000";
  out.push(
    `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${anchor}" dominant-baseline="${baseline}" font-family="Helvetica, Arial, sans-serif" font-size="${h.toFixed(2)}" font-weight="${weight}" fill="${fill}">${wdEscSvg(text)}</text>`
  );
}

function wdCircle(out, cx, cy, r, opts = {}) {
  const stroke = opts.stroke || "#000";
  const sw = opts.width != null ? opts.width : 0.2;
  const fill = opts.fill || "#ffffff";
  out.push(
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(3)}"/>`
  );
}

// Wall-section hatching strip used at top/bottom of an elevation.
function wdWallHatch(out, x, y, w, h) {
  wdRect(out, x, y, w, h, { stroke: "#000", width: 0.2 });
  const step = 2.5;
  for (let dx = -h; dx < w; dx += step) {
    const x1 = Math.max(x + dx, x);
    const y1 = x + dx < x ? y + h - (x - (x + dx)) : y + h;
    const x2 = Math.min(x + dx + h, x + w);
    const y2 = x + dx + h > x + w ? y + (x + dx + h - (x + w)) : y;
    wdLine(out, x1, y1, x2, y2, { stroke: "#777", width: 0.1 });
  }
}

// Horizontal dimension line with end tick marks and a centered value label.
function wdDimension(out, x1, x2, y, text, h) {
  const tH = h != null ? h : 2.2;
  wdLine(out, x1, y, x2, y, { stroke: "#333", width: 0.15 });
  const tick = 0.9;
  wdLine(out, x1 - tick, y + tick, x1 + tick, y - tick, {
    stroke: "#333",
    width: 0.15
  });
  wdLine(out, x2 - tick, y + tick, x2 + tick, y - tick, {
    stroke: "#333",
    width: 0.15
  });
  wdText(out, (x1 + x2) / 2, y - tH * 0.85, text, {
    align: "center",
    h: tH,
    baseline: "middle"
  });
}

function wdFmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/**
 * Build a single-wall working-drawing SVG from a Full-Room-View result.
 *
 * @param {object} result  output of generateRoomDrawing()
 * @param {object} options {
 *   viewId: 'front' | 'left' | 'right'          (default 'front')
 *   project: {
 *     title?:       string,   e.g. "KITCHEN INTERNAL VIEW"
 *     viewNumber?:  string,   e.g. "2"
 *     wallCode?:    string,   e.g. "A"
 *     site?:        string,
 *     date?:        string ISO,
 *     revisionNo?:  string,
 *     drawnBy?:     string,
 *     checkedBy?:   string,
 *     brand1?:      string,   default "PAZL"
 *     brand2?:      string,   default "Niche Design Loft"
 *   }
 * }
 * @returns {string} self-contained SVG
 */
export function buildWorkingDrawingSVG(result, options = {}) {
  const viewId = options.viewId || "front";
  const project = options.project || {};
  const view = (result.views || []).find((v) => v.id === viewId);
  const planView = (result.views || []).find((v) => v.id === "top");
  if (!view) {
    throw new Error(`No "${viewId}" view in drawing result`);
  }

  // ----- Sheet regions (mm, A3 landscape) -----
  const W = WD_SHEET.width;
  const H = WD_SHEET.height;
  const border = { x: 5, y: 5, w: W - 10, h: H - 10 };
  const draw = { x: 12, y: 14, w: 270, h: 220 };
  const legends = { x: 292, y: 14, w: 120, h: 145 };
  const keyPlan = { x: 292, y: 165, w: 120, h: 60 };
  const title = { x: 12, y: 240, w: 400, h: 47 };

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">`
  );
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  wdRect(out, border.x, border.y, border.w, border.h, {
    stroke: "#000",
    width: 0.6
  });

  // ----- HEADING -----
  const viewNumber = project.viewNumber || "2";
  const titleText = project.title || "KITCHEN INTERNAL VIEW";
  const wallCode =
    project.wallCode || viewId.toUpperCase().slice(0, 1) || "A";
  wdText(
    out,
    draw.x + draw.w / 2,
    draw.y + 5,
    `${viewNumber}. ${titleText} @ ${wallCode}`,
    { align: "center", h: 4, bold: true, baseline: "middle" }
  );

  // ----- Drawing area: fit view into the available rect -----
  const wallStrip = 4; // top + bottom hatching
  const dimSpace = 12; // space for dimension line + value labels
  const usableW = draw.w - 8;
  const usableH = draw.h - 14 /*heading*/ - wallStrip * 2 - dimSpace;
  const s = Math.min(usableW / view.width, usableH / view.height);
  const drawTop = draw.y + 14 + wallStrip;
  const drawBottom = draw.y + draw.h - dimSpace - wallStrip;
  const cx = draw.x + draw.w / 2;
  const cy = (drawTop + drawBottom) / 2;

  // Wall hatching strips at top + bottom of the elevation
  const elevTop = cy - (view.height * s) / 2;
  const elevBottom = cy + (view.height * s) / 2;
  wdWallHatch(out, draw.x + 4, elevTop - wallStrip - 0.5, draw.w - 8, wallStrip);
  wdWallHatch(out, draw.x + 4, elevBottom + 0.5, draw.w - 8, wallStrip);

  // Segments — the working-drawing sheet shows the clean FRONT face only, so we
  // skip hidden (dashed) lines here. On a detailed model those internal edges
  // roughly double the clutter without adding readable information; the external
  // elevation only needs the visible outline. (The Shop Drawing still keeps
  // hidden lines for the technical multi-view.)
  for (const seg of view.segments) {
    if (seg.hidden) continue;
    const x1 = cx + seg.x1 * s;
    const y1 = cy - seg.y1 * s;
    const x2 = cx + seg.x2 * s;
    const y2 = cy - seg.y2 * s;
    wdLine(out, x1, y1, x2, y2, { stroke: "#000", width: 0.22 });
  }

  // A-codes (A1, A2, …) as balloon callouts
  const tagR = 2.4;
  for (const tag of view.tags || []) {
    const tx = cx + tag.x * s;
    const ty = cy - tag.y * s;
    wdCircle(out, tx, ty, tagR, {
      stroke: "#000",
      width: 0.22,
      fill: "#ffffff"
    });
    wdText(out, tx, ty, `A${tag.no}`, {
      align: "center",
      h: 2.6,
      bold: true,
      baseline: "middle"
    });
  }

  // S-codes (S1, S2, …) placed ON the drawing, on the part they name (shutter,
  // handle, …). Positions arrive as fractions (0..1) of the view box from the
  // caller (fx from left, fy from bottom). Drawn as a small white circle, like
  // the reference sheet's part callouts. Additive: no options.sCodes → nothing.
  const sCodeR = 2.6;
  for (const sc of options.sCodes || []) {
    if (!Number.isFinite(sc.fx) || !Number.isFinite(sc.fy)) continue;
    const px = cx + (sc.fx - 0.5) * view.width * s;
    const py = cy - (sc.fy - 0.5) * view.height * s;
    wdCircle(out, px, py, sCodeR, {
      stroke: "#000",
      width: 0.3,
      fill: "#ffffff"
    });
    wdText(out, px, py, String(sc.code || ""), {
      align: "center",
      h: 2.8,
      bold: true,
      baseline: "middle"
    });
  }

  // Per-item dimension lines (one per tag) below the elevation
  const items = result.items || [];
  const itemByNo = new Map(items.map((it) => [it.no, it]));
  const dimY = elevBottom + wallStrip + 5;
  const sortedTags = [...(view.tags || [])].sort((a, b) => a.x - b.x);
  for (const tag of sortedTags) {
    const item = itemByNo.get(tag.no);
    if (!item) continue;
    const w_mm =
      viewId === "front" || viewId === "back" ? item.width : item.depth;
    if (!w_mm) continue;
    const halfMm = w_mm / 2;
    const dx1 = cx + (tag.x - halfMm) * s;
    const dx2 = cx + (tag.x + halfMm) * s;
    wdDimension(out, dx1, dx2, dimY, String(Math.round(w_mm)), 2.2);
  }

  // ----- LEGENDS panel -----
  wdRect(out, legends.x, legends.y, legends.w, legends.h, {
    stroke: "#000",
    width: 0.35
  });
  let ly = legends.y + 5;
  wdText(out, legends.x + legends.w / 2, ly, "LEGENDS", {
    align: "center",
    h: 4,
    bold: true,
    baseline: "middle"
  });
  ly += 4;
  wdLine(out, legends.x, ly, legends.x + legends.w, ly, {
    stroke: "#000",
    width: 0.3
  });

  // Material specifications
  ly += 4;
  wdText(out, legends.x + legends.w / 2, ly, "MATERIAL SPECIFICATIONS", {
    align: "center",
    h: 2.4,
    bold: true,
    baseline: "middle"
  });
  ly += 4;
  const matCol1X = legends.x + 3;
  const matCol2X = legends.x + legends.w - 3;
  // Filled from the item's own materials when the caller supplies them
  // (options.materials = [{ label, value }]). When nothing is supplied, show the
  // two labels with BLANK values — never invent hard-coded grades (BWR/HDHMR),
  // which were wrong on units that had no such material.
  const matRows =
    Array.isArray(options.materials) && options.materials.length
      ? options.materials
          .slice(0, 8)
          .map((m) => [
            String(m.label || "").slice(0, 24),
            String(m.value || "").slice(0, 24)
          ])
      : [
          ["Carcass material", ""],
          ["Shutter material", ""]
        ];
  // Drawn as a bordered two-column table (label | value) like the reference:
  // solid outer box, a vertical column divider and a row border per entry.
  const specX = legends.x + 1;
  const specW = legends.w - 2;
  const specRowH = 4;
  const specDivX = specX + specW * 0.52;
  const specTop = ly - 1.6;
  const specH = matRows.length * specRowH;
  wdRect(out, specX, specTop, specW, specH, { stroke: "#000", width: 0.3 });
  wdLine(out, specDivX, specTop, specDivX, specTop + specH, {
    stroke: "#000",
    width: 0.25
  });
  let sry = specTop;
  for (const [k, v] of matRows) {
    const midY = sry + specRowH / 2;
    wdText(out, specX + 1.5, midY, k, { h: 2.0, baseline: "middle" });
    wdText(out, specDivX + 1.5, midY, v, { h: 2.0, baseline: "middle" });
    sry += specRowH;
    if (sry < specTop + specH - 0.01) {
      wdLine(out, specX, sry, specX + specW, sry, {
        stroke: "#000",
        width: 0.2
      });
    }
  }
  ly = specTop + specH + 3;

  // Particulars / colour code and brand. Additive: skipped entirely when the
  // caller supplies no options.colourCodes, so the sheet is unchanged. Rows are
  // [particulars, colour + brand], e.g. ["Shutter S1", "Wood 10002 - Greenlam"].
  const ccRows =
    Array.isArray(options.colourCodes) && options.colourCodes.length
      ? options.colourCodes
          .slice(0, 8)
          .map((c) => [
            String(c.label || "").slice(0, 20),
            String(c.value || "").slice(0, 30)
          ])
      : null;
  if (ccRows) {
    const ccX = legends.x + 1;
    const ccW = legends.w - 2;
    const ccRowH = 4;
    const ccDivX = ccX + ccW * 0.4;
    const ccTop = ly + 1;
    const ccH = (ccRows.length + 1) * ccRowH; // + header row
    wdRect(out, ccX, ccTop, ccW, ccH, { stroke: "#000", width: 0.3 });
    wdLine(out, ccDivX, ccTop, ccDivX, ccTop + ccH, {
      stroke: "#000",
      width: 0.25
    });
    const ccHeadY = ccTop + ccRowH / 2;
    wdText(out, ccX + 1.5, ccHeadY, "PARTICULARS", {
      h: 1.9,
      bold: true,
      baseline: "middle"
    });
    wdText(out, ccDivX + 1.5, ccHeadY, "COLOUR CODE AND BRAND", {
      h: 1.9,
      bold: true,
      baseline: "middle"
    });
    let ccy = ccTop + ccRowH;
    wdLine(out, ccX, ccy, ccX + ccW, ccy, { stroke: "#000", width: 0.25 });
    for (const [k, v] of ccRows) {
      const midY = ccy + ccRowH / 2;
      wdText(out, ccX + 1.5, midY, k, { h: 2.0, baseline: "middle" });
      wdText(out, ccDivX + 1.5, midY, v, { h: 2.0, baseline: "middle" });
      ccy += ccRowH;
      if (ccy < ccTop + ccH - 0.01) {
        wdLine(out, ccX, ccy, ccX + ccW, ccy, { stroke: "#000", width: 0.2 });
      }
    }
    ly = ccTop + ccH + 3;
  }

  // Accessories
  ly += 2;
  wdText(out, legends.x + legends.w / 2, ly, "ACCESSORIES", {
    align: "center",
    h: 2.4,
    bold: true,
    baseline: "middle"
  });
  ly += 4;
  wdText(out, matCol1X, ly, "Code", {
    h: 2.0,
    bold: true,
    baseline: "middle"
  });
  wdText(out, matCol2X, ly, "Item / Brand", {
    h: 2.0,
    bold: true,
    align: "right",
    baseline: "middle"
  });
  ly += 3.2;
  const maxRows = Math.max(
    0,
    Math.floor((legends.y + legends.h - ly - 2) / 3.2)
  );
  const visible = items.slice(0, maxRows);
  for (const it of visible) {
    wdText(out, matCol1X, ly, `A${it.no}`, {
      h: 2.0,
      bold: true,
      baseline: "middle"
    });
    const nm = String(it.name || "").slice(0, 32);
    wdText(out, matCol2X, ly, nm, {
      h: 2.0,
      align: "right",
      baseline: "middle"
    });
    ly += 3.2;
  }
  if (items.length > visible.length) {
    wdText(
      out,
      legends.x + legends.w / 2,
      ly,
      `… +${items.length - visible.length} more`,
      { h: 1.8, align: "center", baseline: "middle", fill: "#666" }
    );
  }

  // ----- KEY PLAN -----
  wdRect(out, keyPlan.x, keyPlan.y, keyPlan.w, keyPlan.h, {
    stroke: "#000",
    width: 0.35
  });
  wdText(out, keyPlan.x + keyPlan.w / 2, keyPlan.y + 4, "KEY PLAN", {
    align: "center",
    h: 2.5,
    bold: true,
    baseline: "middle"
  });
  if (planView) {
    const kp = {
      x: keyPlan.x + 4,
      y: keyPlan.y + 9,
      w: keyPlan.w - 8,
      h: keyPlan.h - 13
    };
    const ks = Math.min(kp.w / planView.width, kp.h / planView.height);
    const kx = kp.x + kp.w / 2;
    const ky = kp.y + kp.h / 2;
    for (const seg of planView.segments) {
      const x1 = kx + seg.x1 * ks;
      const y1 = ky - seg.y1 * ks;
      const x2 = kx + seg.x2 * ks;
      const y2 = ky - seg.y2 * ks;
      wdLine(out, x1, y1, x2, y2, {
        stroke: seg.hidden ? "#bbb" : "#000",
        width: 0.1
      });
    }
    // Highlight the picked wall on the plan in red
    const kw = planView.width;
    const kh = planView.height;
    let wx1, wy1, wx2, wy2;
    if (viewId === "front") {
      wx1 = kx - (kw / 2) * ks;
      wy1 = ky - (kh / 2) * ks;
      wx2 = kx + (kw / 2) * ks;
      wy2 = wy1;
    } else if (viewId === "back") {
      wx1 = kx - (kw / 2) * ks;
      wy1 = ky + (kh / 2) * ks;
      wx2 = kx + (kw / 2) * ks;
      wy2 = wy1;
    } else if (viewId === "left") {
      wx1 = kx - (kw / 2) * ks;
      wy1 = ky - (kh / 2) * ks;
      wx2 = wx1;
      wy2 = ky + (kh / 2) * ks;
    } else {
      wx1 = kx + (kw / 2) * ks;
      wy1 = ky - (kh / 2) * ks;
      wx2 = wx1;
      wy2 = ky + (kh / 2) * ks;
    }
    wdLine(out, wx1, wy1, wx2, wy2, { stroke: "#d00", width: 0.9 });
    wdText(
      out,
      (wx1 + wx2) / 2 + (viewId === "left" ? -3 : viewId === "right" ? 3 : 0),
      (wy1 + wy2) / 2 +
        (viewId === "front" ? -2 : viewId === "back" ? 2 : 0),
      `@ ${wallCode}`,
      { align: "center", h: 2.4, bold: true, fill: "#d00", baseline: "middle" }
    );
  }

  // ----- TITLE BLOCK -----
  wdRect(out, title.x, title.y, title.w, title.h, {
    stroke: "#000",
    width: 0.4
  });
  // Two rows of three, like the reference sheet: wider cells so the site
  // address fits, in the order Title | Date | Drawn by / Site | Revision |
  // Checked by. The bottom strip is reserved for the branding line.
  const titleRows = [
    [
      { k: "TITLE", v: titleText },
      { k: "DATE", v: wdFmtDate(project.date || result.generatedAt) },
      { k: "DRAWN BY", v: project.drawnBy || "" }
    ],
    [
      { k: "SITE LOCATION", v: project.site || "" },
      { k: "REVISION NO", v: project.revisionNo || "00" },
      { k: "CHECKED BY", v: project.checkedBy || "" }
    ]
  ];
  const tbDataH = title.h - 10; // reserve the bottom strip for branding
  const tbRowH = tbDataH / 2;
  const tbColW = title.w / 3;
  // Column dividers (only across the data rows, not the branding strip)
  for (let c = 1; c < 3; c++) {
    const vx = title.x + c * tbColW;
    wdLine(out, vx, title.y, vx, title.y + tbDataH, {
      stroke: "#000",
      width: 0.3
    });
  }
  // Row divider between the two data rows
  wdLine(out, title.x, title.y + tbRowH, title.x + title.w, title.y + tbRowH, {
    stroke: "#000",
    width: 0.3
  });
  for (let r = 0; r < titleRows.length; r++) {
    for (let c = 0; c < titleRows[r].length; c++) {
      const cell = titleRows[r][c];
      const cellX = title.x + c * tbColW;
      const cellY = title.y + r * tbRowH;
      wdText(out, cellX + 2.5, cellY + 5, cell.k, {
        h: 2.2,
        bold: true,
        baseline: "middle"
      });
      wdText(out, cellX + 2.5, cellY + 12, cell.v || "—", {
        h: 2.6,
        baseline: "middle"
      });
    }
  }
  // Branding row at the bottom of the title block
  const brand1 = project.brand1 || "PAZL";
  const brand2 = project.brand2 || "Niche Design Loft";
  const brandY = title.y + title.h - 5;
  wdLine(
    out,
    title.x,
    title.y + title.h - 10,
    title.x + title.w,
    title.y + title.h - 10,
    { stroke: "#000", width: 0.3 }
  );
  wdText(out, title.x + 4, brandY, brand1, {
    h: 3.2,
    bold: true,
    baseline: "middle"
  });
  wdText(out, title.x + title.w - 4, brandY, brand2, {
    h: 3.2,
    bold: true,
    align: "right",
    baseline: "middle"
  });

  out.push("</svg>");
  return out.join("");
}

export function exportWorkingDrawingSVG(result, options = {}) {
  const base =
    (options.project && options.project.title) ||
    result.itemName ||
    "working_drawing";
  const safe =
    String(base)
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "working_drawing";
  const code =
    (options.project && options.project.wallCode) ||
    String(options.viewId || "front").toUpperCase().slice(0, 1);
  const svg = buildWorkingDrawingSVG(result, options);
  downloadBlob(
    `${safe}_at_${code}_working_drawing.svg`,
    new Blob([svg], { type: "image/svg+xml" })
  );
}
