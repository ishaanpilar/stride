// Rasterises the Stride masters into every platform icon in the repo.
// Usage (from anywhere):  cd branding && bun install && bun generate-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { iconSvg, squareIconSvg, backgroundSvg, foregroundSvg, monoSvg, traySvg, DEFAULT_CONCEPT as K, render } from './design.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const out = [];
const cache = new Map();
const base = (name, svg) => (cache.get(name) ?? (cache.set(name, render(svg, 2048)), cache.get(name)));

const SRC = {
  padded: () => base('padded', iconSvg(K, { pad: true })),          // macOS grid: 824 squircle in 1024
  squircle: () => base('squircle', iconSvg(K, { pad: false })),     // full-bleed squircle, transparent corners
  circle: () => base('circle', iconSvg(K, { pad: false, shape: 'circle' })),
  square: () => base('square', squareIconSvg(K)),                   // opaque, no rounding (iOS / stores)
  bg: () => base('bg', backgroundSvg()),
  fg: () => base('fg', foregroundSvg(K)),
  mono: () => base('mono', monoSvg(K)),
  tray: () => render(traySvg(K), 1024),
};
// Raster masters (from build-raster-masters.mjs) win over the SVG concepts when present.
const MASTERS = path.join(import.meta.dirname, 'masters');
const RASTER = fs.existsSync(path.join(MASTERS, 'padded.png'));
if (RASTER) for (const k of Object.keys(SRC)) { const f = path.join(MASTERS, `${k}.png`); SRC[k] = () => (cache.get(f) ?? (cache.set(f, fs.readFileSync(f)), cache.get(f))); }

async function put(rel, kind, w, h = w, opts = {}) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let img = sharp(SRC[kind]()).resize(w, h, { kernel: 'lanczos3' });
  if (opts.inset) { // draw the source smaller on a transparent canvas of w x h
    const s = Math.round(w * opts.inset);
    img = sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp(SRC[kind]()).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer(), gravity: 'center' }]);
  }
  if (opts.flatten) img = img.flatten({ background: '#2F6BFF' }).removeAlpha();
  if (/\.webp$/.test(rel)) await img.webp({ lossless: true }).toFile(file);
  else await img.png({ compressionLevel: 9 }).toFile(file);
  out.push(rel);
}
async function trayAt(rel, w) { // template image: crisp alpha-only black
  const file = path.join(ROOT, rel); fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(RASTER ? SRC.tray() : render(traySvg(K), w * 4)).resize(w, w, { kernel: 'lanczos3' }).png().toFile(file); out.push(rel);
}

// ---------------- desktop (Tauri) ----------------
const D = 'apps/desktop/src-tauri/icons';
await put(`${D}/icon.png`, 'padded', 512);
for (const [n, s] of [['32x32', 32], ['64x64', 64], ['128x128', 128], ['128x128@2x', 256]]) await put(`${D}/${n}.png`, 'squircle', s);
for (const s of [30, 44, 71, 89, 107, 142, 150, 284, 310]) await put(`${D}/Square${s}x${s}Logo.png`, 'squircle', s);
await put(`${D}/StoreLogo.png`, 'squircle', 50);
await trayAt(`${D}/tray.png`, 64);
for (const [rel, s] of [['AppIcon-20x20@1x', 20], ['AppIcon-20x20@2x', 40], ['AppIcon-20x20@2x-1', 40], ['AppIcon-20x20@3x', 60],
  ['AppIcon-29x29@1x', 29], ['AppIcon-29x29@2x', 58], ['AppIcon-29x29@2x-1', 58], ['AppIcon-29x29@3x', 87],
  ['AppIcon-40x40@1x', 40], ['AppIcon-40x40@2x', 80], ['AppIcon-40x40@2x-1', 80], ['AppIcon-40x40@3x', 120],
  ['AppIcon-60x60@2x', 120], ['AppIcon-60x60@3x', 180], ['AppIcon-76x76@1x', 76], ['AppIcon-76x76@2x', 152],
  ['AppIcon-83.5x83.5@2x', 167], ['AppIcon-512@2x', 1024]]) await put(`${D}/ios/${rel}.png`, 'square', s, s, { flatten: true });
for (const [d, fg, leg] of [['mdpi', 108, 48], ['hdpi', 162, 49], ['xhdpi', 216, 96], ['xxhdpi', 324, 144], ['xxxhdpi', 432, 192]]) {
  await put(`${D}/android/mipmap-${d}/ic_launcher_foreground.png`, 'fg', fg);
  await put(`${D}/android/mipmap-${d}/ic_launcher.png`, 'squircle', leg);
  await put(`${D}/android/mipmap-${d}/ic_launcher_round.png`, 'circle', leg);
}
// icon.icns (macOS) from the padded master via iconutil
{
  const set = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'stride-')) + '/icon.iconset'; fs.mkdirSync(set);
  for (const [n, s] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]])
    await sharp(SRC.padded()).resize(s, s, { kernel: 'lanczos3' }).png().toFile(`${set}/icon_${n}.png`);
  execSync(`iconutil -c icns "${set}" -o "${path.join(ROOT, D, 'icon.icns')}"`); out.push(`${D}/icon.icns`);
}
// icon.ico with 32x32 first (see icons/README.md), PNG-compressed entries
{
  const sizes = [32, 16, 24, 48, 64, 256];
  const pngs = await Promise.all(sizes.map(s => sharp(SRC.squircle()).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer()));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length; const dir = [];
  pngs.forEach((p, i) => { const e = Buffer.alloc(16); e[0] = sizes[i] % 256; e[1] = sizes[i] % 256; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(p.length, 8); e.writeUInt32LE(off, 12); off += p.length; dir.push(e); });
  fs.writeFileSync(path.join(ROOT, D, 'icon.ico'), Buffer.concat([head, ...dir, ...pngs])); out.push(`${D}/icon.ico`);
}

// ---------------- desktop web ----------------
for (const dir of ['apps/desktop/public', 'apps/desktop/dist']) {
  if (!fs.existsSync(path.join(ROOT, dir))) continue;
  await put(`${dir}/icon.png`, 'squircle', 1024);
  await put(`${dir}/logo.png`, 'squircle', 128);
}

// ---------------- mobile (Expo) ----------------
const M = 'apps/mobile/assets/images';
await put(`${M}/icon.png`, 'square', 1024, 1024, { flatten: true });
await put(`${M}/icon_512.png`, 'square', 512, 512, { flatten: true });
await put(`${M}/favicon.png`, 'squircle', 48);
await put(`${M}/splash-icon.png`, 'squircle', 1024);
await put(`${M}/android-icon-background.png`, 'bg', 1024);
await put(`${M}/android-icon-foreground.png`, 'fg', 1024);
await put(`${M}/android-icon-monochrome.png`, 'mono', 1024);

// ---------------- iOS native + watch ----------------
await put('apps/ios-native/App/Assets.xcassets/AppIcon.appiconset/icon.png', 'square', 1024, 1024, { flatten: true });
await put('apps/mobile/targets/watch/Resources/AppIcon.appiconset/AppIcon.png', 'square', 1024, 1024, { flatten: true });

// ---------------- Android native ----------------
const R = 'apps/android-native/android/app/src/main/res';
for (const [d, fg, leg] of [['mdpi', 108, 48], ['hdpi', 162, 72], ['xhdpi', 216, 96], ['xxhdpi', 324, 144], ['xxxhdpi', 432, 192]]) {
  await put(`${R}/mipmap-${d}/ic_launcher_background.webp`, 'bg', fg);
  await put(`${R}/mipmap-${d}/ic_launcher_foreground.webp`, 'fg', fg);
  await put(`${R}/mipmap-${d}/ic_launcher.webp`, 'squircle', leg);
  await put(`${R}/mipmap-${d}/ic_launcher_round.webp`, 'circle', leg);
}
for (const [d, s] of [['mdpi', 288], ['hdpi', 432], ['xhdpi', 576], ['xxhdpi', 864], ['xxxhdpi', 1152]]) await put(`${R}/drawable-${d}/splashscreen_logo.png`, 'squircle', s, s, { inset: 0.46 });
await put(`${R}/drawable-nodpi/about_app_icon.png`, 'squircle', 336);
if (RASTER) { // themed (monochrome) adaptive icon as a bitmap: the raster mark has no vector geometry
  fs.rmSync(path.join(ROOT, R, 'drawable/ic_launcher_monochrome.xml'), { force: true });
  await put(`${R}/drawable-nodpi/ic_launcher_monochrome.png`, 'mono', 432);
} else { // themed (monochrome) adaptive icon as a vector drawable, redrawn from the mark geometry
  const { concepts } = await import('./design.mjs');
  const c = concepts[K];
  const paths = c.paths.map(p => `    <path\n        android:pathData="${p.d}"\n        android:fillColor="#00000000"\n        android:strokeColor="#FFFFFFFF"\n        android:strokeWidth="${c.sw}"\n        android:strokeLineCap="round"\n        android:strokeLineJoin="round" />`).join('\n');
  fs.writeFileSync(path.join(ROOT, R, 'drawable/ic_launcher_monochrome.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="1024"\n    android:viewportHeight="1024">\n${paths}\n</vector>\n`);
  out.push(`${R}/drawable/ic_launcher_monochrome.xml`);
}

// ---------------- store metadata ----------------
await put('metadata/en-US/images/icon.png', 'square', 512, 512, { flatten: true });

// ---------------- extra tray template sizes + README logos (kept in branding/) ----------------
const B = 'branding/export';
for (const s of [16, 18, 32, 36]) await trayAt(`${B}/tray-template-${s}.png`, s);
await put(`${B}/stride-app-icon-1024.png`, 'padded', 1024);
for (const v of ['light', 'dark']) {
  const svg = RASTER
    ? rasterWordmarkSvg(v === 'dark')
    : fs.readFileSync(path.join(ROOT, `branding/stride-wordmark-${v}.svg`), 'utf8');
  const png = render(svg, 1600);
  fs.writeFileSync(path.join(ROOT, `${B}/stride-wordmark-${v}.png`), png); out.push(`${B}/stride-wordmark-${v}.png`);
}
function rasterWordmarkSvg(dark) { // the mark image + "Stride" set in a system font
  // on dark backgrounds the dark ribbon would vanish, so the dark variant uses the white app tile
  const mark = fs.readFileSync(path.join(MASTERS, dark ? 'squircle.png' : 'mark.png')).toString('base64');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="560" viewBox="0 0 1600 560">
  <image x="40" y="40" width="480" height="480" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${mark}"/>
  <text x="580" y="388" font-family="Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="300" letter-spacing="-6" fill="${dark ? '#FFFFFF' : '#1E1B2B'}">Stride</text>
</svg>`;
}
console.log(`wrote ${out.length} files`);
fs.writeFileSync(path.join(ROOT, 'branding/.generated-files.txt'), out.join('\n') + '\n');
