/**
 * THE SCALE A DRAWING STATES ITSELF.
 *
 * A plan printed from CAD carries its dimensions as numbers beside lines —
 * "12600" over a line drawn between two ticks. The number is a real length in
 * millimetres, the line is that length on the page, so one gives the scale:
 * no one has to measure anything.
 *
 * A number is taken for a dimension only when a straight line runs beside it,
 * parallel to it, under it along its length, and no more than a few text
 * heights away — a label in a room ("3500 x 4000") has no such line, and a
 * number far from any line is not a dimension. Dimensions that give the same
 * scale agree with one another; the scale most of them give is taken, the
 * largest dimension deciding between equals, and a scale no print could have
 * (the page would be a metre wide, or 1:5000) is thrown out.
 *
 * Self-contained, so it runs in the import worker and in a plain Node test.
 */

/** Longest and shortest a sheet's scale can be (millimetres of plan per millimetre on paper). */
const MIN_SCALE = 5;
const MAX_SCALE = 1000;
/** A dimension line is at most this many text heights from its number. */
const MAX_OFFSET_H = 3;
/** Two dimensions agree when their scales differ by less than this. */
const AGREE = 0.03;
/** Smallest dimension taken (mm): below this a number is a note, not a length. */
const MIN_VALUE_MM = 300;

/**
 * @param {{ a: number[], b: number[] }[]} segs  the page's lines (page units, y up)
 * @param {{ p: number[], h: number, text: string, dir?: number[] }[]} texts
 *        where each text is centred, how tall, and which way it runs (a unit vector)
 * @param {number} mmPerUnit  how long one page unit is on paper, in millimetres
 * @returns {{ cmPerUnit: number, valueMm: number, lengthUnits: number, agreeing: number } | null}
 */
/** A feet-and-inches length written on a plan — 32'-0", 10'-6", 12' — in mm. */
const FT_IN = /^(\d+(?:\.\d+)?)\s*['’′]\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:["”″]|in)?)?\s*(?:OVERALL|O\/A)?$/i;

/**
 * What a text says as a length, in millimetres, or null: a plain number is
 * millimetres (12930), and feet and inches are read as written (32'-0",
 * 10'-6", 12' — "OVERALL" after it is ignored).
 */
const lengthMm = (raw) => {
  const text = String(raw || "").trim();
  const plain = text.replace(/[,\s]/g, "");
  if (/^\d{3,6}$/.test(plain)) return Number(plain);
  const m = text.match(FT_IN);
  if (!m) return null;
  const mm = Number(m[1]) * 304.8 + (m[2] ? Number(m[2]) * 25.4 : 0);
  return mm > 0 ? mm : null;
};

export const detectScale = (segs, texts, mmPerUnit) => {
  const numbers = texts
    .map((t) => ({ t, value: lengthMm(t.text) }))
    .filter(({ value }) => value !== null && value >= MIN_VALUE_MM);
  if (!numbers.length || !segs.length) return null;

  const found = [];
  numbers.forEach(({ t, value }) => {
    const dir = t.dir || [1, 0];
    const h = t.h > 0 ? t.h : 8;
    let best = 0;
    for (const sg of segs) {
      const dx = sg.b[0] - sg.a[0];
      const dy = sg.b[1] - sg.a[1];
      const L = Math.hypot(dx, dy);
      if (L < h * 3 || L <= best) continue;
      const ux = dx / L;
      const uy = dy / L;
      // parallel to the text (either way along it)
      if (Math.abs(ux * dir[1] - uy * dir[0]) > 0.05) continue;
      // under the text along its length, and close beside it
      const tx = t.p[0] - sg.a[0];
      const ty = t.p[1] - sg.a[1];
      const along = tx * ux + ty * uy;
      const across = Math.abs(-tx * uy + ty * ux);
      if (along < -h || along > L + h || across > h * MAX_OFFSET_H) continue;
      best = L;
    }
    if (!best) return;
    const mmPerPaperMm = value / (best * mmPerUnit);
    if (mmPerPaperMm < MIN_SCALE || mmPerPaperMm > MAX_SCALE) return;
    found.push({ value, lengthUnits: best, cmPerUnit: value / 10 / best });
  });
  if (!found.length) return null;

  // Group the dimensions that agree; the biggest group wins, then the biggest dimension.
  const groups = [];
  found.forEach((f) => {
    const g = groups.find((x) => Math.abs(x.cmPerUnit - f.cmPerUnit) / x.cmPerUnit < AGREE);
    if (g) {
      g.members.push(f);
      if (f.value > g.largest.value) g.largest = f;
    } else groups.push({ cmPerUnit: f.cmPerUnit, members: [f], largest: f });
  });
  groups.sort((a, b) => b.members.length - a.members.length || b.largest.value - a.largest.value);
  const g = groups[0];
  return {
    cmPerUnit: g.largest.cmPerUnit,
    valueMm: g.largest.value,
    lengthUnits: g.largest.lengthUnits,
    agreeing: g.members.length,
  };
};
