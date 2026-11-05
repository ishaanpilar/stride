/**
 * Ambient light for the focus stage ("Still"): three soft blobs whose colours drift through the
 * session (indigo, violet, rose, warm), turn teal on a break and gold at the finish.
 * Pure helpers, so the contrast guarantees can be unit-tested.
 */
export type Rgb = readonly [number, number, number];
export type AmbientKind = 'focus' | 'break' | 'finish';

const FOCUS_STOPS: readonly (readonly [Rgb, Rgb, Rgb])[] = [
    [[99, 102, 241], [139, 92, 246], [56, 189, 248]],
    [[139, 92, 246], [236, 72, 153], [99, 102, 241]],
    [[244, 114, 182], [251, 146, 60], [168, 85, 247]],
];
const BREAK: readonly [Rgb, Rgb, Rgb] = [[45, 212, 191], [34, 197, 94], [56, 189, 248]];
const FINISH: readonly [Rgb, Rgb, Rgb] = [[251, 191, 36], [244, 114, 182], [251, 146, 60]];

/**
 * Peak blob opacity per theme. Chosen so that text drawn straight on the light (time, the
 * "Next" line) stays >= 4.5:1 even where two blobs overlap. See focus-palette.test.ts.
 */
export const AMBIENT_ALPHA = { light: 0.4, dark: 0.3 } as const;
/** Opacity of the glass task card's surface. */
export const GLASS_CARD_ALPHA = 0.88;
/** Opacity of the clock while paused (large text: >= 3:1 on any light). */
export const PAUSED_CLOCK_OPACITY = 0.72;

const mixChannel = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [mixChannel(a[0], b[0], t), mixChannel(a[1], b[1], t), mixChannel(a[2], b[2], t)];

export function ambientColors(kind: AmbientKind, progress: number): readonly [Rgb, Rgb, Rgb] {
    if (kind === 'break') return BREAK;
    if (kind === 'finish') return FINISH;
    const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    const x = p * (FOCUS_STOPS.length - 1);
    const i = Math.min(FOCUS_STOPS.length - 2, Math.floor(x));
    const from = FOCUS_STOPS[i]!;
    const to = FOCUS_STOPS[i + 1]!;
    return [mixRgb(from[0], to[0], x - i), mixRgb(from[1], to[1], x - i), mixRgb(from[2], to[2], x - i)];
}

/** Every colour a blob can take while text sits directly on the light (focus and break). */
export const TEXT_SAFE_AMBIENT: readonly Rgb[] = [...FOCUS_STOPS.flat(), ...BREAK];
export const FINISH_AMBIENT: readonly Rgb[] = FINISH;

const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const relativeLuminance = (c: Rgb) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
export function contrastRatio(a: Rgb, b: Rgb): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** "H S% L%" token channels (as in index.css) to RGB. */
export function hslChannelsToRgb(value: string): Rgb {
    const [h, s, l] = value.trim().split(/\s+/).map((part) => Number.parseFloat(part)) as [number, number, number];
    const sat = s / 100;
    const light = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
