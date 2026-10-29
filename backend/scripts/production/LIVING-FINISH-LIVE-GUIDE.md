# Living Room finishes on the live server

Gives the Living Room TV-wall items that are already uploaded the same default
finish a new upload now gets:

| Item | Finish |
|---|---|
| TV drawer unit (basic handle, finger groove) | drawer front Wood 10002, bar handles Wood 10012, body and top plain white |
| TV back panel (plain, groove) | whole panel Wood 10002 |
| Wall cladding | whole slat Wood 10002 |

The finish is **baked into the 3D (GLB) files** and **recorded in the
database**, so the 3D view, the Components panel and the BOQ all show it. GLB
files are not in git, so this has to be run on the live server itself.

## What you need

- The latest code on the live server (`git pull`), then `npm install` in
  `backend/`, then restart the backend. The restart is what makes **new**
  uploads in these categories get the finish; the script below fixes the old
  ones.
- The backend `.env` with `MONGODB_URL` and `GLB_STORAGE_DIR`, the same as for
  the cabinet and wardrobe finishes.
- Optional, only if a category has another name on live:
  `LIVING_TV_UNIT_CATEGORY` (default "TV Draw Unit"),
  `LIVING_TV_PANEL_CATEGORY` (default "Tv back panel"),
  `LIVING_CLADDING_CATEGORY` (default "wall cladding"). Names are matched
  ignoring case and spaces.

## Steps (run in the `backend/` folder)

1. **Check.** This changes nothing:

   ```bash
   npm run living-finishes:check
   ```

   Every line under "1. Checks" must show ✔, with one line per category and
   the number of models you expect. Then each item is listed with what it
   would get.

2. **Apply.**

   ```bash
   npm run living-finishes:apply
   ```

   It keeps a copy of every file it changes (in
   `<backup folder>/glb-original-living/`), bakes the finish, records it in the
   database, and re-opens every file to verify it. The last lines print the
   undo command.

3. Ask users to refresh the page with **Ctrl+F5**.

## Undo

The apply step prints the exact command, for example:

```bash
node scripts/production/living-finish-live.mjs --restore "<backup folder>/living-finishes-run-<date>.json"
```

## Running it again

Safe: every run starts from the copy kept on the first run, and a finish
someone already chose on a placed item is never replaced.
