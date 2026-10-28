# Wardrobe finishes on the live server

Gives the wardrobes that are already uploaded the same default finish a new
wardrobe upload now gets:

| Part | Finish |
|---|---|
| Door, drawer front | Wood 10002 (same as the kitchen shutters) |
| Bar handle, knob | Wood 10012 (same as the kitchen handles) |
| Aluminium profile handle | Aluminium (silver-grey, no texture) |
| Fluted glass | left as it is |
| Body, shelves, back | plain white |

Open units with no drawer have nothing to colour and stay white.

The finish is **baked into the 3D (GLB) files**. The two woods are also
**recorded in the database**, so the Components panel and the BOQ show them.
Aluminium is not a catalogue finish, so it is in the 3D file only. GLB files are
not in git, so this has to be run on the live server itself.

## What you need

- The latest code on the live server (`git pull`), then `npm install` in
  `backend/`, then restart the backend. The restart is what makes **new**
  wardrobe uploads get the finish; the script below fixes the old ones.
- The backend `.env` with `MONGODB_URL` and `GLB_STORAGE_DIR`, the same as for
  the cabinet finishes (see `CABINET-FINISH-LIVE-GUIDE.md`).
- Optional: `WARDROBE_CATEGORY` if the wardrobe category on live is not called
  "Wardrobe"; `WOOD_TEXTURE_DIR` and `CABINET_BACKUP_DIR` as for the cabinets.

## Steps (run in the `backend/` folder)

1. **Check.** This changes nothing:

   ```bash
   npm run wardrobe-finishes:check
   ```

   Every line under "1. Checks" must show ✔. Look at the category line: it
   must name the wardrobe category with the number of models you expect. Then
   each wardrobe is listed with what it would get, for example
   `2 front(s) wood, 1 handle(s) wood, 1 profile(s) aluminium`.

2. **Apply.**

   ```bash
   npm run wardrobe-finishes:apply
   ```

   It keeps a copy of every file it changes (in
   `<backup folder>/glb-original-wardrobe/`), bakes the finish, records the
   woods in the database, and re-opens every file to verify it. The last lines
   print the undo command.

3. Ask users to refresh the page with **Ctrl+F5** so the browser loads the new
   3D files.

## Undo

The apply step prints the exact command, for example:

```bash
node scripts/production/wardrobe-finish-live.mjs --restore "<backup folder>/wardrobe-finishes-run-<date>.json"
```

It puts the original GLB files back and removes the finishes it recorded.

## Running it again

It is safe to run again. Every run starts from the copy kept on the first run,
so a file is never finished twice. A finish someone already chose on a placed
wardrobe is never replaced.
