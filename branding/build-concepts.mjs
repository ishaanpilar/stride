import fs from 'node:fs';
import sharp from 'sharp';
import { concepts, markSvg, iconSvg, render, COLORS } from './design.mjs';
fs.mkdirSync('concepts', { recursive: true });
const cells = [];
for (const [k, c] of Object.entries(concepts)) {
  fs.writeFileSync(`concepts/stride-${k}.svg`, iconSvg(k));
  fs.writeFileSync(`concepts/stride-${k}-mark.svg`, markSvg(k, { color: COLORS.ink }));
}
// comparison sheet: rows = concepts; columns = icon 1024(shown 360) / 128 / 16 / glyph on light 16 / glyph on dark 16
const W = 1500, rowH = 420, H = rowH * 3 + 60;
const comps = [{ input: await sharp({ create: { width: W, height: H, channels: 4, background: '#EDEFF5' } }).png().toBuffer(), left: 0, top: 0 },
  { input: await sharp({ create: { width: 620, height: H, channels: 4, background: '#14161F' } }).png().toBuffer(), left: W - 620, top: 0 }];
let i = 0;
for (const k of Object.keys(concepts)) {
  const y = 30 + i * rowH;
  const big = await sharp(render(iconSvg(k), 1024)).resize(360).png().toBuffer();
  comps.push({ input: big, left: 30, top: y });
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="30"><text x="0" y="22" font-family="Helvetica" font-size="20" fill="#555">${k}</text></svg>`);
  comps.push({ input: label, left: 30, top: y + 372 });
  const sizes = [128, 16];
  let x = 420;
  for (const bgSide of ['light', 'dark']) {
    const bx = bgSide === 'light' ? 420 : W - 600;
    let cx = bx;
    for (const s of [128, 64, 32, 16]) {
      comps.push({ input: render(iconSvg(k), 1024) && await sharp(render(iconSvg(k), 1024)).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer(), left: cx, top: y + 20 });
      cx += s + 20;
    }
    // glyph-only, 16 & 32 px, in ink (light) / white (dark)
    const col = bgSide === 'light' ? COLORS.ink : '#FFFFFF';
    for (const s of [128, 32, 16]) {
      comps.push({ input: await sharp(render(markSvg(k, { color: col }), 1024)).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer(), left: bx + (s === 128 ? 0 : s === 32 ? 150 : 210), top: y + 200 + (s === 128 ? 0 : 50) });
    }
  }
  i++;
}
await sharp({ create: { width: W, height: H, channels: 4, background: '#EDEFF5' } }).composite(comps.slice(1)).png().toFile('concepts/compare.png');
console.log('ok');
