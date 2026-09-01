# Theme Catalogue

This folder holds the inspiration images for the AI room generator. The
frontend's theme picker (Stepper 2) reads from `themes.json` (auto-generated
at build time by `scripts/build-themes-manifest.js`).

## Folder structure

```
public/themes/
├── themes.json                       ← AUTO-GENERATED, do not edit by hand
├── README.md
├── <StyleName>/
│   ├── <RoomType>/
│   │   ├── style-room-1.jpg          ← shown as the default thumbnail (-1)
│   │   ├── style-room-2.jpg          ← second default thumbnail   (-2)
│   │   └── style-room-3.jpg          ← extra image in the gallery
│   ├── <AnotherRoomType>/
│   └── ...
└── <AnotherStyle>/
    └── ...
```

Example:

```
public/themes/
├── Modern/
│   ├── LivingRoom/
│   │   ├── modern-living-1.jpg
│   │   ├── modern-living-2.jpg
│   │   └── modern-living-3.jpg
│   └── Bedroom/
│       └── ...
└── Scandinavian/
    └── LivingRoom/
        └── ...
```

## Adding a theme

1. Create a folder for the style (e.g. `Industrial`).
2. Inside it, one folder per room type (`LivingRoom`, `Bedroom`, `Kitchen`,
   `Office`, ...).
3. Drop the inspiration images inside. Use `.jpg`, `.png`, or `.webp`.
4. Run `npm start` or `npm run build` — the prebuild script regenerates
   `themes.json` and the new theme shows up in the picker.

## Important rules

- **Folder names matter** — the `theme_name` and `room_type` shown to users
  come directly from the folder names. Use display-ready names (no
  abbreviations, no `lower_case_with_underscores`).
- **Image filenames** ending in `-1.jpg` or `-2.jpg` are treated as default
  thumbnails (shown first in the picker). Everything else loads as a gallery
  image.
- **`.DS_Store` and `Thumbs.db`** are ignored automatically.

## Why these images aren't on cloud storage anymore

These used to live in a DigitalOcean Spaces bucket. They were moved into the
SPA's `public/` folder so the catalogue ships atomically with the code,
removes the recurring storage bill, and eliminates the leaked-credentials
attack surface. See `src/TypeStore.js` for the new runtime behaviour.
