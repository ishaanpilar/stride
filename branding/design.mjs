// Shared geometry + SVG builders for the Stride brand. Everything lives in a 1024 box.
import { Resvg } from '@resvg/resvg-js';

export const COLORS = { indigo: '#1A1366', blue: '#2F6BFF', sky: '#5AA9FF', warm1: '#FFC857', warm2: '#FF7847', white: '#FFFFFF', ink: '#0E1126' };

// Concept marks: { sw: stroke width, paths: [{ d, accent? }] }. Centred on 512,512, ~520px box.
export const concepts = {
  'A-cascade': { name: 'Cascade', sw: 100, paths: [
    { d: 'M 318 290 L 468 440 L 318 590' },
    { d: 'M 520 434 L 670 584 L 520 734', accent: true },
  ] },
  'B-step-to-done': { name: 'Step to Done', sw: 92, paths: [
    { d: 'M 262 560 L 372 670 L 452 590 L 452 500 L 566 500 L 566 400 L 666 400 L 666 312 L 770 312' },
  ] },
  'C-split-s': { name: 'Split S', sw: 98, paths: [
    { d: 'M 605.5 350 A 108 108 0 1 0 512 512' },
    { d: 'M 512 512 A 108 108 0 1 1 418.5 674', accent: true },
  ] },
};
export const DEFAULT_CONCEPT = 'C-split-s';

export function squircle(h = 412, n = 5, steps = 400) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    pts.push(`${(512 + h * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(1)} ${(512 + h * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(1)}`);
  }
  return 'M ' + pts.join(' L ') + ' Z';
}

const stroke = (c, paint, accentPaint) => c.paths.map(p =>
  `<path d="${p.d}" fill="none" stroke="${p.accent && accentPaint ? accentPaint : paint}" stroke-width="${c.sw}" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n    ');

export const markSvg = (key, { size = 1024, color = COLORS.ink, accent = null, bg = null } = {}) => {
  const c = concepts[key];
  const defs = accent ? `<defs><linearGradient id="wm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS.warm1}"/><stop offset="1" stop-color="${COLORS.warm2}"/></linearGradient></defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${defs}${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}
    ${stroke(c, color, accent ? 'url(#wm)' : null)}
</svg>`;
};

// Full app icon. pad=true -> macOS grid (824 squircle in 1024). pad=false -> fills canvas.
export const iconSvg = (key, { pad = true, shape = 'squircle' } = {}) => {
  const c = concepts[key];
  const s = pad ? 1 : 1024 / 824;           // scale so the squircle fills the canvas when unpadded
  const bgShape = shape === 'circle' ? `<circle cx="512" cy="512" r="412"/>` : `<path d="${squircle(412)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="${COLORS.sky}"/><stop offset="0.45" stop-color="${COLORS.blue}"/><stop offset="1" stop-color="${COLORS.indigo}"/></linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="wm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS.warm1}"/><stop offset="1" stop-color="${COLORS.warm2}"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="16"/><feOffset dy="14"/><feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer></filter>
    <filter id="msh" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope="0.30"/></feComponentTransfer></filter>
    <clipPath id="cl">${bgShape}</clipPath>
  </defs>
  <g transform="translate(512 512) scale(${s}) translate(-512 -512)">
    ${pad ? `<g filter="url(#sh)" fill="#0A0A40">${bgShape}</g>` : ''}
    <g fill="url(#bg)">${bgShape}</g>
    <g clip-path="url(#cl)"><rect width="1024" height="1024" fill="url(#gloss)"/></g>
    <g filter="url(#msh)" fill="none" stroke="#0A0A40" stroke-width="${c.sw}" stroke-linecap="round" stroke-linejoin="round">${c.paths.map(p => `<path d="${p.d}"/>`).join('')}</g>
    ${stroke(c, '#FFFFFF', 'url(#wm)')}
  </g>
</svg>`;
};

export function render(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

// ---------------- extra builders (square icon, tray, wordmark) ----------------
export const DEFAULT = concepts[DEFAULT_CONCEPT];

// Icon with no rounding (iOS/Play/App Store supply their own mask). opaque square gradient.
export const squareIconSvg = (key = DEFAULT_CONCEPT) =>
  iconSvg(key, { pad: false }).replace(/<g fill="url\(#bg\)">.*?<\/g>/s, '<rect width="1024" height="1024" fill="url(#bg)"/>')
    .replace(/<clipPath id="cl">.*?<\/clipPath>/s, '<clipPath id="cl"><rect width="1024" height="1024"/></clipPath>');

// Gradient background only (Android adaptive background layer)
export const backgroundSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="bg" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="${COLORS.sky}"/><stop offset="0.45" stop-color="${COLORS.blue}"/><stop offset="1" stop-color="${COLORS.indigo}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#bg)"/></svg>`;

// Foreground-only mark (transparent), white + warm accent, for adaptive icons / splash
export const foregroundSvg = (key = DEFAULT_CONCEPT) => markSvg(key, { color: '#FFFFFF', accent: true });
// Single-colour silhouette (Android themed icon)
export const monoSvg = (key = DEFAULT_CONCEPT) => markSvg(key, { color: '#FFFFFF' });

// Menu-bar template: black on transparent, thinner stroke, cropped tight to the glyph.
export const traySvg = (key = DEFAULT_CONCEPT) => {
  const c = { ...concepts[key], sw: 76 };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="232 232 560 560">
  ${c.paths.map(p => `<path d="${p.d}" fill="none" stroke="#000" stroke-width="${c.sw}" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n  ')}
</svg>`;
};

// Mark in brand colours on transparent (for light backgrounds); dark variant lightens the top.
export const brandMarkSvg = (key = DEFAULT_CONCEPT, dark = false) => markSvg(key, { color: dark ? COLORS.sky : '#2A44D8', accent: true });

// Wordmark: the mark's S + "tride" drawn from the same round-cap strokes (no font dependency).
export const wordmarkSvg = (dark = false) => {
  const sw = 64, top = dark ? '#7DB8FF' : '#2A44D8', ink = dark ? '#FFFFFF' : COLORS.ink;
  const st = (d, col, w = sw) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const letters = [
    'M 805 360 V 652 A 76 76 0 0 0 881 728', 'M 745 508 H 881',           // t
    'M 995 508 V 728', 'M 995 600 A 92 92 0 0 1 1087 508',                // r
    'M 1200 508 V 728',                                                   // i
    'M 1532 296 V 728',                                                   // d stem
    'M 1644 618 H 1864 A 110 110 0 1 0 1838.3 688.7',                     // e
  ].map(d => st(d, ink)).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1581" height="610" viewBox="335 207 1581 610">
  <defs><linearGradient id="wm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS.warm1}"/><stop offset="1" stop-color="${COLORS.warm2}"/></linearGradient></defs>
  ${st('M 605.5 350 A 108 108 0 1 0 512 512', top, 98)}
  ${st('M 512 512 A 108 108 0 1 1 418.5 674', 'url(#wm)', 98)}
  ${letters}
  <circle cx="1200" cy="404" r="38" fill="${ink}"/>
  <circle cx="1422" cy="618" r="110" fill="none" stroke="${ink}" stroke-width="${sw}"/>
</svg>`;
};
