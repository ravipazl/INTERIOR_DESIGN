# Cabinet finishes on the live server

Makes the live server show the same shutter and handle colours as the
development PC:

| Units | Shutter / door | Handles |
|---|---|---|
| Tall Units (every model of the tall-unit category) | Wood 10002 | Wood 10012 |
| Below Counter Storage (Base units, Corner Units, Oil pull-outs, BC units) | Wood 10002 | Wood 10012 |
| Wall Units (the glass unit: its door frame only) | Wood 10002 | Wood 10012 |

The categories are found by any of their known names, so the same scripts work
on the dev PC and the live server (`scripts/lib/categories.mjs`):

| Group | Names tried, in order | Override in `backend/.env` |
|---|---|---|
| Tall Units | "Tall Units", "Tall Unit" | `TALL_UNITS_CATEGORY` |
| Below Counter Storage | "Below Counter Storage" | `BELOW_COUNTER_CATEGORY` |
| Wall Units | "Wall Unit", "Wall Units", "Above Counter Storage" | `WALL_UNITS_CATEGORY` |

An override, when set, is the only name used. The check prints which category
each group resolved to.

The colour is **baked into the 3D (GLB) files**, and the finish is **recorded in
the database**, so the 3D view, the Components panel and the BOQ all show it.
GLB files are not in git, so this has to be run on the live server itself.

## What you need

- The latest code on the live server (`git pull`), then `npm install` in `backend/`.
- The backend `.env` on the live server with:
  - `MONGODB_URL`: the live database (or it is set in the environment, as for the app)
  - `GLB_STORAGE_DIR`: the folder the site serves `/assets/models/glb` from,
    the same setting the model upload uses
- Optional:
  - `WOOD_TEXTURE_DIR`: folder with `10002.jpg` and `10012.jpg`, only if the
    check says it cannot find them
  - `CABINET_BACKUP_DIR`: where the original files and undo files are kept
    (default: `backups/` in the project folder)

## Steps (run in the `backend/` folder)

1. **Check.** This changes nothing:

   ```bash
   npm run cabinet-finishes:check
   ```

   Every line under "1. Checks" must show ✔. It then lists each unit with the
   door and handle parts it found, and what it would record in the database.
   It ends with "CHECK ONLY — nothing was changed."

2. **Apply:**

   ```bash
   npm run cabinet-finishes:apply
   ```

   This:
   - keeps a copy of every original GLB (under `backups/glb-original-*`)
   - bakes the wood into the GLBs
   - records the finish in the database
   - re-opens every file to verify it

   It ends with "N cabinet GLB file(s) baked and recorded", followed by the
   **undo command**. Save that line.

3. Ask users to **refresh the page (Ctrl+F5)** so the browser loads the new 3D files.
   No backend restart is needed.

## Safe to run again

- Every bake starts from the saved **original** file, never from a baked one.
- A GLB that is already baked (for example, copied from another machine) is
  left as it is and is never saved as an "original".
- Finishes already recorded are skipped.
- A finish someone chose on a placed cabinet is **never replaced**.
- Only the Tall Unit, Below Counter Storage and Wall Unit files are touched.

## Undo

```bash
node scripts/production/cabinet-finish-live.mjs --restore "<the run file printed at the end of the apply>"
```

This puts the original GLBs back and removes the finishes that run recorded.
The run file is `backups/cabinet-finishes-run-<date>.json`.

## If something fails

The script stops **before changing anything** when a check fails:

| Message | Fix |
|---|---|
| `3D model folder not found` / `not writable` | Set `GLB_STORAGE_DIR` in the backend `.env`, or give the user running the script write access to that folder. |
| `wood image … not found` | Set `WOOD_TEXTURE_DIR` to the folder holding `10002.jpg` and `10012.jpg`. |
| `database not reachable` | Check `MONGODB_URL`. |
| `category not found — tried …` | The message lists the categories in the database. Set the matching override (e.g. `TALL_UNITS_CATEGORY="Tall Unit"`) in the backend `.env`. |
| `finish "Wood 10002" is missing` | The live database has no such finish. Import the finishes first. |
| `package … is not installed` | Run `npm install` in `backend/`. |

## The scripts it runs

The steps can also be run one at a time; each takes `--dry-run`:

| Script | Does |
|---|---|
| `scripts/tall-units-bake-finish.mjs` | Bakes the Tall Units: every model of the tall-unit category in this machine's database. File and category names are not fixed, so it works on any machine. |
| `scripts/bake-category-wood.mjs --category below` | Bakes the Below Counter units, including the Corner Units. `--only "Corner unit"` limits it to matching models. |
| `scripts/bake-category-wood.mjs --category wall` | Bakes the Wall Units ("Wall Unit" or "Above Counter Storage"). A category name works too. |
| `scripts/tall-units-record-finish.mjs` | Records the Tall Unit finish. |
| `scripts/record-baked-finish.mjs --manifest <backups/…/baked-parts.last-run.json>` | Records the finish for a category run. |
