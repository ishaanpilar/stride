import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    AMBIENT_ALPHA,
    FINISH_AMBIENT,
    GLASS_CARD_ALPHA,
    PAUSED_CLOCK_OPACITY,
    TEXT_SAFE_AMBIENT,
    ambientColors,
    contrastRatio,
    hslChannelsToRgb,
    mixRgb,
    type Rgb,
} from './focus-palette';

const css = readFileSync(join(__dirname, '../../index.css'), 'utf8');

/** Reads "--name: H S% L%;" from the first block that starts with `selector {`. */
function token(selector: string, name: string): Rgb {
    const start = css.indexOf(`${selector} {`);
    const block = css.slice(start, css.indexOf('\n  }', start));
    const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!match) throw new Error(`missing --${name} in ${selector}`);
    return hslChannelsToRgb(match[1]!);
}

const themes = [
    { name: 'light', selector: ':root', alpha: AMBIENT_ALPHA.light },
    { name: 'dark', selector: '.dark', alpha: AMBIENT_ALPHA.dark },
] as const;

/** Every point where up to two blobs overlap on the page background. */
function backdrops(base: Rgb, colors: readonly Rgb[], alpha: number): Rgb[] {
    const out: Rgb[] = [base];
    for (const a of colors) {
        out.push(mixRgb(base, a, alpha));
        for (const b of colors) out.push(mixRgb(mixRgb(base, a, alpha), b, alpha));
    }
    return out;
}
const worst = (fg: Rgb, bgs: Rgb[]) => Math.min(...bgs.map((bg) => contrastRatio(fg, bg)));

describe('focus stage contrast (WCAG)', () => {
    it('keeps the ambient alphas, glass and paused opacity in sync with index.css', () => {
        expect(css).toMatch(new RegExp(`:root \\{ --fx-alpha: ${AMBIENT_ALPHA.light};`));
        expect(css).toMatch(new RegExp(`\\.dark \\{ --fx-alpha: ${AMBIENT_ALPHA.dark}; \\}`));
        expect(css).toContain(`background: hsl(var(--card) / ${GLASS_CARD_ALPHA});`);
        expect(css).toContain(`.fx-stage[data-paused='true'] .fx-clock { opacity: ${PAUSED_CLOCK_OPACITY}; }`);
    });

    for (const theme of themes) {
        describe(theme.name, () => {
            const background = token(theme.selector, 'background');
            const foreground = token(theme.selector, 'foreground');
            const muted = token(theme.selector, 'muted-foreground');
            const card = token(theme.selector, 'card');
            const well = token(theme.selector, 'well');
            const lit = backdrops(background, TEXT_SAFE_AMBIENT, theme.alpha);

            it('text drawn straight on the light (the Next line, sub line) is >= 4.5:1 where blobs overlap', () => {
                expect(worst(foreground, lit)).toBeGreaterThanOrEqual(4.5);
            });

            it('the paused clock (large text) stays >= 3:1', () => {
                const dimmed = lit.map((bg) => mixRgb(bg, foreground, PAUSED_CLOCK_OPACITY));
                expect(Math.min(...dimmed.map((fg, i) => contrastRatio(fg, lit[i]!)))).toBeGreaterThanOrEqual(3);
            });

            it('every line on the glass card is >= 4.5:1, including muted steps and labels', () => {
                const glass = lit.map((bg) => mixRgb(bg, card, GLASS_CARD_ALPHA));
                expect(worst(foreground, glass)).toBeGreaterThanOrEqual(4.5);
                expect(worst(muted, glass)).toBeGreaterThanOrEqual(4.5);
            });

            it('the coach area is a solid well and its chips a solid card: every line is >= 4.5:1', () => {
                expect(css).toMatch(/\.fx-coach \{[^}]*background: hsl\(var\(--well\)\);/);
                expect(css).toMatch(/\.fx-chip \{[^}]*background: hsl\(var\(--card\)\);/);
                for (const surface of [well, card]) {
                    expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(4.5);
                    expect(contrastRatio(muted, surface)).toBeGreaterThanOrEqual(4.5);
                }
            });

            it('the finish sits on a solid surface: heading, sentence, stats and the text button are >= 4.5:1', () => {
                expect(contrastRatio(foreground, card)).toBeGreaterThanOrEqual(4.5);
                expect(contrastRatio(muted, card)).toBeGreaterThanOrEqual(4.5);
                expect(contrastRatio(foreground, well)).toBeGreaterThanOrEqual(4.5);
                expect(contrastRatio(muted, well)).toBeGreaterThanOrEqual(4.5);
            });
        });
    }

    it('the finish light is only ever behind a solid card (never behind bare text)', () => {
        expect(ambientColors('finish', 0.5)).toEqual(FINISH_AMBIENT);
        expect(TEXT_SAFE_AMBIENT).not.toContainEqual(FINISH_AMBIENT[0]);
    });

    it('drifts from indigo at the start to warm at the end of a session', () => {
        expect(ambientColors('focus', 0)[0]).toEqual([99, 102, 241]);
        expect(ambientColors('focus', 1)[1]).toEqual([251, 146, 60]);
        expect(ambientColors('break', 0.3)[0]).toEqual([45, 212, 191]);
    });
});
