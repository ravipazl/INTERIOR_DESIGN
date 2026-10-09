# Make a picture file for every Merino décor the catalogue can supply one for.
#
# Two kinds of picture, from two different places in the PDF:
#
#   FLAT COLOURS — Solids, the MR+ gloss range, the Sampada whites. The
#   catalogue draws these as filled vector rectangles, so the colour is in the
#   file exactly and is read, not sampled. A flat colour also tiles perfectly
#   across a door, which a photograph never does. 176 of them.
#
#   PHOTOGRAPHS — Woodgrains, Patterns, Stones. The catalogue's own pictures of
#   printed sample cards, cut out and saved. Good enough to recognise a décor
#   and choose it; NOT seamless, so a tall shutter may show a repeat edge. A
#   real texture pack from Merino replaces these file-for-file.
#
#   python scripts/merino-tiles.py <catalogue.pdf> <decors.json>
#   python scripts/merino-tiles.py <catalogue.pdf> <decors.json> --write
#
# Default output: frontend/public/assets/rooms/textures/library/merino
# Nothing is written without --write, and an existing file is never
# overwritten — a real texture put there by hand outranks anything taken from
# a catalogue page.

import json
import re
import sys
from collections import Counter
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is required:  pip install pymupdf")
try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

CODE = re.compile(r"^\d{5}$")
OUT = Path("..") / "frontend" / "public" / "assets" / "rooms" / "textures" / "library" / "merino"

COLOUR_TILE = (64, 64)   # a flat colour needs no detail
MIN_PIXELS = 120         # below this an image is an icon, not a décor
MAX_GAP = 40             # how far a caption may sit from its swatch (first pass)

# --- the second pass, for spreads the first cannot read ---
# Some pages put the code ABOVE its swatch, some set the caption OVER a panel,
# some leave a wider gap. Those are solved as a ONE-TO-ONE assignment, cheapest
# pairs first, each image claimed once — which is what stops two décors being
# given the same swatch, and stops a code stealing its neighbour's picture.
FILL_MAX_FRACTION = 0.55
OVERLAP_COST = 60        # a caption ON a picture is the weakest evidence
FILL_COST_CAP = 80       # measured: at 110 a "Black Reed" came out light grey


def pair_cost(r, x, y):
    dx = 0 if (r.x0 - 10) <= x <= (r.x1 + 10) else min(abs(x - r.x0), abs(x - r.x1))
    if r.y1 <= y + 2:
        return max(y - r.y1, 0) + dx * 2
    if r.y0 >= y - 2:
        return max(r.y0 - y, 0) + dx * 2
    return OVERLAP_COST + dx * 2


def image_rects(doc, page, max_fraction):
    out = []
    area = page.rect.width * page.rect.height
    for im in page.get_images(full=True):
        xref = im[0]
        try:
            info = doc.extract_image(xref)
        except Exception:
            continue
        if info["width"] < MIN_PIXELS or info["height"] < MIN_PIXELS:
            continue
        for r in page.get_image_rects(xref):
            if r.width < 50 or r.height < 50:
                continue
            if (r.width * r.height) / area > max_fraction:
                continue
            out.append((r, xref))
    return out


def pair_photos(doc):
    """code -> xref, strict first pass then a one-to-one gap fill."""
    pinned = {}
    for pno in range(doc.page_count):
        page = doc[pno]
        rects = image_rects(doc, page, 0.25)
        if not rects:
            continue
        for w in page.get_text("words"):
            code = w[4]
            if not CODE.match(code) or code in pinned:
                continue
            best, best_d = None, 1e9
            for r, xref in rects:
                if r.y1 > w[1] + 2:
                    continue
                d = pair_cost(r, w[0], w[1])
                if d < best_d:
                    best, best_d = xref, d
            if best is not None and best_d < MAX_GAP:
                pinned[code] = best

    claimed = set(pinned.values())
    for pno in range(doc.page_count):
        page = doc[pno]
        rects = image_rects(doc, page, FILL_MAX_FRACTION)
        codes = [(w[4], w[0], w[1]) for w in page.get_text("words") if CODE.match(w[4])]
        if not rects or not codes:
            continue
        edges = []
        for ci, (code, x, y) in enumerate(codes):
            if code in pinned:
                continue
            for ri, (r, xref) in enumerate(rects):
                if xref in claimed:
                    continue
                c = pair_cost(r, x, y)
                if c <= FILL_COST_CAP:
                    edges.append((c, ci, ri))
        edges.sort()
        used_c, used_r = set(), set()
        for c, ci, ri in edges:
            if ci in used_c or ri in used_r:
                continue
            used_c.add(ci)
            used_r.add(ri)
            claimed.add(rects[ri][1])
            pinned[codes[ci][0]] = rects[ri][1]
    return pinned


def main():
    argv = sys.argv[1:]
    if len(argv) < 2:
        sys.exit(__doc__)
    pdf, decors_file = argv[0], argv[1]
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else OUT
    write = "--write" in argv

    payload = json.loads(Path(decors_file).read_text(encoding="utf-8"))
    decors = payload["decors"] if isinstance(payload, dict) else payload
    doc = fitz.open(pdf)

    with_colour = [d for d in decors if d.get("color")]
    needs_photo = [d for d in decors if not d.get("color")]
    photos = pair_photos(doc)
    matched = [d for d in needs_photo if d["code"] in photos]
    unmatched = [d for d in needs_photo if d["code"] not in photos]

    per = Counter()
    for d in with_colour:
        per[d["section"]] += 1
    for d in matched:
        per[d["section"]] += 1

    print("décors in file      :", len(decors))
    print("  flat colour       :", len(with_colour))
    print("  photograph matched:", len(matched))
    print("  no picture         :", len(unmatched))
    print()
    print("%-28s %s" % ("SECTION", "PICTURES"))
    for s, n in per.most_common():
        print("%-28s %d" % (s, n))
    print()
    print("output:", out)

    if not write:
        print("\nNothing written. Re-run with --write.")
        return

    out.mkdir(parents=True, exist_ok=True)
    made = skipped = 0
    existing = lambda code: any(
        (out / f"{code}{e}").exists() for e in (".png", ".jpg", ".jpeg", ".webp")
    )

    for d in with_colour:
        if existing(d["code"]):
            skipped += 1
            continue
        rgb = tuple(int(d["color"].lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        Image.new("RGB", COLOUR_TILE, rgb).save(out / f"{d['code']}.png", "PNG", optimize=True)
        made += 1

    for d in matched:
        if existing(d["code"]):
            skipped += 1
            continue
        try:
            info = doc.extract_image(photos[d["code"]])
        except Exception:
            continue
        (out / f"{d['code']}.{info.get('ext', 'jpg')}").write_bytes(info["image"])
        made += 1

    print()
    print("written        :", made)
    print("already present:", skipped)
    print()
    print("Now link them:  node scripts/merino-restore.mjs --decors %s --write" % decors_file)


if __name__ == "__main__":
    main()
