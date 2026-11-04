# Stride branding

Chosen mark: **Split S** — a bold two-arc "S" (indigo/blue app-icon gradient, white top arc, warm amber-to-coral lower arc).
Alternatives live in `concepts/` (`compare.png` shows all three at 1024/128/16 px on light and dark).

## Masters
| File | What |
|---|---|
| `stride-mark.svg` | Glyph only, brand colours, transparent |
| `stride-app-icon.svg` | 1024 macOS icon (824 squircle, gradient, depth) |
| `stride-tray-template.svg` | Menu-bar template glyph: black on transparent, thinner stroke |
| `stride-wordmark-light.svg` / `-dark.svg` | Mark + "tride" lettering drawn as outlined strokes (no font needed) |
| `design.mjs` | All geometry; edit `concepts` here |
| `concepts/` | `stride-A-cascade.svg`, `stride-B-step-to-done.svg`, `stride-C-split-s.svg` (+ `-mark` files), `compare.png` |
| `export/` | `stride-app-icon-1024.png`, `stride-wordmark-{light,dark}.png`, `tray-template-{16,18,32,36}.png` |

## Regenerate everything
```sh
cd branding
bun install                 # @resvg/resvg-js + sharp
bun build-masters.mjs       # rewrites the SVG masters
bun build-concepts.mjs      # rewrites concepts/ and compare.png
bun generate-icons.mjs      # rasterises every platform icon (list in .generated-files.txt)
```
To switch concept, change `DEFAULT_CONCEPT` in `design.mjs` and re-run the three commands.
`generate-icons.mjs` writes the macOS `.icns` with `iconutil` (macOS only) and builds `icon.ico` itself so 32x32 stays first (see `apps/desktop/src-tauri/icons/README.md`).

## Generated assets (see `.generated-files.txt` for the exact list)
- Desktop (Tauri): `icon.png`, `icon.icns`, `icon.ico`, `32x32`/`64x64`/`128x128`/`128x128@2x`, `Square*Logo`, `StoreLogo`, `tray.png`, `ios/*`, `android/*`
- Desktop web: `apps/desktop/public` and `dist` `icon.png`, `logo.png`
- Mobile (Expo): `apps/mobile/assets/images` icon, icon_512, favicon, splash-icon, android-icon-{background,foreground,monochrome}
- iOS native + watch: AppIcon 1024 (opaque square)
- Android native: `mipmap-*` launcher/round/foreground/background webp, `splashscreen_logo`, `about_app_icon`, `ic_launcher_monochrome.xml` (vector)
- Store: `metadata/en-US/images/icon.png`

## Current icon (raster source)

Since 4 November 2026 the Stride icon is the hand-made artwork in `source/stride-icon-source.png`
(a dark "S" ribbon with an orange middle band and an orange check badge). The SVG concepts above
are kept for reference only.

`bun build-raster-masters.mjs` removes the white background (the white check inside the badge is kept),
crops the mark and writes the masters to `masters/`: the app tiles (white squircle), Android adaptive
layers, and a one-colour silhouette for the macOS menu bar template and Android themed icons.
`generate-icons.mjs` uses `masters/` automatically whenever it exists. To change the icon, replace the
source PNG (any size, white background) and run:

    cd branding && bun install && bun build-raster-masters.mjs && bun generate-icons.mjs
