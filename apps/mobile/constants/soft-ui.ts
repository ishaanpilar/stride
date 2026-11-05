import type { ThemeColors } from '../hooks/use-theme-tokens';

export interface SoftShadow {
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  color: string;
}

export type SoftSurfaceSize = 'sm' | 'lg';
export type SoftTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success';

export interface SoftTonePair {
  background: string;
  foreground: string;
}

export interface SoftPalette {
  background: string;
  surface: string;
  well: string;
  wellEdge: string;
  shadowLight: string;
  shadowDark: string;
  foreground: string;
  muted: string;
  tertiary: string;
  border: string;
  accent: string;
  accentStrong: string;
  accentGradient: readonly [string, string];
  accentForeground: string;
  accentSoft: string;
  accentText: string;
  dangerFill: string;
  dangerText: string;
  warningFill: string;
  warningText: string;
  successFill: string;
  successText: string;
}

export interface SoftTokens extends SoftPalette {
  enabled: boolean;
  radius: { control: number; card: number; sheet: number; pill: number };
  minTarget: number;
  tones: Record<SoftTone, SoftTonePair>;
  raised: (size: SoftSurfaceSize) => { boxShadow: SoftShadow[] } | Record<string, never>;
  accentShadow: { boxShadow: SoftShadow[] };
}

export const SOFT_RADIUS = { control: 10, card: 14, sheet: 16, pill: 999 } as const;
export const SOFT_MIN_TARGET = 44;
export const SOFT_DEFAULT_ACCENT = '#4F46E5';

export const SOFT_LIGHT: SoftPalette = {
  background: '#F0F4F8',
  surface: '#FFFFFF',
  well: '#E9EEF4',
  wellEdge: '#D1D9E6',
  shadowLight: '#FFFFFF',
  shadowDark: '#D1D9E6',
  foreground: '#1F2937',
  muted: '#4B5563',
  tertiary: '#5B6472',
  border: '#E3E8F0',
  accent: SOFT_DEFAULT_ACCENT,
  accentStrong: SOFT_DEFAULT_ACCENT,
  accentGradient: ['#4F46E5', '#974FE6'],
  accentForeground: '#FFFFFF',
  accentSoft: '#EAE9FC',
  accentText: '#4F46E5',
  dangerFill: '#EF4444',
  dangerText: '#B91C1C',
  warningFill: '#EA580C',
  warningText: '#C2410C',
  successFill: '#22C55E',
  successText: '#15803D',
};

export const SOFT_DARK: SoftPalette = {
  background: '#14161C',
  surface: '#1E222A',
  well: '#171A20',
  wellEdge: '#0C0E12',
  shadowLight: 'rgba(255, 255, 255, 0.05)',
  shadowDark: 'rgba(0, 0, 0, 0.35)',
  foreground: '#F3F4F6',
  muted: '#A1A8B5',
  tertiary: '#8A92A0',
  border: '#2A2E37',
  accent: '#908BEE',
  accentStrong: '#4F46E5',
  accentGradient: ['#4F46E5', '#974FE6'],
  accentForeground: '#FFFFFF',
  accentSoft: '#353751',
  accentText: '#B4B0F5',
  dangerFill: '#EF4444',
  dangerText: '#F87171',
  warningFill: '#EA580C',
  warningText: '#FB923C',
  successFill: '#22C55E',
  successText: '#4ADE80',
};

const RAISED_LIGHT: Record<SoftSurfaceSize, { offset: number; blur: number }> = {
  lg: { offset: 6, blur: 15 },
  sm: { offset: 3, blur: 8 },
};

const RAISED_DARK: Record<SoftSurfaceSize, { drop: number; blur: number }> = {
  lg: { drop: 6, blur: 18 },
  sm: { drop: 3, blur: 8 },
};

function buildRaised(palette: SoftPalette, isDark: boolean) {
  return (size: SoftSurfaceSize) => {
    if (isDark) {
      const { drop, blur } = RAISED_DARK[size];
      return {
        boxShadow: [
          { offsetX: 0, offsetY: 1, blurRadius: 0, color: palette.shadowLight },
          { offsetX: 0, offsetY: drop, blurRadius: blur, color: palette.shadowDark },
        ],
      };
    }
    const { offset, blur } = RAISED_LIGHT[size];
    return {
      boxShadow: [
        { offsetX: -offset, offsetY: -offset, blurRadius: blur, color: palette.shadowLight },
        { offsetX: offset, offsetY: offset, blurRadius: blur, color: palette.shadowDark },
      ],
    };
  };
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const channel = (start: number) => parseInt(value.slice(start, start + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`;
}

function buildTones(palette: SoftPalette): Record<SoftTone, SoftTonePair> {
  return {
    neutral: { background: palette.well, foreground: palette.muted },
    accent: { background: palette.accentSoft, foreground: palette.accentText },
    danger: { background: withAlpha(palette.dangerFill, 0.1), foreground: palette.dangerText },
    warning: { background: withAlpha(palette.warningFill, 0.12), foreground: palette.warningText },
    success: { background: withAlpha(palette.successFill, 0.12), foreground: palette.successText },
  };
}

function assemble(palette: SoftPalette, isDark: boolean, enabled: boolean): SoftTokens {
  const raised = buildRaised(palette, isDark);
  return {
    ...palette,
    enabled,
    radius: { ...SOFT_RADIUS },
    minTarget: SOFT_MIN_TARGET,
    tones: buildTones(palette),
    raised: enabled ? raised : () => ({}),
    accentShadow: {
      boxShadow: enabled
        ? [{ offsetX: 0, offsetY: 4, blurRadius: 14, color: withAlpha(palette.accentStrong, 0.35) }]
        : [],
    },
  };
}

export function buildDefaultSoftTokens(isDark: boolean): SoftTokens {
  return assemble(isDark ? SOFT_DARK : SOFT_LIGHT, isDark, true);
}

export function buildFlatSoftTokens(colors: ThemeColors, isDark: boolean): SoftTokens {
  const base = isDark ? SOFT_DARK : SOFT_LIGHT;
  const palette: SoftPalette = {
    ...base,
    background: colors.bg,
    surface: colors.cardBg,
    well: colors.inputBg,
    wellEdge: colors.border,
    foreground: colors.text,
    muted: colors.secondaryText,
    tertiary: colors.secondaryText,
    border: colors.border,
    accent: colors.tint,
    accentStrong: colors.tint,
    accentGradient: [colors.tint, colors.tint],
    accentForeground: colors.onTint,
    accentSoft: colors.filterBg,
    accentText: colors.tint,
    dangerFill: colors.danger,
    dangerText: colors.danger,
    warningFill: colors.warning,
    warningText: colors.warning,
    successFill: colors.success,
    successText: colors.success,
  };
  return assemble(palette, isDark, false);
}
