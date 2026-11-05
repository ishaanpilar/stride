import type { FocusOrigin } from '../../store/focus-session-store';

/**
 * Where the mini card and the pill last sat on screen, so the stage can grow out of (and shrink
 * into) them. Plain module state: it is only a hint for an animation.
 */
export const focusAnchors: { mini: FocusOrigin | null; pill: FocusOrigin | null } = { mini: null, pill: null };

export const rectOf = (el: Element | null | undefined): FocusOrigin | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
};

/** Transform that maps `from` onto `to` (centre to centre, uniform scale by width). */
export function transformBetween(from: FocusOrigin, to: FocusOrigin): string {
    const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
    const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
    const scale = Math.max(0.05, Math.min(1, to.width / Math.max(1, from.width)));
    return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${scale.toFixed(3)})`;
}
