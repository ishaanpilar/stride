import { isTauriRuntime } from './runtime';
import { invokeNative } from './tauri-invoke';

/**
 * macOS system accent pipeline.
 *
 * The native side returns NSColor.controlAccentColor as sRGB hex. We derive accessible variants with
 * pure functions (WCAG relative luminance) and publish them as `--sys-accent-*` custom properties on
 * <html>. index.css maps those onto the design tokens (`--accent`, `--accent-strong`, `--primary`, ...)
 * so that themes (Nord, Dracula, ...) can still override the tokens with their own colours.
 */

export const FALLBACK_ACCENT_HEX = '#4F46E5';
export const SYSTEM_ACCENT_CHANGED_EVENT = 'system-accent-changed';

export const LIGHT_SURFACE_HEX = '#FFFFFF';
export const DARK_SURFACE_HEX = '#1E222A';
export const LIGHT_BACKGROUND_HEX = '#F0F4F8';
export const DARK_BACKGROUND_HEX = '#14161C';
export const INK_HEX = '#1F2937';
const WHITE_HEX = '#FFFFFF';
export const MIN_TEXT_CONTRAST = 4.5;
const SOFT_ALPHA_LIGHT = 0.12;
const SOFT_ALPHA_DARK = 0.2;

type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const parseHex = (value: string): Rgb | null => {
    const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return null;
    const n = parseInt(match[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

export const toHex = ({ r, g, b }: Rgb): string => (
    '#' + [r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()
);

export const rgbToHsl = ({ r, g, b }: Rgb): Hsl => {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l: l * 100 };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
};

export const hslToRgb = ({ h, s, l }: Hsl): Rgb => {
    const sn = clamp(s, 0, 100) / 100;
    const ln = clamp(l, 0, 100) / 100;
    const hh = (((h % 360) + 360) % 360) / 60;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    const [r1, g1, b1] =
        hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
    const m = ln - c / 2;
    return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
};

const hslToHex = (hsl: Hsl): string => toHex(hslToRgb(hsl));
const hexToHsl = (hex: string): Hsl => rgbToHsl(parseHex(hex) ?? parseHex(FALLBACK_ACCENT_HEX)!);

/** WCAG 2.x relative luminance of an sRGB hex colour. */
export const relativeLuminance = (hex: string): number => {
    const rgb = parseHex(hex);
    if (!rgb) return 0;
    const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
};

/** WCAG contrast ratio (1..21) between two hex colours. */
export const contrastRatio = (a: string, b: string): number => {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Opaque result of `fg` at `alpha` over `bg`. */
export const blendOver = (fg: string, bg: string, alpha: number): string => {
    const f = parseHex(fg)!;
    const b = parseHex(bg)!;
    return toHex({
        r: f.r * alpha + b.r * (1 - alpha),
        g: f.g * alpha + b.g * (1 - alpha),
        b: f.b * alpha + b.b * (1 - alpha),
    });
};

/** Format as the "H S% L%" channel string used by the other tokens (`hsl(var(--x))`). */
export const hslChannels = ({ h, s, l }: Hsl): string => (
    `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`
);
const hexChannels = (hex: string) => hslChannels(hexToHsl(hex));

/** Step lightness in `direction` until `ok(candidateHex)` holds (or the range is exhausted). */
const adjustUntil = (start: Hsl, direction: 1 | -1, ok: (hex: string) => boolean): Hsl => {
    let current = start;
    for (let i = 0; i < 100; i += 1) {
        if (ok(hslToHex(current))) return current;
        const next = { ...current, l: current.l + direction };
        if (next.l < 0 || next.l > 100) break;
        current = next;
    }
    return current;
};

export type AccentPalette = {
    /** Source accent (sRGB hex, normalised). */
    hex: string;
    /** `--accent`: the raw accent, "H S% L%". */
    accent: string;
    /** `--accent-strong`: darkened (or unchanged for ink-label accents), "H S% L%". */
    accentStrong: string;
    accentStrongHex: string;
    /** `--accent-gradient-from` / `-to`: full colours. */
    gradientFrom: string;
    gradientTo: string;
    /** `--accent-foreground`: label colour on strong/gradient fills, "H S% L%". */
    foreground: string;
    foregroundHex: string;
    /** `--accent-soft`: opaque tints (accent over the surface at 12% light / 20% dark). */
    softLight: string;
    softDark: string;
    /** `--accent-text`: for text and icons, "H S% L%". */
    textLight: string;
    textDark: string;
    textLightHex: string;
    textDarkHex: string;
    /** `--primary` / `--primary-foreground` per colour scheme. */
    primaryLight: string;
    primaryForegroundLight: string;
    primaryDark: string;
    primaryForegroundDark: string;
};

export const deriveAccentPalette = (input: string): AccentPalette => {
    const hex = toHex(parseHex(input) ?? parseHex(FALLBACK_ACCENT_HEX)!);
    const base = hexToHsl(hex);

    // Label colour: white where darkening can reach 4.5:1; otherwise ink for light accents (yellow, orange, green).
    const whiteOnBase = contrastRatio(WHITE_HEX, hex);
    const inkOnBase = contrastRatio(INK_HEX, hex);
    const useInk = whiteOnBase < MIN_TEXT_CONTRAST && inkOnBase >= MIN_TEXT_CONTRAST && inkOnBase > whiteOnBase;
    const foregroundHex = useInk ? INK_HEX : WHITE_HEX;
    const labelOk = (candidate: string) => contrastRatio(foregroundHex, candidate) >= MIN_TEXT_CONTRAST;

    const strong = useInk ? base : adjustUntil(base, -1, labelOk);
    const strongHex = hslToHex(strong);

    const targetTo: Hsl = { h: base.h + 25, s: strong.s, l: Math.min(strong.l + 6, 95) };
    const to = adjustUntil(targetTo, useInk ? 1 : -1, labelOk);

    // Text on the surface, also checked on the page background and on the soft tint.
    const softLight = blendOver(hex, LIGHT_SURFACE_HEX, SOFT_ALPHA_LIGHT);
    const softDark = blendOver(hex, DARK_SURFACE_HEX, SOFT_ALPHA_DARK);
    const textLight = adjustUntil(base, -1, (c) => (
        contrastRatio(c, LIGHT_SURFACE_HEX) >= MIN_TEXT_CONTRAST
        && contrastRatio(c, LIGHT_BACKGROUND_HEX) >= MIN_TEXT_CONTRAST
        && contrastRatio(c, blendOver(c, LIGHT_SURFACE_HEX, SOFT_ALPHA_LIGHT)) >= MIN_TEXT_CONTRAST
        && contrastRatio(c, softLight) >= MIN_TEXT_CONTRAST
    ));
    const textDark = adjustUntil(base, 1, (c) => (
        contrastRatio(c, DARK_SURFACE_HEX) >= MIN_TEXT_CONTRAST
        && contrastRatio(c, DARK_BACKGROUND_HEX) >= MIN_TEXT_CONTRAST
        && contrastRatio(c, softDark) >= MIN_TEXT_CONTRAST
    ));
    const textLightHex = hslToHex(textLight);
    const textDarkHex = hslToHex(textDark);

    const darkPrimaryForegroundHex = contrastRatio(DARK_BACKGROUND_HEX, textDarkHex) >= MIN_TEXT_CONTRAST
        ? DARK_BACKGROUND_HEX
        : WHITE_HEX;

    return {
        hex,
        accent: hslChannels(base),
        accentStrong: hslChannels(strong),
        accentStrongHex: strongHex,
        gradientFrom: strongHex,
        gradientTo: hslToHex(to),
        foreground: hexChannels(foregroundHex),
        foregroundHex,
        softLight,
        softDark,
        textLight: hslChannels(textLight),
        textDark: hslChannels(textDark),
        textLightHex,
        textDarkHex,
        primaryLight: hslChannels(strong),
        primaryForegroundLight: hexChannels(foregroundHex),
        primaryDark: hslChannels(textDark),
        primaryForegroundDark: hexChannels(darkPrimaryForegroundHex),
    };
};

/** The custom properties set on <html> for an accent (consumed by index.css). */
export const accentToCssVariables = (palette: AccentPalette): Record<string, string> => ({
    '--sys-accent': palette.accent,
    '--sys-accent-strong': palette.accentStrong,
    '--sys-accent-gradient-from': palette.gradientFrom,
    '--sys-accent-gradient-to': palette.gradientTo,
    '--sys-accent-foreground': palette.foreground,
    '--sys-accent-soft-light': palette.softLight,
    '--sys-accent-soft-dark': palette.softDark,
    '--sys-accent-text-light': palette.textLight,
    '--sys-accent-text-dark': palette.textDark,
    '--sys-primary-light': palette.primaryLight,
    '--sys-primary-foreground-light': palette.primaryForegroundLight,
    '--sys-primary-dark': palette.primaryDark,
    '--sys-primary-foreground-dark': palette.primaryForegroundDark,
});

/**
 * True when the accent reads as red (hue from pink through red to red-orange, and saturated), so accent-tinted
 * "today" chips would look like the red "overdue" ones. Graphite and other greys are never near red.
 */
export const isAccentNearDanger = (hex: string): boolean => {
    const rgb = parseHex(hex);
    if (!rgb) return false;
    const { h, s } = rgbToHsl(rgb);
    return s >= 35 && (h <= 25 || h >= 320);
};

export const applyAccentHex = (hex: string | null | undefined, root: HTMLElement = document.documentElement): AccentPalette => {
    const palette = deriveAccentPalette(hex && parseHex(hex) ? hex : FALLBACK_ACCENT_HEX);
    for (const [name, value] of Object.entries(accentToCssVariables(palette))) {
        root.style.setProperty(name, value);
    }
    root.dataset.accentSource = hex && parseHex(hex) ? 'system' : 'fallback';
    root.dataset.accentNearDanger = isAccentNearDanger(hex && parseHex(hex) ? hex : FALLBACK_ACCENT_HEX) ? 'true' : 'false';
    return palette;
};

export const readSystemAccentHex = async (): Promise<string | null> => {
    if (!isTauriRuntime()) return null;
    try {
        const value = await invokeNative<string | null>('get_system_accent_color');
        return typeof value === 'string' && parseHex(value) ? value : null;
    } catch {
        return null;
    }
};

export const refreshSystemAccent = async (root: HTMLElement = document.documentElement): Promise<AccentPalette> => (
    applyAccentHex(await readSystemAccentHex(), root)
);

/**
 * Applies the accent immediately (fallback until the native read resolves), then re-reads on window
 * focus, when the document becomes visible and on the native `system-accent-changed` event.
 * Returns a cleanup function.
 */
export const installSystemAccent = (): (() => void) => {
    if (typeof document === 'undefined') return () => undefined;
    const root = document.documentElement;
    applyAccentHex(null, root);
    if (!isTauriRuntime()) return () => undefined;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = () => {
        void readSystemAccentHex().then((hex) => {
            if (!disposed) applyAccentHex(hex, root);
        });
    };
    const onVisibility = () => {
        if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    refresh();
    void import('@tauri-apps/api/event')
        .then(({ listen }) => listen<string | null>(SYSTEM_ACCENT_CHANGED_EVENT, (event) => {
            if (disposed) return;
            if (typeof event.payload === 'string' && parseHex(event.payload)) applyAccentHex(event.payload, root);
            else refresh();
        }))
        .then((stop) => {
            if (disposed) stop();
            else unlisten = stop;
        })
        .catch(() => undefined);

    return () => {
        disposed = true;
        window.removeEventListener('focus', refresh);
        document.removeEventListener('visibilitychange', onVisibility);
        unlisten?.();
    };
};
