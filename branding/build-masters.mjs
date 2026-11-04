// Writes the SVG master files in branding/ from the geometry in design.mjs.
import fs from 'node:fs';
import { iconSvg, brandMarkSvg, traySvg, wordmarkSvg, DEFAULT_CONCEPT } from './design.mjs';
fs.writeFileSync('stride-mark.svg', brandMarkSvg(DEFAULT_CONCEPT));
fs.writeFileSync('stride-app-icon.svg', iconSvg(DEFAULT_CONCEPT));
fs.writeFileSync('stride-tray-template.svg', traySvg(DEFAULT_CONCEPT));
fs.writeFileSync('stride-wordmark-light.svg', wordmarkSvg(false));
fs.writeFileSync('stride-wordmark-dark.svg', wordmarkSvg(true));
console.log('masters written');
