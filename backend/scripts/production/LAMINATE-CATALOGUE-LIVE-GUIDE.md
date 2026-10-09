# Loading the laminate brand catalogues on live

Merino, Greenlam and Virgo — their grades, materials and pictures — were built
on a development PC. This is how to get them onto another server.

## What is in git, and what is not

| | In git? |
|---|---|
| The code | yes |
| The pictures (`frontend/public/assets/rooms/textures/library/merino`, `greenlam`, `virgo`) | yes |
| The catalogue rows, as a data file (`scripts/production/data/laminate-catalogue.json`) | yes |
| The catalogue rows **in a database** | **no — a database is never in git** |

So a push alone gives the server the code and the pictures and nothing for the
code to show. The script below turns the data file into database rows.

## The order matters

**Load the catalogue BEFORE the new frontend goes out.** The new material panel
lists the grades a brand owns. Until those exist on live, a brand has nothing to
offer and no finish can be picked.

## Steps, on the server

All commands are run from the `backend` folder. The script reads `MONGODB_URL`
from the backend `.env`, the same way the app does, and prints the database it
is about to touch (password hidden) before doing anything.

### 1. Get the code and the pictures

```bash
git pull
```

### 2. Check — changes nothing

```bash
npm run laminate-catalogue:check
```

Read the output before going on:

- **`database :`** is the live database, not `127.0.0.1`. If it says
  `127.0.0.1`, `MONGODB_URL` is not set in `backend/.env` — stop.
- **`ok    finish type "Laminates" found`**
- **`ok    every picture is on disk`**. If pictures are reported missing and the
  site serves a built bundle from another folder, set `TEXTURE_PUBLIC_DIR` to
  that folder and check again.
- The plan lists what would be created. On a first run: three brands' grades
  and 1,051 materials.

### 3. Restart the backend on the new code

```bash
pm2 restart pazl-backend
```

### 4. Apply

```bash
npm run laminate-catalogue:apply
```

It saves a run log before writing, and prints the exact command that undoes
this run. **Keep that line.**

To load the coating rates from the development PC as well:

```bash
node scripts/production/laminate-catalogue-live.mjs --apply --rates
```

A rate is added only where that brand and grade has none; a rate already on the
server is never overwritten. Without `--rates`, enter them in the Rate Card.

### 5. Verify

```bash
npm run laminate-catalogue:verify
```

Expect: `Complete: every brand, grade and material in the data file is on this
server, with its picture.`

### 6. Build and deploy the frontend

```bash
cd ../frontend && npm run build
```

### 7. Check in the app

1. Hard reload (`Ctrl+Shift+R`) — the browser keeps its own copy of the lists.
2. Select a cabinet part: **Laminates → Merino**. Style lists Merino's grades.
3. Switch to **Greenlam**, then **Virgo**. Each shows only its own grades.
4. Apply one and confirm it shows on the cabinet.
5. Open the BOQ for that project and confirm the part is priced.

## If something is wrong

```bash
node scripts/production/laminate-catalogue-live.mjs --restore "<run log printed by apply>"
```

Deletes exactly what that run created and puts back anything it changed.

## Safe to run again

A grade is identified by brand + type + name, a material by brand + grade +
décor code. Running apply a second time creates nothing. It only touches rows
belonging to the brands in the data file; materials with no brand, other brands,
saved projects and BOQ figures are never written.

## Adding or changing a catalogue later

On the development PC, after importing or editing:

```bash
node scripts/production/laminate-catalogue-export.mjs
```

That rewrites the data file from the local database. Commit it with the new
pictures, then repeat the steps above on the server.

## Not covered by this script

- **Interior rates.** The BOQ prices the inside of a carcass from the *Interior*
  tab of the Rate Card. Enter at least one rate there on live (finish type
  Laminates) before anyone generates a BOQ, or interiors come out at ₹0.
- **Tile size on the original, brandless materials.** Only the three brands'
  materials carry one. Setting it on the originals re-scales the wood on
  cabinets in existing live projects, so it is a separate, deliberate step.
