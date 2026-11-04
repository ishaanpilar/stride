// Builds the raster icon masters from the hand-made Stride icon in source/stride-icon-source.png
// (dark "S" ribbon with an orange middle band and an orange check badge, on a white background).
//
//   cd branding && bun install && bun build-raster-masters.mjs && bun generate-icons.mjs
//
// Output (branding/masters/, all PNG):
//   mark.png        the mark on transparent, tightly cropped (white check inside the badge kept)
//   silhouette.png  one-colour black silhouette, check cut out (menu bar template, themed icons)
//   padded.png      macOS grid: 824 squircle in a 1024 canvas, with the system drop shadow
//   squircle.png    full-bleed squircle, transparent corners
//   circle.png      circle (Android round launcher)
//   square.png      opaque full-bleed square (iOS / stores apply their own mask)
//   bg.png / fg.png Android adaptive background / foreground (mark inside the 66/108 safe zone)
//   mono.png        white silhouette on transparent, inside the adaptive safe zone
//   tray.png        black silhouette, tight with a small margin, square
// generate-icons.mjs uses these automatically whenever branding/masters/ exists.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { squircle, render } from './design.mjs';

const HERE = import.meta.dirname;
const SRC = path.join(HERE, 'source/stride-icon-source.png');
const OUT = path.join(HERE, 'masters');
fs.mkdirSync(OUT, { recursive: true });
const N = 2048;

// ---------- 1. extract the mark from its white background ----------
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const px = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
const minc = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { const [r, g, b, a] = px(i); minc[i] = a < 8 ? 255 : Math.min(r, g, b); }

// Background = near-white pixels connected to the image border (the white check inside the
// orange badge is enclosed by orange, so it is not reached and stays part of the mark).
const BG_T = 200;
const bg = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const i = stack.pop();
  if (bg[i] || minc[i] < BG_T) continue;
  bg[i] = 1;
  const x = i % W, y = (i / W) | 0;
  if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mark = Buffer.alloc(W * H * 4);   // colour mark, un-premultiplied from white
const sil = Buffer.alloc(W * H * 4);    // black silhouette with the check cut out
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let i = 0; i < W * H; i++) {
  const [r, g, b] = px(i);
  // coverage: 1 inside the mark; on the anti-aliased fringe estimate from distance to white
  let a = bg[i] ? clamp01(((255 - minc[i]) / 255 - 0.05) / 0.95) : 1;
  if (a > 0) {
    const un = (c) => Math.round(Math.max(0, Math.min(255, (c - (1 - a) * 255) / a)));
    mark[i * 4] = un(r); mark[i * 4 + 1] = un(g); mark[i * 4 + 2] = un(b); mark[i * 4 + 3] = Math.round(a * 255);
    const x = i % W, y = (i / W) | 0;
    if (a > 0.1) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  // silhouette: interior white (the check) becomes a hole, with a soft edge
  const inner = bg[i] ? 1 : clamp01((235 - minc[i]) / 90);
  sil[i * 4 + 3] = Math.round(a * inner * 255);
}
const crop = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
const toPng = (buf) => sharp(buf, { raw: { width: W, height: H, channels: 4 } }).extract(crop).png().toBuffer();
const markPng = await toPng(mark);
const silPng = await toPng(sil);
fs.writeFileSync(path.join(OUT, 'mark.png'), markPng);
fs.writeFileSync(path.join(OUT, 'silhouette.png'), silPng);
console.log(`mark bbox ${crop.width}x${crop.height} at ${crop.left},${crop.top} (source ${W}x${H})`);

// ---------- 2. compose the masters ----------
// Fit `png` so its longest side is `frac` of `size`, centred (with an optical nudge).
async function fitted(png, size, frac, { dx = 0, dy = 0 } = {}) {
  const m = await sharp(png).metadata();
  const s = (size * frac) / Math.max(m.width, m.height);
  const w = Math.round(m.width * s), h = Math.round(m.height * s);
  const input = await sharp(png).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  return { input, left: Math.round((size - w) / 2 + dx * size), top: Math.round((size - h) / 2 + dy * size) };
}
const canvas = (size, layers, bgColor = { r: 0, g: 0, b: 0, alpha: 0 }) =>
  sharp({ create: { width: size, height: size, channels: 4, background: bgColor } }).composite(layers).png().toBuffer();

const TILE = `<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF0F4"/></linearGradient></defs>`;
const tileSvg = (shapeFor, { pad }) => {
  const s = pad ? 1 : 1024 / 824;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${TILE}
  <defs><filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope="0.30"/></feComponentTransfer></filter></defs>
  <g transform="translate(512 512) scale(${s}) translate(-512 -512)">
    ${pad ? `<g filter="url(#sh)" fill="#101018">${shapeFor}</g>` : ''}
    <g fill="url(#t)">${shapeFor}</g>
    ${pad ? `<g fill="none" stroke="#000" stroke-opacity="0.06" stroke-width="2">${shapeFor}</g>` : ''}
  </g></svg>`;
};
const SQ = `<path d="${squircle(412)}"/>`;
const CI = `<circle cx="512" cy="512" r="412"/>`;
const nudge = { dx: -0.012, dy: 0.012 }; // the badge sits top-right; shift the mark slightly down-left

const write = async (name, buf) => { fs.writeFileSync(path.join(OUT, `${name}.png`), buf); };
await write('padded', await canvas(N, [await fitted(markPng, N, 0.80 * 0.62, nudge)].map(l => l), undefined)
  .then(async (markLayer) => canvas(N, [{ input: render(tileSvg(SQ, { pad: true }), N) }, { input: markLayer }])));
await write('squircle', await canvas(N, [{ input: render(tileSvg(SQ, { pad: false }), N) }, await fitted(markPng, N, 0.62, nudge)]));
await write('circle', await canvas(N, [{ input: render(tileSvg(CI, { pad: false }), N) }, await fitted(markPng, N, 0.58, nudge)]));
await write('square', await canvas(N, [await fitted(markPng, N, 0.62, nudge)], { r: 255, g: 255, b: 255, alpha: 1 }));
await write('bg', await canvas(N, [{ input: render(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${TILE}<rect width="1024" height="1024" fill="url(#t)"/></svg>`, N) }]));
await write('fg', await canvas(N, [await fitted(markPng, N, 0.50, nudge)]));
const white = await sharp(silPng).negate({ alpha: false }).png().toBuffer(); // black -> white, alpha kept
await write('mono', await canvas(N, [await fitted(white, N, 0.50, nudge)]));
await write('tray', await canvas(1024, [await fitted(silPng, 1024, 0.94)]));
console.log(`wrote masters to ${path.relative(process.cwd(), OUT) || OUT}`);
