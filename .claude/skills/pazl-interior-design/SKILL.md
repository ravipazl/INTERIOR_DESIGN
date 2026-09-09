---
name: pazl-interior-design
description: Orientation and traps for the PAZL Interior Design codebase (D:\INTERIOR_DESIGN) — a merged frontend serving two separate React apps from one origin, plus a Feathers/MongoDB backend. Use this skill whenever you are working anywhere in this repo, even for a change that looks trivial. Specifically load it before touching UI styling or design tokens, adding or moving any position:fixed panel or overlay, editing the Designer's nav rail / MenuBar / RoomPanel / RenderViewModal, querying the MongoDB data directly, or claiming that a change "compiles clean". Several of the traps here are silent — the code builds, the page renders, and the bug only shows up as something quietly missing or misplaced.
---

# Working in the PAZL Interior Design codebase

This repo is the product of a merge: six older projects were folded into one
`frontend/` and one `backend/`. That history is why several things are not
where you would expect, and why a few comments in the code describe an
implementation that no longer exists. Read this before you start; it will save
you from bugs that compile fine and look fine.

## The single most important fact: two apps, one origin

`frontend/src/main.tsx` picks an app at load time based on the URL:

```js
if (window.location.pathname.startsWith("/design")) {
  import("./design-boot")   // the 3D Designer   (src/react-app/)
} else {
  import("./inspire-boot")  // Dashboard, Teams, Rate card, auth (src/inspire/)
}
```

They are **separate webpack bundles** sharing one origin and one
`localStorage` session. This has consequences you will hit immediately:

- A `react-router` `<Link>` cannot cross between them. The Designer's router
  has `basename="/design"`, so a `<Link to="/teams">` resolves to
  `/design/teams` and 404s. **Use a plain `<a href>`** for cross-app
  navigation — it does a full page load, which is correct here.
- A component added to the Designer does **not** appear in Inspire, and vice
  versa. If a user reports "the sidebar disappears when I click Dashboard",
  this is why — they left one app and entered the other.
- Inspire *can* import from the Designer via the `@pazl/*` aliases (they
  resolve to `src/react-app/*`). Shared components work, but check that any
  CSS custom properties they rely on have fallbacks, because Inspire does not
  load the Designer's `src/css/styles.css`.

### Where things live

| Path | What |
|---|---|
| `frontend/src/react-app/` | the Designer — `/design/*` |
| `frontend/src/inspire/` | Dashboard, Teams, Rate card, sign-in |
| `frontend/src/scripts/` | the 3D/2D engine (Three.js, Pixi) — aliased `@pazl/main` |
| `frontend/src/css/styles.css` | the Designer's design tokens |
| `backend/src/services/` | Feathers services |

Aliases (`frontend/webpack.config.js`): `@pazl/components`, `@pazl/services`,
`@pazl/entities`, `@pazl/utils`, `@pazl/helpers`, `@pazl/pages`,
`@pazl/main` → `src/scripts`, and `@pazl` → `src`.

Running it: `cd frontend && npm start` (webpack-dev-server, **port 3040**).
Backend: `cd backend && npm run dev` (port 3400). Mongo:
`mongodb://127.0.0.1:27017/interior-design`.

## Design tokens: change values, not components

The Designer is token-driven. `frontend/src/css/styles.css` defines the
`--pz-*` set in `:root` (plus a `.dark` block):

```
--pz-bg  --pz-panel-surface  --pz-panel-header  --pz-sidebar-bg
--pz-panel-border  --pz-panel-muted  --pz-panel-hover
--pz-text  --pz-text-2  --pz-input-bg
--pz-accent  --pz-accent-2  --pz-accent-grad  --pz-accent-soft  --pz-accent-tint
--pz-elev
--pz-nav-bg  --pz-nav-w  --pz-nav-border  --pz-nav-hover  --pz-nav-ink  --pz-nav-ink-on
```

Restyling the Designer's chrome is a **value swap in one file** — no component
edits, so no behaviour can change. That is the safe move and you should reach
for it first.

**Inspire is not tokenised.** It has ~32 CSS files with colours hardcoded
(`#414063` appears dozens of times), plus inline `style={{}}` in many
components. Do **not** blind find-and-replace there. Those occurrences are not
one thing: some are brand accent, some are body text, some are borders. A
global swap turns body text indigo and silently wrecks contrast. If you must
sweep, group by role first and show the list before changing anything.

A rule that has held up well: **`bg-[#hex]` on a filled button becomes the
accent; `text-[#hex]` usually should not.** Prices, headings and empty-state
messages are body copy, not brand.

## position:fixed elements must offset by the nav rail

The Designer has a 64px dark nav rail on the left. Anything `position: fixed`
and anchored to the **left** edge is measured from the viewport, not from the
canvas — so without an offset it slides underneath the rail and becomes
partly or wholly unclickable.

Every such element reads the shared token:

```jsx
left: "calc(var(--pz-nav-w, 0px) + 16px)"
```

Current users: `SnapControlPanel` (×2), `AiInspirationButton`, and
`RoomPanel`'s two panels. The `0px` fallback matters — those components can be
mounted where no rail exists.

Two related things worth internalising, because both bit hard:

- **`w-screen` / `100vw` inside the Designer is almost always wrong.** The
  header and the loader both used it; both overflowed 64px to the right and
  pushed their last child off screen. Use `w-full` / `100%`. The exception is
  `errorBoundary`, which wraps the rail too and legitimately covers the
  viewport.
- **Panels that must line up with the canvas should measure it**, not
  hardcode a top. `useDockTop()` (`src/react-app/hooks/useDockTop.ts`) reads
  `#bp3d-js-app`'s bounding top and re-measures on resize. A hardcoded
  `top-48` broke the moment the toolbar moved into the navbar.

## Verification: what "clean" actually means here

**`tsc --noEmit` has 38 pre-existing errors.** They live in files unrelated to
most work (`objectComponents.tsx`, `furnishMenu.tsx`, `roomPanel.tsx`,
`component.tsx`). So "no errors" is not the bar — **the count staying at 38
is**. Compare against the baseline every time:

```bash
cd frontend
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"   # expect 38
```

If it reads 40, you added two. This has caught real mistakes that a
"no errors in my files" grep missed entirely.

**`.jsx` files are not typechecked at all.** Inspire is `.jsx`, so `tsc` will
happily report 38 while an Inspire page has unbalanced JSX. Parse them
directly:

```bash
node -e "require('@babel/parser').parse(require('fs').readFileSync('FILE','utf8'),{sourceType:'module',plugins:['jsx']})"
```

**Verify against the built bundle, not the source.** webpack-dev-server serves
lazy chunks you can fetch and assert on:

```
/src_design-boot_tsx.bundle.js        the Designer
/src_inspire-boot_jsx.bundle.js       Inspire
/src_react-app_components_NavRail_index_tsx.bundle.js   shared chunks split out
```

The assertion that matters is usually **that the old value is gone**, not just
that the new one is present — both can be true at once when you have edited
one call site and missed another.

Two cautions learned the hard way:

- **`read_console_messages` returns accumulated history.** If you edit a file
  in two steps (add an opening tag, then the closing tag), webpack logs the
  transient broken state and you will read it later as a current failure. Get
  the true state from a fresh `tsc` run and a Babel parse before concluding
  you broke the build.
- **Read the file back after a scripted edit.** A `str.replace()` that does
  not match fails silently and reports success. Confirm by reading, not by
  trusting the script's own output.

## Data layer: field and id gotchas

These cost a long detour and a confidently-wrong diagnosis. Check them before
concluding data is broken.

**Collection names use underscores** — `furnished_models`, not
`furnishedmodels`. Querying the wrong name returns zero documents and looks
exactly like "no data".

Full list: `categories, company, core_material_brands, core_material_pricing,
core_material_types, finishing_brands, finishing_categories, finishing_pricing,
finishings, floorplan-templates, floorplans, furnished_model_components,
furnished_models, images, model_components, models, project_items, projects,
settings, users`.

**Models store the GLB path in `modelFileUrl`, not `url`.** No document has a
`url` field. Querying `url` makes every model look broken.

**`_id` values are strings, mostly UUIDs.** Two consequences:

- Query with the string. If a lookup fails, try both shapes before concluding
  the row is missing — an id-shape mismatch reads identically to deleted data.
- Feathers' Mongo adapter casts **24-hex** strings to `ObjectId`, which misses
  string-stored rows. `backend/src/utils/string-id-service.js`
  (`StringIdMongoService`) exists for exactly this and is already used by
  `categories`, `finishings`, `core_material_types`, `core_material_brands`,
  `finishing_brands`, `finishing_categories`. If you add a service whose rows
  have 24-hex string ids, use it. UUID ids are unaffected.

## Known traps in the Designer

**`MenuBar` keeps every tab pane mounted** — it hides them rather than
unmounting. So a `useEffect(..., [])` in `floorPlanMenu` / `furnishMenu` /
`productionMenu` runs **once when the editor loads**, not when you enter that
tab. If you want per-entry behaviour, key the effect on the active view. A
comment saying "on entering FURNISH" above an empty dep array is a bug, and
there was one.

**3D and Render share one tab.** Render must keep the 3D viewer on screen
because `RenderService.startRender()` exports the live scene and captures the
current camera. So both are `activeTab === "furnish"` and differ only by which
left panel shows. Anything comparing `activeTab` to decide between them will
silently swallow the switch — compare the nav view instead.

**`BoqTable` and `RenderHistory` are coupled.** `productionMenu` passes
`BoqTable`'s PDF getter into `RenderHistory` so "Send to admin" can attach the
quote. If only one is mounted the getter returns `null` and the email sends
**without the BOQ, with no error**. Keep them together.

**Reserving canvas space is fine; animating it is not.** `#bp3d-js-app` is
`position: relative; flex: 1` — container-sized, so it reflows around docked
siblings. But it has a `ResizeObserver`, so a width `transition` re-runs
`updateWindowSize()` every frame and re-projects the scene ~10× per click.
Snap, never animate.

**Distrust layout comments.** A comment claimed `#bp3d-js-app` was
`position: fixed; inset: 0`; it has not been for some time. Believing it leads
you to think the canvas ignores docked panels. Check the element.

## Company branding is half-built

`BoqTable` hardcodes the company name, address and contact lines (3× "PAZL",
plus the address at ~line 1156), and `backend/src/mailer.js` prints PAZL into
every outgoing email. The **client** side of the same block is live data from
`clientInfoRows`.

But a `company` service, a `company-logo` service and a populated `company`
collection now exist in the backend — **new and uncommitted at time of
writing**. So the storage half is done and the frontend half is not wired.
Check the current state before assuming either.

## Working style that fits this repo

The user works visually and iteratively: they send a screenshot, describe the
change in a few words, and expect the running app to change. A few things that
make that loop work well:

- **Measure before proposing.** "How tokenised is this actually?" is a
  two-minute grep that changes the whole plan. Guessing at scope here has been
  wrong more often than right.
- **When you move one of a coupled pair, move both.** This repo has bitten
  three separate times the same way: two panels whose positions were separate
  literals, three toolbar pills in one row, a guard comparing a field that no
  longer distinguished two states. Where you can, **derive** the second value
  from the first so it cannot drift.
- **Say plainly when something is not your change.** Several reported bugs
  turned out to be pre-existing or data-shaped. Check whether your diff even
  touches the path before offering a fix.
