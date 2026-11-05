import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../../index.css'), 'utf8');
const focusBlock = css.slice(css.indexOf('Focus mode ("Still")'));

describe('focus mode CSS (reduced motion / transparency / contrast)', () => {
    it('dims with grayscale + blur by default', () => {
        expect(css).toMatch(/\[data-focus-session='focus'\]\s*{\s*filter: grayscale\(0\.9\) blur\(1px\);\s*opacity: 0\.35;/);
    });
    it('uses a flat dim (no filter) under reduced motion and reduced transparency', () => {
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\), \(prefers-reduced-transparency: reduce\) {\s*\[data-focus-session='focus'\] { filter: none; opacity: 0\.45; }/);
    });
    it('drops the blur under increased contrast', () => {
        expect(css).toMatch(/@media \(prefers-contrast: more\) {\s*\[data-focus-session='focus'\] { filter: grayscale\(0\.9\);/);
    });
    it('makes the glass card and veil solid under reduced transparency or more contrast', () => {
        expect(focusBlock).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) {\s*\.fx-card { background: hsl\(var\(--card\)\); -webkit-backdrop-filter: none; backdrop-filter: none; }/);
        expect(focusBlock).toMatch(/@media \(prefers-reduced-transparency: reduce\) { \.fx-veil { background: hsl\(var\(--background\) \/ 0\.94\);/);
    });
    it('collapses every focus animation when Animations are off (setting or system)', () => {
        const off = focusBlock.slice(focusBlock.indexOf("html[data-motion='off'] :is("));
        for (const cls of ['.fx-amb > i', '.fx-digit-in', '.fx-step-enter', '.fx-check::after', '.fx-wave', '.fx-mark path', '.fx-pop-in', '.fx-mark-bloom', '.fx-step\n']) {
            expect(off.slice(0, off.indexOf('{ animation: none !important; }'))).toContain(cls);
        }
        expect(off).toContain("html[data-motion='off'] :is(.fx-wave, .fx-mark-bloom, .fx-bloom) { display: none; }");
        const transitions = off.slice(off.indexOf("html[data-motion='off'] :is(.fx-veil"));
        expect(transitions.slice(0, transitions.indexOf('transition: none !important;'))).toContain('.fx-mini');
        const reduced = focusBlock.slice(focusBlock.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
        expect(reduced).toMatch(/\.fx-amb > i, \.fx-amb, \.fx-clock \.c, \.fx-digit-in, \.fx-step-enter/);
        expect(reduced).toContain('.fx-wave, .fx-mark-bloom { display: none; }');
    });
    it('keeps the ring glow and completion burst off under reduced motion', () => {
        const reduced = focusBlock.slice(focusBlock.indexOf('@media (prefers-reduced-motion: reduce) {\n  .ui-reveal'));
        expect(reduced).toMatch(/\.pomo-burst { display: none; }/);
        expect(reduced).toMatch(/\.pomo-ring\[data-running='true'\] \.pomo-glow { animation: none; }/);
        expect(reduced).toMatch(/\.ui-reveal, \.ui-reveal\[data-open='false'\] { transition: none; transform: none; }/);
    });
});
