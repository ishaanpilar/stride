import { describe, expect, it, vi, beforeEach } from 'vitest';

const invokeNative = vi.hoisted(() => vi.fn());
vi.mock('./tauri-invoke', () => ({ invokeNative }));
vi.mock('./runtime', () => ({ isTauriRuntime: () => true }));

import {
    DARK_BACKGROUND_HEX,
    DARK_SURFACE_HEX,
    FALLBACK_ACCENT_HEX,
    LIGHT_BACKGROUND_HEX,
    LIGHT_SURFACE_HEX,
    accentToCssVariables,
    applyAccentHex,
    blendOver,
    contrastRatio,
    deriveAccentPalette,
    parseHex,
    readSystemAccentHex,
    relativeLuminance,
} from './system-accent';

const MACOS_ACCENTS: Record<string, string> = {
    blue: '#007AFF',
    purple: '#953D96',
    pink: '#E43F8C',
    red: '#E0383E',
    orange: '#F7821B',
    yellow: '#FFC600',
    green: '#62BA46',
    graphite: '#8C8C8C',
    fallback: FALLBACK_ACCENT_HEX,
};

describe('colour maths', () => {
    it('computes WCAG luminance and contrast', () => {
        expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
        expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
        expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
        expect(contrastRatio('#1F2937', '#F0F4F8')).toBeGreaterThan(13);
    });

    it('parses hex and rejects junk', () => {
        expect(parseHex('#4F46E5')).toEqual({ r: 79, g: 70, b: 229 });
        expect(parseHex('nope')).toBeNull();
    });

    it('blends over a background', () => {
        expect(blendOver('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    });
});

describe.each(Object.entries(MACOS_ACCENTS))('deriveAccentPalette(%s %s)', (_name, hex) => {
    const palette = deriveAccentPalette(hex);

    it('keeps the accent and normalises hex', () => {
        expect(palette.hex).toBe(hex.toUpperCase());
        expect(palette.accent).toMatch(/^\d+ \d+% \d+%$/);
    });

    it('gives the label at least 4.5:1 on the strong fill and both gradient ends', () => {
        expect(['#FFFFFF', '#1F2937']).toContain(palette.foregroundHex);
        expect(contrastRatio(palette.foregroundHex, palette.accentStrongHex)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.foregroundHex, palette.gradientFrom)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.foregroundHex, palette.gradientTo)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps accent text at least 4.5:1 on surface, background and soft tint in both schemes', () => {
        expect(contrastRatio(palette.textLightHex, LIGHT_SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.textLightHex, LIGHT_BACKGROUND_HEX)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.textLightHex, palette.softLight)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.textDarkHex, DARK_SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.textDarkHex, DARK_BACKGROUND_HEX)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.textDarkHex, palette.softDark)).toBeGreaterThanOrEqual(4.5);
    });

    it('produces tinted soft backgrounds that stay close to the surface', () => {
        expect(contrastRatio(palette.softLight, LIGHT_SURFACE_HEX)).toBeLessThan(1.5);
        expect(contrastRatio(palette.softDark, DARK_SURFACE_HEX)).toBeLessThan(2);
    });
});

describe('deriveAccentPalette specifics', () => {
    it('uses ink labels for yellow and white labels for blue', () => {
        expect(deriveAccentPalette('#FFC600').foregroundHex).toBe('#1F2937');
        expect(deriveAccentPalette('#007AFF').foregroundHex).toBe('#FFFFFF');
    });

    it('shifts the gradient end hue by about 25 degrees', () => {
        const palette = deriveAccentPalette('#007AFF');
        expect(palette.gradientTo).not.toBe(palette.gradientFrom);
    });

    it('falls back to indigo for invalid input', () => {
        expect(deriveAccentPalette('garbage').hex).toBe(FALLBACK_ACCENT_HEX);
    });
});

describe('applying the accent', () => {
    beforeEach(() => {
        invokeNative.mockReset();
        document.documentElement.removeAttribute('style');
    });

    it('exposes every derived variable', () => {
        const vars = accentToCssVariables(deriveAccentPalette('#007AFF'));
        expect(Object.keys(vars)).toEqual(expect.arrayContaining([
            '--sys-accent', '--sys-accent-strong', '--sys-accent-gradient-from', '--sys-accent-gradient-to',
            '--sys-accent-foreground', '--sys-accent-soft-light', '--sys-accent-soft-dark',
            '--sys-accent-text-light', '--sys-accent-text-dark', '--sys-primary-light', '--sys-primary-dark',
        ]));
    });

    it('sets the variables on the root and records the source', () => {
        applyAccentHex('#E43F8C');
        expect(document.documentElement.style.getPropertyValue('--sys-accent')).not.toBe('');
        expect(document.documentElement.dataset.accentSource).toBe('system');
        applyAccentHex(null);
        expect(document.documentElement.dataset.accentSource).toBe('fallback');
    });

    it('reads the native accent through invokeNative and tolerates failure', async () => {
        invokeNative.mockResolvedValueOnce('#953D96');
        await expect(readSystemAccentHex()).resolves.toBe('#953D96');
        expect(invokeNative).toHaveBeenCalledWith('get_system_accent_color');
        invokeNative.mockResolvedValueOnce(null);
        await expect(readSystemAccentHex()).resolves.toBeNull();
        invokeNative.mockRejectedValueOnce(new Error('boom'));
        await expect(readSystemAccentHex()).resolves.toBeNull();
        invokeNative.mockResolvedValueOnce('not a colour');
        await expect(readSystemAccentHex()).resolves.toBeNull();
    });
});

describe('isAccentNearDanger', () => {
    it('flags red-ish macOS accents so "today" chips never look like "overdue"', async () => {
        const { isAccentNearDanger } = await import('./system-accent');
        expect(isAccentNearDanger('#E0383E')).toBe(true); // red
        expect(isAccentNearDanger('#E43F8C')).toBe(true); // pink
        expect(isAccentNearDanger('#F7821B')).toBe(false); // orange
        expect(isAccentNearDanger('#007AFF')).toBe(false); // blue
        expect(isAccentNearDanger('#8C8C8C')).toBe(false); // graphite
    });
});
