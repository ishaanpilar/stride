import { describe, expect, it } from 'vitest';
import { resolveThemeTokens } from './use-theme-tokens';
import { SOFT_DARK, SOFT_LIGHT, type SoftPalette } from '../constants/soft-ui';

const light = { isDark: false, themeStyle: 'default', themePreset: 'default', themeMode: 'light' } as const;
const dark = { isDark: true, themeStyle: 'default', themePreset: 'default', themeMode: 'dark' } as const;
const nord = { isDark: true, themeStyle: 'default', themePreset: 'nord', themeMode: 'nord' } as const;
const m3 = { isDark: false, themeStyle: 'material3', themePreset: 'default', themeMode: 'material3-light' } as const;

const luminance = (hex: string) => {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const textPairs = (p: SoftPalette): [string, string][] => [
  [p.foreground, p.background], [p.foreground, p.surface], [p.muted, p.surface], [p.muted, p.well],
  [p.tertiary, p.surface], [p.tertiary, p.well], [p.accentText, p.surface], [p.accentText, p.accentSoft],
  [p.dangerText, p.surface], [p.warningText, p.surface], [p.successText, p.surface],
  [p.accentForeground, p.accentGradient[0]],
];

describe('soft UI tokens', () => {
  it.each([['light', SOFT_LIGHT], ['dark', SOFT_DARK]] as const)('%s palette text pairs reach 4.5:1', (_name, palette) => {
    for (const [fg, bg] of textPairs(palette)) {
      expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('white label on the gradient end stays readable', () => {
    expect(contrast('#FFFFFF', SOFT_LIGHT.accentGradient[1])).toBeGreaterThanOrEqual(4.5);
  });

  it('enables dual shadows for the default theme only', () => {
    expect(resolveThemeTokens(light).soft.enabled).toBe(true);
    expect(resolveThemeTokens(light).soft.raised('sm').boxShadow).toHaveLength(2);
    expect(resolveThemeTokens(dark).soft.raised('lg').boxShadow).toHaveLength(2);
    for (const theme of [nord, m3]) {
      const soft = resolveThemeTokens(theme).soft;
      expect(soft.enabled).toBe(false);
      expect(soft.raised('sm')).toEqual({});
      expect(soft.accentShadow.boxShadow).toEqual([]);
    }
  });

  it('keeps touch target minimum at 44', () => {
    expect(resolveThemeTokens(light).soft.minTarget).toBe(44);
  });
});
